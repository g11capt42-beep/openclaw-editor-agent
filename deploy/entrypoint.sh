#!/usr/bin/env bash
# OpenClaw editor-agent (template) — запуск на сервере (Railway/Docker).
# Готовит ~/.openclaw из переменных окружения и стартует gateway (Telegram long-polling).
# Секреты — только из env, не из git.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
mkdir -p "$STATE_DIR" "$STATE_DIR/skills"

# ── обязательно для старта (FAIL-FAST) ──
: "${TELEGRAM_BOT_TOKEN:?нужен TELEGRAM_BOT_TOKEN}"   # нативный env-fallback OpenClaw (telegram)
: "${OPENROUTER_API_KEY:?нужен OPENROUTER_API_KEY}"   # нативный env-fallback OpenClaw (openrouter)

# ── нужно логике кандидата (старт/эхо НЕ блокируем — только предупреждаем) ──
: "${SEARCH_API_KEY:=}"
[ -n "$SEARCH_API_KEY" ]      || echo "[warn] SEARCH_API_KEY пуст — поиск (Tavily) не заработает, пока кандидат не задаст ключ"
: "${TELEGRAM_CHANNEL_ID:=}"
[ -n "$TELEGRAM_CHANNEL_ID" ] || echo "[warn] TELEGRAM_CHANNEL_ID пуст — публикация в канал недоступна, пока не задан"

# ── мост: нативный tavily-плагин читает TAVILY_API_KEY, а ТЗ диктует SEARCH_API_KEY ──
export TAVILY_API_KEY="${TAVILY_API_KEY:-$SEARCH_API_KEY}"
export TELEGRAM_CHANNEL_ID

# ── gateway-токен: auth обязателен по умолчанию; генерим сами, чтобы шаблон жил на 4 env-именах ──
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')}"

# ── конфиг: шаблон -> ~/.openclaw/openclaw.json; load.paths подставляем под фактический APP_DIR ──
APP_DIR="$APP_DIR" STATE_DIR="$STATE_DIR" node -e '
const fs=require("fs"), path=require("path");
const app=process.env.APP_DIR, state=process.env.STATE_DIR;
const cfg=JSON.parse(fs.readFileSync(path.join(app,"config.example.json"),"utf8"));
cfg.plugins.load.paths=[path.join(app,"plugins","agent-stub")];
fs.writeFileSync(path.join(state,"openclaw.json"), JSON.stringify(cfg,null,2));
'
chmod 600 "$STATE_DIR/openclaw.json"

export OPENCLAW_STATE_DIR="$STATE_DIR"
exec openclaw gateway --port "${OPENCLAW_GATEWAY_PORT:-${PORT:-18789}}"
