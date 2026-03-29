import { generateText } from "ai";
import { z } from "zod";

const CategorySchema = z.object({
  is_task: z.boolean(),
  title: z.string(),
  description: z.string(),
  project: z
    .enum([
      "Website Redesign",
      "Client Onboarding",
      "Internal Ops",
      "Marketing",
    ])
    .nullable(),
  is_urgent: z.boolean(),
  list: z.enum(["inbox", "todo"]),
});

export type Category = z.infer<typeof CategorySchema>;

export async function categorizeMessage(
  message: string
): Promise<Category | null> {
  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are a project management AI that categorizes Slack messages for an agency.

Your job: decide if a message contains an actionable task. If it does, extract the details.

Rules:
- Casual conversation, greetings, questions, and chit-chat are NOT tasks. Return is_task: false.
- A task is something that needs to be DONE by someone. It has a clear action.
- If the message mentions urgency (ASAP, urgent, deadline, ASAP, by EOD, critical), mark is_urgent: true.
- Pick the best project category based on context. If unclear, use "Internal Ops".
- Default list is "inbox" unless the task is very clear and specific, then use "todo".
- Keep the title short (under 60 chars). Put extra context in the description.

Respond with ONLY valid JSON matching this shape:
{
  "is_task": boolean,
  "title": "short task title",
  "description": "context and details",
  "project": "Website Redesign" | "Client Onboarding" | "Internal Ops" | "Marketing" | null,
  "is_urgent": boolean,
  "list": "inbox" | "todo"
}

If is_task is false, still return the full object but title/description can be empty strings and project can be null.`,
    prompt: `Categorize this Slack message:\n\n"${message}"`,
  });

  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const result = CategorySchema.parse(parsed);

    if (!result.is_task) return null;
    return result;
  } catch {
    console.error("Failed to parse AI categorization:", text);
    return null;
  }
}
