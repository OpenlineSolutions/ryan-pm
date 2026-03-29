import { generateText } from "ai";

export type ExtractedItem = {
  type: "task" | "status_update" | "reminder";
  title: string;
  description: string;
  project:
    | "McDonalds"
    | "Burger King"
    | "In-N-Out"
    | "Chick-fil-A"
    | "Chipotle"
    | "Internal"
    | null;
  assignee: string | null;
  priority: "Urgent" | "High" | "Medium" | "Low";
  due_date: string | null; // ISO date string
};

export async function extractFromTranscript(
  transcript: string
): Promise<ExtractedItem[]> {
  console.log(
    "[Categorize] Calling AI Gateway for transcript extraction..."
  );

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are a project management AI that extracts action items from call transcripts and meeting notes.

Your job: read the full transcript and pull out ONLY the concrete action items. Ignore pleasantries, discussions, opinions, and context. Focus on things that someone needs to DO.

Item types:
- "task": something that needs to be DONE by someone
- "status_update": a decision or status change that was agreed on
- "reminder": a follow-up or deadline that was mentioned

Rules:
- Be selective. A 30-minute call might only have 3-5 real action items. Don't over-extract.
- Keep titles short (under 50 chars). Put context in description.
- If someone is mentioned by name as the owner, set them as assignee.
- Pick the best project: "McDonalds", "Burger King", "In-N-Out", "Chick-fil-A", "Chipotle", or "Internal". If unclear, use "Internal Ops".
- Default priority is "Medium". Use "High" for things that sounded urgent or time-sensitive.
- If a date or deadline was mentioned, convert to ISO format (YYYY-MM-DD). Otherwise null.

Respond with ONLY a valid JSON array. No markdown, no explanation.`,
    prompt: `Extract action items from this call transcript:\n\n${transcript}`,
  });

  console.log("[Categorize] Transcript AI response, length:", text.length);

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[Categorize] No JSON array found in transcript response");
      return [];
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed as ExtractedItem[];
  } catch {
    console.error(
      "[Categorize] Failed to parse transcript response:",
      text.slice(0, 200)
    );
    return [];
  }
}

export async function extractItems(message: string): Promise<ExtractedItem[]> {
  console.log("[Categorize] Calling AI Gateway for multi-item extraction...");

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6" as any,
    system: `You are a project management AI that extracts actionable items from Slack messages.

Your job: extract ALL actionable items from a single message. One message can contain multiple tasks, status updates, and reminders.

Item types:
- "task": something that needs to be DONE by someone (clear action required)
- "status_update": someone reporting progress on existing work
- "reminder": a time-based reminder or follow-up

Rules:
- Casual conversation, greetings, questions without action items, and chit-chat have NO items. Return an empty array [].
- Keep titles short (under 50 chars). Put extra context in description (under 100 chars).
- Pick the best project: "McDonalds", "Burger King", "In-N-Out", "Chick-fil-A", "Chipotle", or "Internal". If unclear, use "Internal Ops".
- If someone is mentioned by name, set them as assignee.
- Default priority is "Medium". Use "Urgent" for ASAP/critical/EOD. Use "High" for important but not urgent. Use "Low" for nice-to-have.
- Today's date is ${new Date().toISOString().split("T")[0]}. Use this to calculate relative dates like "tomorrow", "next Friday", "end of week", etc. Always return dates in ISO format (YYYY-MM-DD). If no date is mentioned, return null.

Respond with ONLY a valid JSON array. No markdown, no explanation.
Example: [{"type":"task","title":"Update hero section","description":"Change the headline copy on homepage","project":"Website Redesign","assignee":"Ryan","priority":"High","due_date":"2026-04-01"}]
Empty example: []`,
    prompt: `Extract actionable items from this Slack message:\n\n"${message}"`,
  });

  console.log("[Categorize] AI response received, length:", text.length);

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[Categorize] No JSON array found, treating as non-actionable");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed as ExtractedItem[];
  } catch {
    console.error("[Categorize] Failed to parse AI response:", text.slice(0, 200));
    return [];
  }
}
