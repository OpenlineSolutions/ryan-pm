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
const PROJECTS = ["McDonalds", "Burger King", "In-N-Out", "Chick-fil-A", "Chipotle", "Internal"];
const ASSIGNEES = ["Ryan", "Sarah", "Jake", "Mike"];
const PRIORITIES = ["Urgent", "High", "Medium", "Low"];

type PendingState = {
  items: ExtractedItem[];
  approved: boolean[];
  editingIndex: number | null; // which task is being edited
  editingField: string | null; // which field is being edited
};

const pendingApprovals = new Map<string, PendingState>();

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

    // Store pending state first
    const pendingState: PendingState = {
      items,
      approved: items.map(() => true),
      editingIndex: null,
      editingField: null,
    };

    // Build the approval message
    const { text, replyMarkup } = buildApprovalMessage(pendingState);

    // Edit the thinking message with results
    const result = await editMessageText(chatId, thinkingMsg.result.message_id, text, {
      replyMarkup,
    });

    // Store pending approval state
    if (result.result?.message_id) {
      const key = `${chatId}:${result.result.message_id}`;
      pendingApprovals.set(key, pendingState);

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
      pending.editingIndex = null;
      pending.editingField = null;

      const { text, replyMarkup } = buildApprovalMessage(pending);
      await editMessageText(chatId, messageId, text, { replyMarkup });
      await answerCallbackQuery(callbackQueryId);
      return;
    }

    // Enter edit mode for a specific task
    if (data.startsWith("edit:")) {
      const index = parseInt(data.split(":")[1]);
      pending.editingIndex = index;
      pending.editingField = null;

      const { text, replyMarkup } = buildEditTaskMessage(pending, index);
      await editMessageText(chatId, messageId, text, { replyMarkup });
      await answerCallbackQuery(callbackQueryId);
      return;
    }

    // Pick which field to edit
    if (data.startsWith("editfield:")) {
      const field = data.split(":")[1];
      pending.editingField = field;

      const { text, replyMarkup } = buildFieldPickerMessage(pending, pending.editingIndex!, field);
      await editMessageText(chatId, messageId, text, { replyMarkup });
      await answerCallbackQuery(callbackQueryId);
      return;
    }

    // Set a field value
    if (data.startsWith("setval:")) {
      const parts = data.split(":");
      const field = parts[1];
      const value = parts.slice(2).join(":");
      const idx = pending.editingIndex!;
      const item = pending.items[idx];

      if (field === "project") item.project = value === "None" ? null : value as any;
      else if (field === "assignee") item.assignee = value === "None" ? null : value;
      else if (field === "priority") item.priority = value as any;
      else if (field === "due") item.due_date = value === "None" ? null : value;

      // Go back to edit task view
      pending.editingField = null;
      const { text, replyMarkup } = buildEditTaskMessage(pending, idx);
      await editMessageText(chatId, messageId, text, { replyMarkup });
      await answerCallbackQuery(callbackQueryId, `Set ${field} to ${value}`);
      return;
    }

    // Back to main approval view
    if (data === "back") {
      pending.editingIndex = null;
      pending.editingField = null;

      const { text, replyMarkup } = buildApprovalMessage(pending);
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

function buildApprovalMessage(pending: PendingState): { text: string; replyMarkup: any } {
  const { items, approved } = pending;

  const lines = items.map((item, i) => {
    const check = approved[i] ? "\u2705" : "\u274C";
    const emoji = getPriorityEmoji(item.priority);
    const project = item.project ? ` [${escapeHtml(item.project)}]` : "";
    const assignee = item.assignee ? ` \u2192 ${escapeHtml(item.assignee)}` : "";
    const due = item.due_date ? ` \u{1F4C5} ${item.due_date}` : "";
    return `${check} ${emoji} <b>${escapeHtml(item.title)}</b>${project}${assignee}${due}`;
  });

  const selectedCount = approved.filter(Boolean).length;
  const header = `Found <b>${items.length}</b> task${items.length === 1 ? "" : "s"}:\n\n`;
  const footer = `\n\n<i>${selectedCount} of ${items.length} selected</i>`;
  const text = header + lines.join("\n") + footer;

  // Two buttons per task: toggle + edit
  const taskRows = items.map((item, i) => [
    {
      text: `${approved[i] ? "\u2705" : "\u274C"} ${item.title.slice(0, 25)}`,
      callback_data: `toggle:${i}`,
    },
    {
      text: "\u270F\uFE0F Edit",
      callback_data: `edit:${i}`,
    },
  ]);

  const actionRow = [
    { text: `\u2705 Approve (${selectedCount})`, callback_data: "approve_all" },
    { text: "\u274C Reject", callback_data: "reject_all" },
  ];

  return {
    text,
    replyMarkup: { inline_keyboard: [...taskRows, actionRow] },
  };
}

function buildEditTaskMessage(
  pending: PendingState,
  index: number
): { text: string; replyMarkup: any } {
  const item = pending.items[index];
  const text =
    `\u270F\uFE0F <b>Editing:</b> ${escapeHtml(item.title)}\n\n` +
    `<b>Project:</b> ${item.project || "None"}\n` +
    `<b>Assignee:</b> ${item.assignee || "None"}\n` +
    `<b>Priority:</b> ${getPriorityEmoji(item.priority)} ${item.priority}\n` +
    `<b>Due:</b> ${item.due_date || "None"}\n\n` +
    `Tap a field to change it:`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: `\u{1F4C1} Project: ${item.project || "None"}`, callback_data: "editfield:project" },
      ],
      [
        { text: `\u{1F464} Assignee: ${item.assignee || "None"}`, callback_data: "editfield:assignee" },
      ],
      [
        { text: `${getPriorityEmoji(item.priority)} Priority: ${item.priority}`, callback_data: "editfield:priority" },
      ],
      [
        { text: `\u{1F4C5} Due: ${item.due_date || "None"}`, callback_data: "editfield:due" },
      ],
      [{ text: "\u2B05\uFE0F Back", callback_data: "back" }],
    ],
  };

  return { text, replyMarkup };
}

function buildFieldPickerMessage(
  pending: PendingState,
  index: number,
  field: string
): { text: string; replyMarkup: any } {
  const item = pending.items[index];
  let options: string[] = [];
  let label = "";

  if (field === "project") {
    options = [...PROJECTS, "None"];
    label = "Project";
  } else if (field === "assignee") {
    options = [...ASSIGNEES, "None"];
    label = "Assignee";
  } else if (field === "priority") {
    options = [...PRIORITIES];
    label = "Priority";
  } else if (field === "due") {
    // Quick date options
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const addDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
    options = [
      fmt(today),
      fmt(addDays(1)),
      fmt(addDays(3)),
      fmt(addDays(7)),
      "None",
    ];
    label = "Due Date";
  }

  const text =
    `\u270F\uFE0F <b>${escapeHtml(item.title)}</b>\n\n` +
    `Pick a <b>${label}</b>:`;

  // Two buttons per row
  const rows: any[][] = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = [{ text: options[i], callback_data: `setval:${field}:${options[i]}` }];
    if (options[i + 1]) {
      row.push({ text: options[i + 1], callback_data: `setval:${field}:${options[i + 1]}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "\u2B05\uFE0F Back", callback_data: `edit:${index}` }]);

  return { text, replyMarkup: { inline_keyboard: rows } };
}
