#!/bin/bash
# Sets the Telegram webhook URL for the FlowBoard bot.
# Reads TELEGRAM_BOT_TOKEN from .env.local or environment.
#
# Usage:
#   ./scripts/setup-telegram-webhook.sh
#   ./scripts/setup-telegram-webhook.sh https://your-custom-url.vercel.app

# Load from .env.local if it exists
if [ -f .env.local ]; then
  BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN .env.local | cut -d '=' -f2)
fi

# Allow env override
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$BOT_TOKEN}"

if [ -z "$BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found. Set it in .env.local or environment."
  exit 1
fi

BASE_URL="${1:-https://ryan-pm.vercel.app}"
WEBHOOK_URL="${BASE_URL}/api/telegram/webhook"

echo "Setting Telegram webhook to: ${WEBHOOK_URL}"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}" | python3 -m json.tool

echo ""
echo "Done. To verify:"
echo "  curl https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/getWebhookInfo | python3 -m json.tool"
