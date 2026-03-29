import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { createTask } from "@/lib/notion-tasks";
import type { ExtractedItem } from "@/lib/categorize";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify the request came from Slack
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  const isValid = verifySlackRequest({
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    timestamp,
    body: rawBody,
    signature,
  });

  if (!isValid) {
    console.error("[Interact] Invalid Slack signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse form-urlencoded payload
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  const actions = payload.actions || [];
  const action = actions[0];
  if (!action) {
    return NextResponse.json({ ok: true });
  }

  const responseUrl = payload.response_url;
  const actionId = action.action_id;

  if (actionId === "skip_all") {
    // Update the original message to show skipped
    await updateOriginalMessage(responseUrl, ":white_check_mark: Skipped -- no tasks created.");
    return NextResponse.json({ ok: true });
  }

  if (actionId === "add_selected") {
    try {
      // Get the full items data from the button value
      const allItems: ExtractedItem[] = JSON.parse(action.value);

      // Get selected checkbox indices from the state
      const checkboxState =
        payload.state?.values?.task_checkboxes?.select_tasks?.selected_options || [];
      const selectedIndices = checkboxState.map((opt: any) => parseInt(opt.value));

      if (selectedIndices.length === 0) {
        await updateOriginalMessage(
          responseUrl,
          ":warning: No items were selected. Nothing created."
        );
        return NextResponse.json({ ok: true });
      }

      // Create tasks in Notion for selected items
      const created: string[] = [];
      for (const idx of selectedIndices) {
        const item = allItems[idx];
        if (!item) continue;

        const result = await createTask({
          title: item.title,
          status: "Inbox",
          project: item.project,
          priority: item.priority,
          assignee: item.assignee,
          dueDate: item.due_date,
          source: "Slack",
          notes: item.description,
        });

        created.push(`<${result.url}|${item.title}>`);
      }

      const summary = created.map((link) => `- ${link}`).join("\n");
      await updateOriginalMessage(
        responseUrl,
        `:white_check_mark: Created ${created.length} task(s) in Notion:\n${summary}`
      );
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error("[Interact] Error creating tasks:", errMsg);
      console.error("[Interact] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      await updateOriginalMessage(
        responseUrl,
        `:x: Failed to create tasks: ${errMsg.slice(0, 200)}`
      );
    }

    return NextResponse.json({ ok: true });
  }

  // For checkbox toggles (select_tasks), just acknowledge
  return NextResponse.json({ ok: true });
}

async function updateOriginalMessage(responseUrl: string, text: string) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replace_original: "true",
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
      ],
    }),
  });
}
