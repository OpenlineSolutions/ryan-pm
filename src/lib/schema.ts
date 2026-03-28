import { z } from "zod";

export const extractedTaskSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().describe("Short, actionable task title"),
      description: z
        .string()
        .describe("Brief description of what needs to be done"),
      project: z
        .string()
        .describe(
          "Best matching project name from the known projects list, or 'Uncategorized'"
        ),
      priority: z.enum(["high", "medium", "low"]).describe("Task urgency"),
      dueDate: z
        .string()
        .optional()
        .describe("Due date if mentioned (YYYY-MM-DD format)"),
    })
  ),
});

export type ExtractedTasks = z.infer<typeof extractedTaskSchema>;
