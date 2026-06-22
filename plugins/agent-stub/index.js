import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const sessions = new Map();

const ARTICLE_PROMPT = `Ты редактор Telegram-канала. Напиши статью на русском языке по теме пользователя.

Жесткие правила:
- опирайся только на источники из блока "Источники";
- не выдумывай факты, цифры, цитаты и ссылки;
- если источников недостаточно, прямо скажи, чего не хватает;
- добавь ссылки в текст или в финальный список "Источники";
- не публикуй небезопасные инструкции, призывы к насилию, мошенничество, персональные данные;
- если есть замечания редактора, учти их и улучши предыдущий черновик.

Структура:
1. Короткий заголовок.
2. Лид на 2-3 предложения.
3. Основная часть с проверяемыми фактами.
4. Вывод.
5. Источники со ссылками.

Длина: 2500-3500 знаков. Тон: ясный, журналистский, без канцелярита.`;

export default definePluginEntry({
  id: "agentstub",
  name: "OpenClaw Editor Agent",
  description: "Telegram editor-agent on OpenClaw with Tavily search, OpenRouter generation and approval gate.",
  register(api) {
    api.registerCommand({
      name: "start",
      description: "Запустить бота",
      acceptsArgs: false,
      requireAuth: false,
      handler: () => ({
        text:
          "Пришлите тему статьи одним сообщением. Я найду источники, подготовлю черновик и покажу кнопки согласования.\n\n" +
          "Публикация в канал выполняется только после нажатия \"Опубликовать\". Если нажать \"Отклонить\", я попрошу замечание и подготовлю новый черновик.",
        continueAgent: false,
      }),
    });

    api.registerCommand({
      name: "draft",
      description: "Подготовить черновик: /draft тема статьи",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const topic = getCommandText(ctx);
        if (!topic) {
          return { text: "Напишите тему после команды: /draft тема статьи", continueAgent: false };
        }

        const userId = getSenderId(ctx);
        const result = await createDraft(api, { userId, topic });
        if (!result.ok) return { text: result.error, continueAgent: false };

        return draftResponse(result.session);
      },
    });

    api.on("before_dispatch", async (event) => {
      const text = String(event?.content ?? event?.body ?? "").trim();
      if (!text || text.startsWith("/")) return;

      const userId = String(event?.senderId ?? event?.from?.id ?? "unknown");
      const chatId = getEventChatId(event, userId);
      const session = sessions.get(userId);

      if (session?.awaitingFeedback) {
        await sendTelegramMessage(chatId, "Принял замечание. Готовлю новую версию черновика...");
        const result = await createDraft(api, {
          userId,
          topic: session.topic,
          feedback: text,
          previousArticle: session.article,
        });

        if (!result.ok) {
          await sendTelegramMessage(chatId, result.error);
          return { handled: true, text: "Не удалось подготовить новую версию. Попробуйте ещё раз." };
        }

        await sendDraftToTelegram(chatId, result.session);
        return { handled: true, text: "Новый черновик готов. Проверьте сообщение с кнопками." };
      }

      await sendTelegramMessage(chatId, "Ищу источники и готовлю черновик...");
      const result = await createDraft(api, { userId, topic: text });

      if (!result.ok) {
        await sendTelegramMessage(chatId, result.error);
        return { handled: true, text: "Не удалось подготовить черновик. Проверьте ключи и попробуйте ещё раз." };
      }

      await sendDraftToTelegram(chatId, result.session);
      return { handled: true, text: "Черновик готов. Проверьте сообщение с кнопками согласования." };
    });

    api.registerInteractiveHandler({
      channel: "telegram",
      namespace: "editor",
      handler: async (ctx) => {
        const action = ctx?.callback?.payload;
        const userId = String(ctx?.senderId ?? ctx?.callback?.senderId ?? "unknown");
        const session = sessions.get(userId);

        if (!session?.article) {
          await ctx.respond.editMessage({ text: "Черновик не найден. Пришлите тему заново." });
          return { handled: true };
        }

        if (action === "reject") {
          session.awaitingFeedback = true;
          sessions.set(userId, session);
          await ctx.respond.editMessage({
            text:
              "Черновик отклонён. Пришлите замечание одним сообщением, и я подготовлю новую версию.\n\n" +
              "Текущая тема: " + session.topic,
          });
          return { handled: true };
        }

        if (action === "publish") {
          const guard = validateDraft(session);
          if (!guard.ok) {
            await ctx.respond.editMessage({ text: guard.error });
            return { handled: true };
          }

          const published = await publishToChannel(formatArticleForPublication(session));
          if (!published.ok) {
            await ctx.respond.editMessage({ text: published.error });
            return { handled: true };
          }

          session.published = true;
          session.awaitingFeedback = false;
          sessions.set(userId, session);
          await ctx.respond.editMessage({ text: "Опубликовано в канал." });
          return { handled: true };
        }

        await ctx.respond.editMessage({ text: "Неизвестное действие. Пришлите тему заново." });
        return { handled: true };
      },
    });
  },
});

