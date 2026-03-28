import { streamText } from "ai";
import { getDb } from "@/lib/db";

export async function POST(req: Request) {
  const { message } = await req.json();

  if (!message || typeof message !== "string") {
    return new Response("Missing message", { status: 400 });
  }

  const sql = getDb();

  const voiceLogs = await sql`
    SELECT transcript, processed_at FROM voice_logs
    ORDER BY processed_at DESC LIMIT 20
  `;

  const tasks = await sql`
    SELECT t.title, t.description, t.status, t.priority, p.name as project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    ORDER BY t.created_at DESC LIMIT 50
  `;

  const voiceContext = voiceLogs
    .map((v: any) => `[${new Date(v.processed_at).toLocaleDateString()}] ${v.transcript}`)
    .join("\n\n");

  const taskContext = tasks
    .map((t: any) => `- [${t.status}] ${t.title} (${t.priority})${t.project_name ? ` | Project: ${t.project_name}` : ""}`)
    .join("\n");

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are an AI assistant for a project management tool. You have access to the user's voice logs and task board.

Answer questions about their tasks, priorities, and what they've discussed. Be concise and actionable.

Current Tasks:
${taskContext || "No tasks yet."}

Recent Voice Logs:
${voiceContext || "No voice logs yet."}`,
    prompt: message,
  });

  return result.toTextStreamResponse();
}
