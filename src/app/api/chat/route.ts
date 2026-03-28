import { streamText, stepCountIs } from "ai";
import { getDb } from "@/lib/db";
import { z } from "zod";

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

  // Include IDs so the AI knows what to pass to tools
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
    system: `You are an AI assistant for a project management tool called FlowBoard. You can answer questions AND take direct actions on the task board.

Current Tasks (with IDs):
${taskContext || "No tasks yet."}

Recent Voice Logs:
${voiceContext || "No voice logs yet."}

When the user asks you to move, complete, or delete a task:
1. Find the best matching task by title — fuzzy matching is fine
2. Call the appropriate tool with the task's ID
3. Confirm what you did in one short sentence

Keep responses concise. If you take an action, lead with the confirmation.`,
    prompt: message,
    tools: {
      move_task: {
        description:
          "Move a task to a different column. Use this to mark tasks as done, start them, approve them, etc.",
        inputSchema: z.object({
          taskId: z.string().describe("The ID of the task (from the task list above)"),
          newStatus: z
            .enum(["inbox", "todo", "in_progress", "done"])
            .describe("The target column"),
        }),
        execute: async ({ taskId, newStatus }) => {
          try {
            await sql`
              UPDATE tasks
              SET status = ${newStatus}, approved = ${newStatus !== "inbox"}
              WHERE id = ${taskId}
            `;
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      delete_task: {
        description: "Delete a task from the board entirely.",
        inputSchema: z.object({
          taskId: z.string().describe("The ID of the task to delete"),
        }),
        execute: async ({ taskId }) => {
          try {
            await sql`DELETE FROM tasks WHERE id = ${taskId}`;
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
    },
    stopWhen: stepCountIs(5),
  });

  return result.toTextStreamResponse();
}