async function createDraft(api, { userId, topic, feedback = "", previousArticle = "" }) {
  if (!process.env.OPENROUTER_API_KEY) {
    return { ok: false, error: "Не задан OPENROUTER_API_KEY." };
  }
  if (!process.env.SEARCH_API_KEY && !process.env.TAVILY_API_KEY) {
    return { ok: false, error: "Не задан SEARCH_API_KEY." };
  }

  const cleanTopic = normalizeText(topic);
  if (!isAllowedTopic(cleanTopic)) {
    return {
      ok: false,
      error: "Тема выглядит небезопасной или слишком короткой. Пришлите нейтральную тему для информационной статьи.",
    };
  }

  const sources = await searchSources(api, cleanTopic);
  if (sources.length === 0) {
    return { ok: false, error: "Не удалось найти источники по теме. Уточните тему и попробуйте ещё раз." };
  }

  const prompt = buildPrompt({ topic: cleanTopic, sources, feedback, previousArticle });
  const out = await api.runtime.llm.complete({
    messages: [{ role: "user", content: prompt }],
  });
  const article = normalizeText(out?.text);

  if (!article || article.length < 500) {
    return { ok: false, error: "Модель вернула слишком короткий черновик. Попробуйте уточнить тему." };
  }

  const session = {
    topic: cleanTopic,
    article,
    sources,
    feedbackHistory: feedback ? [...(sessions.get(userId)?.feedbackHistory ?? []), feedback] : sessions.get(userId)?.feedbackHistory ?? [],
    awaitingFeedback: false,
    published: false,
    updatedAt: Date.now(),
  };

  sessions.set(userId, session);
  return { ok: true, session };
}

async function searchSources(api, topic) {
  const { result } = await api.runtime.webSearch.search({ args: { query: topic } });
  const raw = Array.isArray(result?.results) ? result.results : [];

  return raw
    .map((item) => ({
      title: normalizeText(item?.title).slice(0, 140),
      url: normalizeText(item?.url),
      content: normalizeText(item?.content ?? item?.snippet ?? item?.raw_content).slice(0, 700),
    }))
    .filter((item) => item.url.startsWith("http") && item.title)
    .slice(0, 6);
}

function buildPrompt({ topic, sources, feedback, previousArticle }) {
  const sourceBlock = sources
    .map((source, index) => `${index + 1}. ${source.title}\nURL: ${source.url}\nФрагмент: ${source.content}`)
    .join("\n\n");

  return `${ARTICLE_PROMPT}

Тема: ${topic}

${previousArticle ? `Предыдущий черновик:\n${previousArticle}\n` : ""}
${feedback ? `Замечание редактора:\n${feedback}\n` : ""}
Источники:
${sourceBlock}`;
}

