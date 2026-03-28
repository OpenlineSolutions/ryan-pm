import { streamText, stepCountIs } from "ai";
import { getDb } from "@/lib/db";
import { z } from "zod";

export async function POST(req: Request) {
  const { transcript } = await req.json();

  if (!transcript || typeof transcript !== "string") {
    return new Response("Missing transcript", { status: 400 });
  }

  const sql = getDb();

  const [tasks, projects] = await Promise.all([
    sql`
      SELECT t.id, t.title, t.status, t.priority, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.created_at DESC LIMIT 50
    `,
    sql`SELECT id, name FROM projects ORDER BY name`,
  ]);

  // Store voice log
  const [voiceLog] = await sql`
    INSERT INTO voice_logs (transcript, task_count)
    VALUES (${transcript}, 0)
    RETURNING id
  `;
  const voiceLogId = voiceLog?.id;

  const projectNames = projects.map((p: any) => p.name).join(", ");
  const taskContext = tasks
    .map(
      (t: any) =>
        `- ID:${t.id} [${t.status}] "${t.title}" (${t.priority})${t.project_name ? ` | ${t.project_name}` : ""}`
    )
    .join("\n");

  let tasksCreated = 0;

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are a smart AI assistant for a voice-first project management tool. The user spoke something — figure out what they want and act on it.

You can:
- Create new tasks (action items the user mentioned)
- Move existing tasks to a different column
- Delete tasks
- Do multiple things at once

Known projects: ${projectNames}

Current board tasks (with IDs):
${taskContext || "No tasks yet."}

Rules for creating tasks:
- Only extract clear action items, not observations or opinions
- Match to a known project or use "Uncategorized"
- Priority: high if urgent/deadline mentioned, low if vague, medium otherwise
- Keep titles short and starting with a verb

After taking all actions, reply with one short sentence confirming what you did.
Examples: "Created 3 tasks and moved the standup to Done." / "Marked 2 tasks as complete." / "Added a new task for Joy Dental."`,
    prompt: transcript,
    tools: {
      create_task: {
        description: "Create a new task in the Inbox",
        inputSchema: z.object({
          title: z.string().describe("Short, actionable task title starting with a verb"),
          description: z.string().describe("Brief one-sentence description"),
          project: z.string().describe("Project name from the known list, or 'Uncategorized'"),
          priority: z.enum(["high", "medium", "low"]),
        }),
        execute: async ({ title, description, project, priority }) => {
          try {
            const matched = projects.find(
              (p: any) =>
                p.name.toLowerCase().includes(project.toLowerCase()) ||
                project.toLowerCase().includes(p.name.toLowerCase())
            );
            await sql`
              INSERT INTO tasks (title, description, project_id, priority, status, approved, voice_log_id)
              VALUES (${title}, ${description}, ${matched?.id ?? null}, ${priority}, 'inbox', false, ${voiceLogId})
            `;
            tasksCreated++;
            return { success: true, title };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      move_task: {
        description: "Move an existing task to a different column",
        inputSchema: z.object({
          taskId: z.string().describe("The ID of the task"),
          newStatus: z.enum(["inbox", "todo", "in_progress", "done"]),
        }),
        execute: async ({ taskId, newStatus }) => {
          try {
            await sql`
              UPDATE tasks SET status = ${newStatus}, approved = ${newStatus !== "inbox"}
              WHERE id = ${taskId}
            `;
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      delete_task: {
        description: "Delete a task from the board",
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
    stopWhen: stepCountIs(10),
    onFinish: async () => {
      if (tasksCreated > 0 && voiceLogId) {
        await sql`UPDATE voice_logs SET task_count = ${tasksCreated} WHERE id = ${voiceLogId}`;
      }
    },
  });

  return result.toTextStreamResponse();
}
