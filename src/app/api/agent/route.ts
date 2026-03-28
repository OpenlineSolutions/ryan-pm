import { streamText, stepCountIs } from "ai";
import { getDb } from "@/lib/db";
import {
  makeSearchTasksTool,
  makeMoveTaskTool,
  makeDeleteTaskTool,
  makeCreateTaskTool,
} from "@/lib/agent-tools";

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

  const createTool = makeCreateTaskTool(sql, projects as any, voiceLogId);
  const originalExecute = createTool.execute;
  const wrappedCreate = {
    ...createTool,
    execute: async (args: Parameters<typeof originalExecute>[0]) => {
      const result = await originalExecute(args);
      if ((result as any).success) tasksCreated++;
      return result;
    },
  };

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are an AI assistant for a voice-first project management tool called FlowBoard.

CRITICAL RULE: When the user mentions any task by name, ALWAYS call search_tasks FIRST to check if it already exists. If a matching task is found, move or update it — do NOT create a new one. Only call create_task for genuinely new work that has no match on the board.

Decision flow:
1. User mentions an existing task → search_tasks → then move_task or delete_task
2. User describes brand-new work → search_tasks to confirm it's new → if not found, create_task
3. When uncertain → search_tasks first

Available tools (use in this order):
1. search_tasks — ALWAYS call first when any task name is mentioned
2. move_task — move a found task to inbox, todo, in_progress, or done
3. create_task — only for genuinely new items not already on the board
4. delete_task — remove a task

Known projects: ${projectNames || "none yet"}

Current board:
${taskContext || "No tasks yet."}

Rules for creating tasks:
- Only extract clear action items, not observations or opinions
- Match to a known project or leave as Uncategorized
- Priority: high if urgent/deadline mentioned, low if vague, medium otherwise
- Keep titles short and starting with a verb

As you work, narrate each step in real-time — these messages stream live so the user sees your work as it happens:
- When searching: "Looking for '[query]' on the board..."
- When you find a match: "Found it — '[title]' is currently in [status]."
- When acting: "Moving it to [new status]..." or "Creating '[title]' in Inbox..."
- If nothing found: "Couldn't find a match for '[query]' — creating a new task instead."
- Final line: one short confirmation sentence of everything you did.

Keep each line brief. Separate steps with line breaks so they appear progressively.`,
    prompt: transcript,
    tools: {
      search_tasks: makeSearchTasksTool(sql),
      create_task: wrappedCreate,
      move_task: makeMoveTaskTool(sql),
      delete_task: makeDeleteTaskTool(sql),
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
