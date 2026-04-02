const TELEGRAM_API = "https://api.telegram.org/bot";

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return token;
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: {
    replyMarkup?: any;
    parseMode?: "HTML" | "MarkdownV2";
  }
): Promise<any> {
  const token = getToken();
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode || "HTML",
  };
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("[Telegram] sendMessage failed:", data.description);
  }
  return data;
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: {
    replyMarkup?: any;
    parseMode?: "HTML" | "MarkdownV2";
  }
): Promise<any> {
  const token = getToken();
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options?.parseMode || "HTML",
  };
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  const res = await fetch(`${TELEGRAM_API}${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("[Telegram] editMessageText failed:", data.description);
  }
  return data;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<any> {
  const token = getToken();
  const body: any = { callback_query_id: callbackQueryId };
  if (text) body.text = text;

  const res = await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}

// Escape special characters for HTML parse mode
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
