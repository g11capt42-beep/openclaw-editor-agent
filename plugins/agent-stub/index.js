// agent-stub — каркасный плагин editor-агента на OpenClaw.
//
// ЖИВОЕ (доказывает, что каркас работает):
//   - команда /start — приветствие (мимо LLM);
//   - эхо на любое входящее сообщение через хук before_dispatch (мимо LLM);
//   - команда /demo — РАБОЧИЙ ПРУФ inline-кнопок: рендер + клик + ответ.
//
// TODO(кандидат) — пайплайн агента: см. блок в конце register().
// Логика пайплайна намеренно НЕ реализована: это и оценивается у кандидата.
// Механику кнопок (которую требует ТЗ) смотри в рабочем примере /demo ниже.

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "agentstub",
  name: "OpenClaw Editor Agent (template)",
  description: "Skeleton editor-agent: живые пруфы (echo + кнопки) + TODO-заглушки пайплайна",
  register(api) {
    // ── ЖИВОЕ: /start — приветствие, мимо LLM ──
    api.registerCommand({
      name: "start",
      description: "Запустить бота",
      acceptsArgs: false,
      requireAuth: false,
      handler: () => ({
        text:
          "OpenClaw editor-agent (шаблон). Каркас рабочий:\n" +
          "• пришли любой текст — отвечу эхом;\n" +
          "• /demo — пример inline-кнопок (рендер + обработка клика).\n\n" +
          "Логику агента дописывает кандидат — см. README и TODO в plugins/agent-stub/index.js.",
        continueAgent: false,
      }),
    });

    // ── ЖИВОЕ: эхо на любое входящее — доказывает long-polling и обработку без LLM ──
    //    TODO(кандидат): удали этот эхо-хук, когда подключишь реальный пайплайн ниже.
    //    Замечание: before_dispatch может вернуть ТОЛЬКО { handled, text } — кнопки тут НЕЛЬЗЯ.
    //    event.content = текст входящего, event.senderId = кто прислал.
    api.on("before_dispatch", async (event /*, ctx */) => {
      const text = String(event?.content ?? event?.body ?? "").trim();
      if (!text || text.startsWith("/")) return; // команды и пустое — мимо
      return { handled: true, text: `echo: ${text}` };
    });

    // ── ЖИВОЙ ПРУФ КНОПОК: /demo ──
    //    Это эталон механики, которую требует ТЗ. Кнопки можно показать ТОЛЬКО из команды
    //    (registerCommand → presentation.blocks). value кнопки = "<namespace>:<действие>"
    //    (разделитель — первый ":"). По namespace клик роутится в registerInteractiveHandler.
    api.registerCommand({
      name: "demo",
      description: "Демо inline-кнопок (рабочий пример механики)",
      acceptsArgs: false,
      requireAuth: false,
      handler: () => ({
        text: "Демо inline-кнопок. Нажми любую — сообщение отредактируется:",
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                { label: "✅ Опубликовать", value: "demo:publish", style: "primary" },
                { label: "✋ Отклонить", value: "demo:reject", style: "danger" },
              ],
            },
          ],
        },
        continueAgent: false,
      }),
    });

    // Клик по кнопке demo: namespace "demo" → payload = часть value после "demo:".
    //   ctx.callback.payload — действие ("publish" / "reject");
    //   ctx.senderId        — кто нажал;
    //   ctx.callback.chatId — где нажал;
    //   ctx.respond.editMessage / .reply / .clearButtons — ответ (edit = без спама новыми сообщениями).
    api.registerInteractiveHandler({
      channel: "telegram",
      namespace: "demo",
      handler: async (ctx) => {
        const action = ctx?.callback?.payload;
        const text =
          action === "publish"
            ? "✅ Нажато «Опубликовать» (payload=publish). Клик дошёл до обработчика."
            : action === "reject"
              ? "✋ Нажато «Отклонить» (payload=reject). Клик дошёл до обработчика."
              : `Клик получен, payload="${action ?? ""}".`;
        await ctx.respond.editMessage({ text });
        return { handled: true };
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TODO(кандидат): реализовать пайплайн editor-агента.
    // Реальные сигнатуры SDK (проверены по типам OpenClaw) — НЕ путать с псевдокодом:
    //
    //   1. Приём темы из Telegram.
    //      Текст веди через before_dispatch (event.content) или свою команду.
    //      Помни: кнопки рендерятся только из команды, before_dispatch — только текст.
    //
    //   2. Поиск источников (провайдер tavily из config; ключ из SEARCH_API_KEY,
    //      entrypoint пробрасывает его в TAVILY_API_KEY):
    //        const { result } = await api.runtime.webSearch.search({ args: { query: topic } });
    //      result — объект от провайдера (Record<string,unknown>); разбирай защищённо
    //      (у tavily источники обычно в result.results[] с полями url/title/content).
    //      (Метода api.tools.web_search НЕТ — не использовать.)
    //
    //   3. Генерация статьи СО ССЫЛКАМИ на реальные источники:
    //        const out = await api.runtime.llm.complete({
    //          messages: [{ role: "user", content: prompt }],
    //        });
    //        const article = out.text;   // ответ в .text (НЕ choices[].message.content)
    //
    //   4. Черновик с кнопками [Опубликовать]/[Отклонить] — механика как в /demo выше:
    //        presentation.blocks → { type:"buttons", buttons:[{ label, value:"editor:publish" }, ...] }
    //        value ОБЯЗАН начинаться с namespace + ":" (например "editor:publish"),
    //        иначе клик не дойдёт до обработчика. Лимит callback ≤ 64 байта.
    //        Клик ловит: api.registerInteractiveHandler({ channel:"telegram", namespace:"editor", handler })
    //        В handler: действие в ctx.callback.payload; ответ — ctx.respond.editMessage/.reply.
    //
    //   5. Доработка по замечанию: на "Отклонить" — запросить замечание, перегенерировать черновик.
    //
    //   6. Публикация в канал (process.env.TELEGRAM_CHANNEL_ID) ТОЛЬКО после "Опубликовать".
    //      Вариант А (проще): публикуй черновик+кнопки сразу в канал и редактируй его по клику
    //      через ctx.respond.editMessage. Вариант Б: отправь готовый текст в канал отдельным
    //      сообщением (outbound sendMessage: { channel:"telegram", to: TELEGRAM_CHANNEL_ID, content }).
    //
    // Правила (см. README): без хардкода ключей; ссылки на реальные источники;
    // без согласования человека — не публиковать.
    // ─────────────────────────────────────────────────────────────────────────
  },
});
