# OpenClaw editor-agent — шаблон тестового задания

Каркас Telegram-агента-редактора на [OpenClaw](https://openclaw.ai). Это **GitHub template**:
форкни/«Use this template», допиши логику агента, пришли ссылку на свою ветку — мы развернём и проверим.

Шаблон даёт готовый каркас и подключение конфигурации. **Логику агента писать тебе.**

---

## Что агент должен уметь (целевой поток)

Тема из Telegram → поиск источников (Tavily) → статья со ссылками на реальные источники (OpenRouter) →
черновик в канал с кнопками **[Опубликовать] / [Отклонить]** → доработка по замечанию →
**публикация в канал только после явного согласия человека**.

---

## Что уже сделано (в шаблоне)

- Агент на OpenClaw собирается и стартует одной командой.
- Telegram-бот в режиме **long-polling** (без webhook), один бот + один канал.
- Конфиг — только из переменных окружения (`config.example.json` → `~/.openclaw/openclaw.json` на старте).
- Подключены провайдеры: OpenRouter (модель, формат OpenAI) и Tavily (поиск).
- Модель по умолчанию — **дешёвая и надёжная** (`openai/gpt-4o-mini`): менять не требуется. Нужен OpenRouter-ключ с минимальным балансом (одна статья ≈ доли цента; ~$1 хватает на все тесты).
- `Dockerfile` для деплоя на Railway (см. «Деплой»).
- **Живые пруфы каркаса** (`plugins/agent-stub/index.js`, без вызова модели):
  - `/start` — приветствие;
  - эхо на любой текст;
  - **`/demo` — рабочий пример inline-кнопок** (рендер + клик + ответ). Это эталон механики, которую требует ТЗ — копируй отсюда.

## Что дописываешь ты (кандидат)

Всё помечено `TODO(кандидат)` в [`plugins/agent-stub/index.js`](plugins/agent-stub/index.js):

1. Приём темы из Telegram.
2. Поиск источников (провайдер Tavily; ключ — `SEARCH_API_KEY`).
3. Генерация статьи со ссылками через OpenRouter (ключ — `OPENROUTER_API_KEY`).
4. Черновик с inline-кнопками [Опубликовать]/[Отклонить] (механика — как в `/demo`).
5. Доработка по замечанию человека.
6. Публикация в канал (`TELEGRAM_CHANNEL_ID`) **только после согласия** (нажатие кнопки).

## API-шпаргалка (реальные сигнатуры SDK)

> Сверено по типам OpenClaw. Используй именно это — не угадывай.

**LLM (OpenRouter):**
```js
const out = await api.runtime.llm.complete({
  messages: [{ role: "user", content: prompt }],
});
const text = out.text;            // ответ в .text (НЕ choices[].message.content)
```

**Поиск источников:**
```js
const { result } = await api.runtime.webSearch.search({ args: { query: topic } });
// провайдер tavily берётся из config; ключ — из SEARCH_API_KEY (мост в TAVILY_API_KEY).
// result — объект провайдера (Record<string,unknown>); у tavily обычно result.results[] {url,title,content}.
// Метода api.tools.web_search НЕ существует.
```

**Inline-кнопки (только из команды):**
```js
return {
  text: "Черновик…",
  presentation: {
    blocks: [{ type: "buttons", buttons: [
      { label: "Опубликовать", value: "editor:publish", style: "primary" },
      { label: "Отклонить",    value: "editor:reject",  style: "danger"  },
    ]}],
  },
};
// value = "<namespace>:<действие>" (разделитель — первый ":"); callback ≤ 64 байта.
```

**Обработка клика:**
```js
api.registerInteractiveHandler({
  channel: "telegram",
  namespace: "editor",            // должен совпадать с префиксом value
  handler: async (ctx) => {
    const action = ctx.callback.payload;   // "publish" / "reject"
    const who    = ctx.senderId;           // кто нажал
    await ctx.respond.editMessage({ text: "…" });  // edit = без спама; есть .reply/.clearButtons
    return { handled: true };
  },
});
```

**before_dispatch:** перехват входящего текста — `event.content` = текст, `event.senderId` = кто; вернуть `{ handled: true, text }` или ничего. **Кнопки тут нельзя** — только из команды.

**Публикация в канал** — прямым вызовом Telegram Bot API токеном бота (отдельной обёртки у плагина нет; постит сам бот, он должен быть админом канала):
```js
await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: process.env.TELEGRAM_CHANNEL_ID,
    text: article,
    disable_web_page_preview: true,   // пост чистым текстом, без авто-картинки от первой ссылки
  }),
});
// ID канала формата -100XXXXXXXXXX (префикс -100 не дублировать).
```

> **Важно:** эхо-хук `before_dispatch` в `plugins/agent-stub/index.js` — временная заглушка-пруф. **Удали его**, иначе он перехватит весь входящий текст и твой агент не запустится. Этот файл — твоя рабочая зона; «обвязку» (Dockerfile, `deploy/entrypoint.sh`, имена переменных, способ запуска) не меняй.

## Правила

- **Без хардкода ключей.** Только переменные окружения (`.env.example`), реальные значения не коммитить.
- Статья — на **реальных источниках со ссылками** (не выдумывать факты/URL).
- **Без согласования человека не публиковать** в канал.
- Не менять имена переменных окружения и режим long-polling.
- Бот должен быть **админом твоего канала** (с правом публикации), иначе пост не пройдёт.

## Как сдавать

1. Создай свой репозиторий из шаблона («Use this template») или форкни.
2. Реализуй логику в отдельной ветке.
3. Пришли **ссылку на ветку** своего репозитория. Доступы/ключи мы не выдаём — проверяем на своей среде.

> **Репозиторий должен быть публичным и открываться по ссылке** (Settings → General → Visibility → **Public**).
> Если репо приватное или ссылка отдаёт 404 — мы не сможем его проверить и вернём без ревью.
> Проверь сам: открой ссылку в окне инкогнито — если репо виден, всё ок.

---

## Переменные окружения

Ровно 4 имени (заданы в среде, не в коде). См. `.env.example`.

| Переменная | Назначение |
|---|---|
| `OPENROUTER_API_KEY` | Ключ OpenRouter (LLM, формат OpenAI) |
| `SEARCH_API_KEY` | Ключ Tavily (поиск). Пробрасывается в `TAVILY_API_KEY` на старте |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather (long-polling) |
| `TELEGRAM_CHANNEL_ID` | ID канала публикации (бот — админ канала) |

> Токен gateway генерируется автоматически в `deploy/entrypoint.sh` — отдельная переменная не нужна.
> Для эхо-пруфа достаточно `TELEGRAM_BOT_TOKEN` + `OPENROUTER_API_KEY`; `SEARCH_API_KEY`/`TELEGRAM_CHANNEL_ID`
> нужны уже для реальной логики.

## Запуск

Одной командой (нужен установленный `openclaw` и заданные переменные окружения):

```bash
npm start          # = bash deploy/entrypoint.sh
```

## Деплой (Railway)

Образ собирается из **`Dockerfile`** (Railway/nixpacks сам глобальный `openclaw` не ставит — поэтому Dockerfile в шаблоне).
Gateway слушает `$PORT`, выдаваемый Railway. Состояние OpenClaw — `~/.openclaw`
(для устойчивости между рестартами смонтируй persistent-том на `OPENCLAW_STATE_DIR`).

---

## Структура

```
.
├── Dockerfile                     ← сборка образа (Railway)
├── package.json                   ← npm start → entrypoint
├── config.example.json            ← конфиг OpenClaw (без секретов)
├── .env.example                   ← 4 переменные окружения
├── deploy/
│   └── entrypoint.sh              ← готовит ~/.openclaw из env, стартует gateway
└── plugins/
    └── agent-stub/                ← каркасный плагин: эхо-пруф + TODO-пайплайн
        ├── index.js
        ├── openclaw.plugin.json
        └── package.json
```
