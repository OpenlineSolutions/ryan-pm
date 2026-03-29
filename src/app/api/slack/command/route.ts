import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { extractFromTranscript } from "@/lib/categorize";
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
    console.error("[Command] Invalid Slack signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse slash command payload (form-urlencoded)
  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const text = params.get("text") || "";
  const channelId = params.get("channel_id") || "";
  const responseUrl = params.get("response_url") || "";

  if (command === "/summary") {
    if (!text.trim()) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Paste a call transcript or meeting notes after the command.\nExample: `/summary We discussed the Martinez homepage redesign...`",
      });
    }

    // Acknowledge immediately (Slack requires response within 3 seconds)
    // Process in background
    after(async () => {
      await processTranscript(text, channelId, responseUrl);
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: ":hourglass_flowing_sand: Processing your transcript... I'll post the action items in a moment.",
    });
  }

  return NextResponse.json({
    response_type: "ephemeral",
    text: "Unknown command.",
  });
}

async function processTranscript(
  transcript: string,
  channelId: string,
  responseUrl: string
) {
  try {
    console.log(
      `[Command] Processing transcript (${transcript.length} chars)`
    );

    const items = await extractFromTranscript(transcript);

    if (items.length === 0) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: "No action items found in the transcript.",
        }),
      });
      return;
    }

    console.log(`[Command] Extracted ${items.length} items from transcript`);

    // Build the same interactive blocks as brain dumps
    const blocks = buildInteractiveBlocks(items);

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) return;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        text: `I found ${items.length} action item(s) from your call summary.`,
        blocks,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[Command] Failed to post message:", data.error);
    }
  } catch (err) {
    console.error("[Command] Error processing transcript:", err);
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: ":x: Error processing transcript. Try again or paste a shorter section.",
      }),
    });
  }
}

function getPriorityEmoji(priority: string): string {
  switch (priority) {
    case "Urgent": return ":rotating_light:";
    case "High": return ":red_circle:";
    case "Medium": return ":large_orange_circle:";
    case "Low": return ":white_circle:";
    default: return ":white_circle:";
  }
}

function buildInteractiveBlocks(items: ExtractedItem[]) {
  const checkboxOptions = items.map((item, i) => {
    const priorityEmoji = getPriorityEmoji(item.priority);
    const project = item.project ? `\`${item.project}\`` : "";
    const assignee = item.assignee ? `:bust_in_silhouette: ${item.assignee}` : "";
    const dueDate = item.due_date ? `:calendar: ${item.due_date}` : "";

    const metaParts = [project, assignee, dueDate].filter(Boolean).join("  ");
    const description = item.description ? `\n      _${item.description.slice(0, 60)}_` : "";

    return {
      text: {
        type: "mrkdwn" as const,
        text: `${priorityEmoji}  *${item.title}*${description}\n      ${metaParts}`,
      },
      description: {
        type: "mrkdwn" as const,
        text: `${item.priority} priority`,
      },
      value: String(i),
    };
  });

  const itemsPayload = JSON.stringify(
    items.map((item) => ({
      type: item.type,
      title: item.title,
      description: item.description.slice(0, 80),
      project: item.project,
      assignee: item.assignee,
      priority: item.priority,
      due_date: item.due_date,
    }))
  );

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:telephone_receiver: Call Summary - ${items.length} action item${items.length === 1 ? "" : "s"} found`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Select the items you want to add to Notion, then tap *Add Selected*.",
        },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "task_checkboxes",
      elements: [
        {
          type: "checkboxes",
          action_id: "select_tasks",
          options: checkboxOptions,
          initial_options: checkboxOptions,
        },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "task_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":white_check_mark:  Add Selected" },
          style: "primary",
          action_id: "add_selected",
          value: itemsPayload,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Skip All" },
          action_id: "skip_all",
          value: "skip",
        },
      ],
    },
  ];
}
