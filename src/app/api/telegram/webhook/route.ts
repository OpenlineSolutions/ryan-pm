import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { extractItems, ExtractedItem } from "@/lib/categorize";
import { createTask } from "@/lib/notion-tasks";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  escapeHtml,
} from "@/lib/telegram";

// In-memory store for quick-approve flow only (keyed by chatId:messageId).
// The Mini App flow uses base64-encoded data in the URL instead.
type PendingState = {
  items: ExtractedItem[];
};

const pendingApprovals = new Map<string, PendingState>();

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ryan-pm.vercel.app";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedChatId = process.env.TELEGRAM_CHAT_ID;

  // Handle text messages (including web_app_data)
  if (body.message) {
    const chatId = String(body.message.chat.id);

    // Only process messages from allowed chat
    if (allowedChatId && chatId !== allowedChatId) {
      console.log(`[Telegram] Ignoring message from unauthorized chat: ${chatId}`);
      return NextResponse.json({ ok: true });
    }

    // Handle web_app_data from Mini App
    if (body.message.web_app_data) {
      after(async () => {
        await handleWebAppData(chatId, body.message.web_app_data.data);
      });
      return NextResponse.json({ ok: true });
    }

    // Handle regular text messages
    if (body.message.text) {
      const messageText = body.message.text;

      // Ignore /start command
      if (messageText === "/start") {
        after(async () => {
          await sendMessage(
            chatId,
            "Hey! Send me any message and I'll extract tasks from it. " +
              "You can edit them in a form before they go to Notion."
          );
        });
        return NextResponse.json({ ok: true });
      }

      after(async () => {
        await processMessage(chatId, messageText);
      });

      return NextResponse.json({ ok: true });
    }
  }

  // Handle callback queries (Quick Approve / Reject buttons)
  if (body.callback_query) {
    const query = body.callback_query;
    const chatId = String(query.message.chat.id);
    const messageId = query.message.message_id;
    const data = query.data;

    after(async () => {
      await handleCallback(chatId, messageId, data, query.id);
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

// --- Message Processing ---

async function processMessage(chatId: string, messageText: string) {
  try {
    console.log(`[Telegram] Processing message: "${messageText.slice(0, 100)}"`);

    const thinkingMsg = await sendMessage(chatId, "Analyzing your message...");

    const items = await extractItems(messageText);

    if (items.length === 0) {
      if (thinkingMsg.result?.message_id) {
        await editMessageText(
          chatId,
          thinkingMsg.result.message_id,
          "No actionable items found in your message."
        );
      }
      return;
    }

    console.log(`[Telegram] Found ${items.length} items`);

    // Build the task summary text
    const lines = items.map((item, i) => {
      const emoji = getPriorityEmoji(item.priority);
      const project = item.project ? ` [${escapeHtml(item.project)}]` : "";
      const assignee = item.assignee ? ` \u2192 ${escapeHtml(item.assignee)}` : "";
      const due = item.due_date ? ` \uD83D\uDCC5 ${item.due_date}` : "";
      return `${i + 1}. ${emoji} <b>${escapeHtml(item.title)}</b>${project}${assignee}${due}`;
    });

    const text =
      `Found <b>${items.length}</b> task${items.length === 1 ? "" : "s"}:\n\n` +
      lines.join("\n") +
      `\n\n<i>Tap "Edit & Approve" to review in a form, or quick approve all.</i>`;

    // Encode task data as base64 for the Mini App URL
    const payload = {
      tasks: items,
      chatId,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const miniAppUrl = `${APP_URL}/telegram?data=${encoded}&chat=${chatId}`;

    // Build inline keyboard with Mini App button + Quick Approve + Reject
    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "\uD83D\uDCDD Edit & Approve",
            web_app: { url: miniAppUrl },
          },
        ],
        [
          {
            text: `\u2705 Quick Approve All (${items.length})`,
            callback_data: "approve_all",
          },
          {
            text: "\u274C Reject",
            callback_data: "reject_all",
          },
        ],
      ],
    };

    const result = await editMessageText(
      chatId,
      thinkingMsg.result.message_id,
      text,
      { replyMarkup }
    );

    // Store items for quick-approve flow
    if (result.result?.message_id) {
      const key = `${chatId}:${result.result.message_id}`;
      pendingApprovals.set(key, { items });

      // Clean up old approvals (keep last 50)
      if (pendingApprovals.size > 50) {
        const keys = Array.from(pendingApprovals.keys());
        for (let i = 0; i < keys.length - 50; i++) {
          pendingApprovals.delete(keys[i]);
        }
      }
    }
  } catch (err) {
    console.error("[Telegram] Error processing message:", err);
    await sendMessage(chatId, "Sorry, something went wrong processing your message.");
  }
}

