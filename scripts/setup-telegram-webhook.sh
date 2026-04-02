#!/bin/bash
# Sets the Telegram webhook URL for the FlowBoard bot.
# Run this once after deploying to Vercel (or after changing the URL).
#
# Usage:
#   ./scripts/setup-telegram-webhook.sh
#   ./scripts/setup-telegram-webhook.sh https://your-custom-url.vercel.app

BOT_TOKEN="8607679918:AAFob4szzFzgOtkFRVsQzRG68O38DKon8CM"
BASE_URL="${1:-https://ryan-pm.vercel.app}"
WEBHOOK_URL="${BASE_URL}/api/telegram/webhook"

echo "Setting Telegram webhook to: ${WEBHOOK_URL}"

curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}" | python3 -m json.tool

echo ""
echo "Done. To verify:"
echo "  curl https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo | python3 -m json.tool"
