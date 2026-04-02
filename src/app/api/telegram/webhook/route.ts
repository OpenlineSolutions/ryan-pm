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

// In-memory store for pending task approvals.
// Key: `${chatId}:${messageId}`, Value: extracted items + per-item approval state.
// This is fine for a prototype. For production, use a database or KV store.
const pendingApprovals = new Map<
  string,
  {
    items: ExtractedItem[];
    approved: boolean[]; // per-item approval state
  }
>();

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Verify this is from our allowed chat (basic auth)
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;

  // Handle text messages
  if (body.message?.text) {
    const chatId = String(body.message.chat.id);
    const messageText = body.message.text;

    // Only process messages from allowed chat
    if (allowedChatId && chatId !== allowedChatId) {
      console.log(`[Telegram] Ignoring message from unauthorized chat: ${chatId}`);
      return NextResponse.json({ ok: true });
    }

    // Ignore /start command
    if (messageText === "/start") {
      after(async () => {
        await sendMessage(
          chatId,
          "Hey! Send me any message and I'll extract tasks from it. " +
            "You can approve, edit, or reject them before they go to Notion."
        );
      });
      return NextResponse.json({ ok: true });
    }

    // Process in background after responding to Telegram
    after(async () => {
      await processMessage(chatId, messageText);
    });

    return NextResponse.json({ ok: true });
  }

  // Handle callback queries (button presses)
  if (body.callback_query) {
    const query = body.callback_query;
    const chatId = String(query.message.chat.id);
    const messageId = query.message.message_id;
    const data = query.data;

    // Acknowledge the button press immediately
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

    // Send "thinking" message
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

    // Build the approval message
    const { text, replyMarkup } = buildApprovalMessage(items);

    // Edit the thinking message with results
    const result = await editMessageText(chatId, thinkingMsg.result.message_id, text, {
      replyMarkup,
    });

    // Store pending approval state
    if (result.result?.message_id) {
      const key = `${chatId}:${result.result.message_id}`;
      pendingApprovals.set(key, {
        items,
        approved: items.map(() => true), // all approved by default
      });

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

// --- Callback Handling ---

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
    // Toggle individual task
    if (data.startsWith("toggle:")) {
      const index = parseInt(data.split(":")[1]);
      if (index >= 0 && index < pending.approved.length) {
        pending.approved[index] = !pending.approved[index];
      }

      // Update the message with new checkboxes
      const { text, replyMarkup } = buildApprovalMessage(
        pending.items,
        pending.approved
      );
      await editMessageText(chatId, messageId, text, { replyMarkup });
      await answerCallbackQuery(callbackQueryId);
      return;
    }

    // Approve selected tasks
    if (data === "approve_all") {
      const selectedItems = pending.items.filter((_, i) => pending.approved[i]);

      if (selectedItems.length === 0) {
        await answerCallbackQuery(callbackQueryId, "No tasks selected!");
        return;
      }

      await answerCallbackQuery(callbackQueryId, "Creating tasks...");

      const created: { title: string; url: string }[] = [];
      for (const item of selectedItems) {
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

      // Update message with confirmation
      const lines = created
        .map((t) => `  <a href="${t.url}">${escapeHtml(t.title)}</a>`)
        .join("\n");
      const confirmText =
        `<b>Added ${created.length} task${created.length === 1 ? "" : "s"} to Notion:</b>\n\n${lines}`;

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

    // Edit acknowledgment
    if (data === "edit") {
      await answerCallbackQuery(
        callbackQueryId,
        "Edit mode coming soon! For now, toggle individual tasks on/off."
      );
      return;
    }

    await answerCallbackQuery(callbackQueryId);
  } catch (err) {
    console.error("[Telegram] Callback error:", err);
    await answerCallbackQuery(callbackQueryId, "Something went wrong.");
  }
}

// --- Message Building ---

function getPriorityEmoji(priority: string): string {
  switch (priority) {
    case "Urgent":
      return "\u{1F6A8}"; // rotating light
    case "High":
      return "\u{1F534}"; // red circle
    case "Medium":
      return "\u{1F7E0}"; // orange circle
    case "Low":
      return "\u{26AA}"; // white circle
    default:
      return "\u{26AA}";
  }
}

function buildApprovalMessage(
  items: ExtractedItem[],
  approved?: boolean[]
): { text: string; replyMarkup: any } {
  const states = approved || items.map(() => true);

  const lines = items.map((item, i) => {
    const check = states[i] ? "\u2705" : "\u274C"; // green check or red X
    const emoji = getPriorityEmoji(item.priority);
    const project = item.project ? ` [${escapeHtml(item.project)}]` : "";
    const assignee = item.assignee ? ` - ${escapeHtml(item.assignee)}` : "";
    const due = item.due_date ? ` - ${item.due_date}` : "";
    return `${check} ${emoji} <b>${escapeHtml(item.title)}</b>${project}${assignee}${due}`;
  });

  const selectedCount = states.filter(Boolean).length;
  const header = `Found <b>${items.length}</b> task${items.length === 1 ? "" : "s"}. Tap to toggle, then approve.\n\n`;
  const footer = `\n\n<i>${selectedCount} of ${items.length} selected</i>`;
  const text = header + lines.join("\n") + footer;

  // Build inline keyboard
  // Row per task (toggle buttons)
  const toggleRows = items.map((item, i) => [
    {
      text: `${states[i] ? "\u2705" : "\u274C"} ${item.title.slice(0, 30)}`,
      callback_data: `toggle:${i}`,
    },
  ]);

  // Action row
  const actionRow = [
    { text: `Approve (${selectedCount})`, callback_data: "approve_all" },
    { text: "Edit", callback_data: "edit" },
    { text: "Reject", callback_data: "reject_all" },
  ];

  const replyMarkup = {
    inline_keyboard: [...toggleRows, actionRow],
  };

  return { text, replyMarkup };
}
