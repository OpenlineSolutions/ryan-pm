import { streamText, stepCountIs } from "ai";
import { getDb } from "@/lib/db";
import {
  makeSearchTasksTool,
  makeMoveTaskTool,
  makeDeleteTaskTool,
} from "@/lib/agent-tools";

export async function POST(req: Request) {
  const { message } = await req.json();

  if (!message || typeof message !== "string") {
    return new Response("Missing message", { status: 400 });
  }

  const sql = getDb();

  const [tasks, voiceLogs] = await Promise.all([
    sql`
      SELECT t.id, t.title, t.description, t.status, t.priority, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.created_at DESC LIMIT 50
    `,
    sql`
      SELECT transcript, processed_at FROM voice_logs
      ORDER BY processed_at DESC LIMIT 10
    `,
  ]);

  const taskContext = tasks
    .map(
      (t: any) =>
        `- ID:${t.id} [${t.status}] "${t.title}" (${t.priority})${t.project_name ? ` | ${t.project_name}` : ""}`
    )
    .join("\n");

  const voiceContext = voiceLogs
    .map(
      (v: any) =>
        `[${new Date(v.processed_at).toLocaleDateString()}] ${v.transcript}`
    )
    .join("\n\n");

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are an AI assistant for FlowBoard, a project management tool.

CRITICAL RULE: When the user mentions a task by name, call search_tasks FIRST to find it before acting. Never guess a task ID.

Decision flow:
1. User mentions a task → search_tasks → then move_task or delete_task
2. When uncertain → search_tasks first

Current Tasks:
${taskContext || "No tasks yet."}

Recent Voice Commands:
${voiceContext || "None yet."}

Keep responses concise. If you take an action, lead with a short confirmation sentence. If the user asks a question, answer it directly from the task context above.`,
    prompt: message,
    tools: {
      search_tasks: makeSearchTasksTool(sql),
      move_task: makeMoveTaskTool(sql),
      delete_task: makeDeleteTaskTool(sql),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toTextStreamResponse();
}
