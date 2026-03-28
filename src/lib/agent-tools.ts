import { z } from "zod";
import { getDb } from "@/lib/db";

type Sql = ReturnType<typeof getDb>;

export function makeSearchTasksTool(sql: Sql) {
  return {
    description:
      "Search for existing tasks by title (fuzzy match). Call this FIRST when the user mentions any task by name.",
    inputSchema: z.object({
      query: z.string().describe("The task title or partial title to search for"),
    }),
    execute: async ({ query }: { query: string }) => {
      const results = await sql`
        SELECT id, title, status, priority FROM tasks
        WHERE title ILIKE ${"%" + query + "%"}
        ORDER BY created_at DESC LIMIT 10
      `;
      return { tasks: results };
    },
  };
}

export function makeMoveTaskTool(sql: Sql) {
  return {
    description:
      "Move an existing task to a different column. Use search_tasks first to get the task ID.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task (from search_tasks results)"),
      newStatus: z
        .enum(["inbox", "todo", "in_progress", "done"])
        .describe("The target column"),
    }),
    execute: async ({ taskId, newStatus }: { taskId: string; newStatus: string }) => {
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
  };
}

export function makeDeleteTaskTool(sql: Sql) {
  return {
    description: "Delete a task from the board entirely.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to delete"),
    }),
    execute: async ({ taskId }: { taskId: string }) => {
      try {
        await sql`DELETE FROM tasks WHERE id = ${taskId}`;
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  };
}

export function makeCreateTaskTool(
  sql: Sql,
  projects: { id: string; name: string }[],
  voiceLogId?: string
) {
  return {
    description:
      "Create a brand-new task in the Inbox. Only call this for genuinely new work items — NEVER for tasks that already exist on the board.",
    inputSchema: z.object({
      title: z.string().describe("Short, actionable task title starting with a verb"),
      description: z.string().describe("Brief one-sentence description"),
      project: z
        .string()
        .describe("Project name from the known list, or 'Uncategorized'"),
      priority: z.enum(["high", "medium", "low"]),
    }),
    execute: async ({
      title,
      description,
      project,
      priority,
    }: {
      title: string;
      description: string;
      project: string;
      priority: string;
    }) => {
      try {
        const matched = projects.find(
          (p) =>
            p.name.toLowerCase().includes(project.toLowerCase()) ||
            project.toLowerCase().includes(p.name.toLowerCase())
        );
        await sql`
          INSERT INTO tasks (title, description, project_id, priority, status, approved, voice_log_id)
          VALUES (${title}, ${description}, ${matched?.id ?? null}, ${priority}, 'inbox', false, ${voiceLogId ?? null})
        `;
        return { success: true, title };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
  };
}