function draftResponse(session) {
  return {
    text: formatDraft(session),
    presentation: {
      blocks: [
        {
          type: "buttons",
          buttons: [
            { label: "Опубликовать", value: "editor:publish", style: "primary" },
            { label: "Отклонить", value: "editor:reject", style: "danger" },
          ],
        },
      ],
    },
    continueAgent: false,
  };
}

async function sendDraftToTelegram(chatId, session) {
  await sendTelegramMessage(chatId, formatDraft(session), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Опубликовать", callback_data: "editor:publish" },
          { text: "Отклонить", callback_data: "editor:reject" },
        ],
      ],
    },
  });
}

function formatDraft(session) {
  const sourceList = formatSourceList(session.sources);
  return `Черновик по теме: ${session.topic}

${session.article}

Проверочные источники:
${sourceList}`;
}

function formatArticleForPublication(session) {
  return `${session.article}

Источники:
${formatSourceList(session.sources)}`;
}

function formatSourceList(sources) {
  return sources.map((source, index) => `${index + 1}. ${source.title}\n${source.url}`).join("\n");
}

function validateDraft(session) {
  if (!process.env.TELEGRAM_CHANNEL_ID) {
    return { ok: false, error: "Не задан TELEGRAM_CHANNEL_ID. Публикация невозможна." };
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "Не задан TELEGRAM_BOT_TOKEN. Публикация невозможна." };
  }
  const publicationText = formatArticleForPublication(session);
  if (!session.sources?.length || !session.sources.some((source) => publicationText.includes(source.url))) {
    return {
      ok: false,
      error: "В черновике нет ссылок на найденные источники. Отклоните черновик и попросите добавить ссылки.",
    };
  }
  if (looksUnsafe(session.article)) {
    return { ok: false, error: "Черновик не прошёл базовую проверку безопасности. Публикация остановлена." };
  }
  return { ok: true };
}

async function publishToChannel(article) {
  const chunks = splitTelegramText(article);
  for (const chunk of chunks) {
    const sent = await telegramRequest("sendMessage", {
      chat_id: process.env.TELEGRAM_CHANNEL_ID,
      text: chunk,
      disable_web_page_preview: true,
    });
    if (!sent.ok) return sent;
  }
  return { ok: true };
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  const chunks = splitTelegramText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    const payload = {
      chat_id: chatId,
      text: chunks[index],
      disable_web_page_preview: true,
      ...(index === chunks.length - 1 ? extra : {}),
    };
    const sent = await telegramRequest("sendMessage", payload);
    if (!sent.ok) return sent;
  }
  return { ok: true };
}

async function telegramRequest(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Не задан TELEGRAM_BOT_TOKEN." };

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok === false) {
    return {
      ok: false,
      error: `Telegram API error: ${data?.description ?? response.statusText}`,
    };
  }
  return { ok: true, data };
}

function getCommandText(ctx) {
  return normalizeText(ctx?.args?.join?.(" ") ?? ctx?.args ?? ctx?.content ?? ctx?.text ?? "");
}

function getSenderId(ctx) {
  return String(ctx?.senderId ?? ctx?.message?.from?.id ?? ctx?.from?.id ?? "unknown");
}

function getEventChatId(event, fallback) {
  return String(
    event?.chatId ??
      event?.chat?.id ??
      event?.message?.chat?.id ??
      event?.conversationId ??
      event?.senderId ??
      fallback,
  );
}

function splitTelegramText(text) {
  const clean = normalizeText(text);
  const limit = 3900;
  if (clean.length <= limit) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > limit) {
    const cut = Math.max(rest.lastIndexOf("\n", limit), rest.lastIndexOf(". ", limit), 1200);
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isAllowedTopic(topic) {
  return topic.length >= 4 && !looksUnsafe(topic);
}

function looksUnsafe(text) {
  const value = normalizeText(text).toLowerCase();
  return [
    "инструкция по взлому",
    "как взломать",
    "украсть пароль",
    "изготовить бомбу",
    "купить наркотики",
    "персональные данные",
  ].some((marker) => value.includes(marker));
}
