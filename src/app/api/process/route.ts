import { generateText, Output } from "ai";
import { getDb } from "@/lib/db";
import { extractedTaskSchema } from "@/lib/schema";

export async function POST(req: Request) {
  const { transcript } = await req.json();

  if (!transcript || typeof transcript !== "string") {
    return new Response("Missing transcript", { status: 400 });
  }

  const sql = getDb();

  // Get known projects for context
  const projects = await sql`SELECT id, name FROM projects ORDER BY name`;
  const projectNames = projects.map((p: any) => p.name);

  // Store the voice log
  const [voiceLog] = await sql`
    INSERT INTO voice_logs (transcript, task_count)
    VALUES (${transcript}, 0)
    RETURNING id
  `;
  const voiceLogId = voiceLog?.id;

  // Use AI to extract tasks
  const { experimental_output: extracted } = await generateText({
    model: "anthropic/claude-sonnet-4.6" as any,
    output: Output.object({ schema: extractedTaskSchema }),
    prompt: `You are a project management AI. Extract actionable tasks from the following voice transcript or text dump.

Known projects: ${projectNames.join(", ")}

Rules:
- Extract only clear action items, not observations or opinions
- Match tasks to the most relevant known project, or use "Uncategorized"
- Set priority based on urgency cues (deadlines = high, "remind me" = medium, general = low)
- If a due date is mentioned or implied, include it in YYYY-MM-DD format
- Keep titles short and actionable (start with a verb)
- Keep descriptions brief (1 sentence)

Transcript:
"""
${transcript}
"""`,
  });

  if (extracted?.tasks && voiceLogId) {
    for (const task of extracted.tasks) {
      const matched = projects.find((p: any) =>
        p.name.toLowerCase().includes(task.project.toLowerCase()) ||
        task.project.toLowerCase().includes(p.name.toLowerCase())
      );

      await sql`
        INSERT INTO tasks (title, description, project_id, priority, status, approved, voice_log_id)
        VALUES (
          ${task.title},
          ${task.description},
          ${matched?.id ?? null},
          ${task.priority},
          'inbox',
          false,
          ${voiceLogId}
        )
      `;
    }

    await sql`
      UPDATE voice_logs SET task_count = ${extracted.tasks.length} WHERE id = ${voiceLogId}
    `;
  }

  return Response.json({ ok: true, taskCount: extracted?.tasks?.length ?? 0 });
}