// --- Handle Mini App web_app_data ---

async function handleWebAppData(chatId: string, dataStr: string) {
  try {
    const data = JSON.parse(dataStr);
    const tasks = data.tasks as ExtractedItem[];

    if (!tasks || tasks.length === 0) {
      await sendMessage(chatId, "No tasks received from the form.");
      return;
    }

    const created: { title: string; url: string }[] = [];
    for (const item of tasks) {
      const result = await createTask({
        title: item.title,
        status: "Inbox",
        project: item.project === "Internal" ? null : item.project,
        priority: item.priority,
        assignee: item.assignee,
        dueDate: item.due_date,
        source: "Telegram",
        notes: item.description,
        steps: item.steps || [],
      });
      created.push({ title: item.title, url: result.url });
    }

    const lines = created
      .map((t) => `  <a href="${t.url}">${escapeHtml(t.title)}</a>`)
      .join("\n");
    const confirmText = `<b>Added ${created.length} task${created.length === 1 ? "" : "s"} to Notion:</b>\n\n${lines}`;

    await sendMessage(chatId, confirmText);
  } catch (err) {
    console.error("[Telegram] web_app_data error:", err);
    await sendMessage(chatId, "Something went wrong processing the form data.");
  }
}

// --- Callback Handling (Quick Approve / Reject only) ---

async function handleCallback(
  chatId: string,
  messageId: number,
  data: string,
  callbackQueryId: string
) {
  const key = `${chatId}:${messageId}`;
  const pending = pendingApprovals.get(key);

  if (!pending) {
    await answerCallbackQuery(callbackQueryId, "This approval has expired.");
    return;
  }

  try {
    // Quick approve all tasks
    if (data === "approve_all") {
      await answerCallbackQuery(callbackQueryId, "Creating tasks...");

      const created: { title: string; url: string }[] = [];
      for (const item of pending.items) {
        const result = await createTask({
          title: item.title,
          status: "Inbox",
          project: item.project === "Internal" ? null : item.project,
          priority: item.priority,
          assignee: item.assignee,
          dueDate: item.due_date,
          source: "Telegram",
          notes: item.description,
          steps: item.steps || [],
        });
        created.push({ title: item.title, url: result.url });
      }

      const lines = created
        .map((t) => `  <a href="${t.url}">${escapeHtml(t.title)}</a>`)
        .join("\n");
      const confirmText = `<b>Added ${created.length} task${created.length === 1 ? "" : "s"} to Notion:</b>\n\n${lines}`;

      await editMessageText(chatId, messageId, confirmText);
      pendingApprovals.delete(key);
      return;
    }

    // Reject all
    if (data === "reject_all") {
      await editMessageText(chatId, messageId, "Rejected. No tasks created.");
      pendingApprovals.delete(key);
      await answerCallbackQuery(callbackQueryId, "Rejected");
      return;
    }

    await answerCallbackQuery(callbackQueryId);
  } catch (err) {
    console.error("[Telegram] Callback error:", err);
    await answerCallbackQuery(callbackQueryId, "Something went wrong.");
  }
}

// --- Helpers ---

function getPriorityEmoji(priority: string): string {
  switch (priority) {
    case "Urgent":
      return "\uD83D\uDEA8";
    case "High":
      return "\uD83D\uDD34";
    case "Medium":
      return "\uD83D\uDFE0";
    case "Low":
      return "\u26AA";
    default:
      return "\u26AA";
  }
}
