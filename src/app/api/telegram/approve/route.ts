import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/notion-tasks";
import { sendMessage, escapeHtml } from "@/lib/telegram";

type ApproveTaskInput = {
  title: string;
  description?: string;
  steps?: string[];
  project: string | null;
  assignee: string | null;
  priority: string;
  due_date: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tasks, chatId } = body as {
      tasks: ApproveTaskInput[];
      chatId: string;
    };

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json(
        { error: "No tasks provided" },
        { status: 400 }
      );
    }

    if (!chatId) {
      return NextResponse.json(
        { error: "No chatId provided" },
        { status: 400 }
      );
    }

    const created: { title: string; url: string }[] = [];

    for (const task of tasks) {
      const result = await createTask({
        title: task.title,
        status: "Inbox",
        project: task.project === "Internal" ? null : task.project,
        priority: task.priority || "Medium",
        assignee: task.assignee,
        dueDate: task.due_date,
        source: "Telegram",
        notes: task.description,
        steps: task.steps || [],
      });
      created.push({ title: task.title, url: result.url });
    }

    // Send confirmation to Telegram chat
    const lines = created
      .map((t) => `  <a href="${t.url}">${escapeHtml(t.title)}</a>`)
      .join("\n");
    const confirmText = `<b>Added ${created.length} task${created.length === 1 ? "" : "s"} to Notion:</b>\n\n${lines}`;

    await sendMessage(chatId, confirmText);

    return NextResponse.json({
      ok: true,
      created: created.length,
    });
  } catch (err) {
    console.error("[Approve] Error:", err);
    return NextResponse.json(
      { error: "Failed to create tasks" },
      { status: 500 }
    );
  }
}
