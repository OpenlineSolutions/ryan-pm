import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { extractItems, ExtractedItem } from "@/lib/categorize";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("Failed to parse request body:", rawBody.slice(0, 200));
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle Slack URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

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
    console.error("Invalid Slack signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Handle message events
  if (body.type === "event_callback" && body.event?.type === "message") {
    const event = body.event;

    // Ignore bot messages, edits, and thread replies
    if (event.bot_id || event.subtype || event.thread_ts) {
      return NextResponse.json({ ok: true });
    }

    const messageText = event.text;
    if (!messageText || messageText.trim().length === 0) {
      return NextResponse.json({ ok: true });
    }

    // Use Next.js after() to process in background after response is sent
    after(async () => {
      await processMessage(messageText, event.channel);
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

async function processMessage(messageText: string, channel: string) {
  try {
    console.log(`[SlackBot] Processing message: "${messageText.slice(0, 100)}"`);

    const items = await extractItems(messageText);

    if (items.length === 0) {
      console.log("[SlackBot] No actionable items found, skipping.");
      return;
    }

    console.log(`[SlackBot] Found ${items.length} items`);

    // Build Block Kit interactive message
    const blocks = buildInteractiveBlocks(items);

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) {
      console.error("[SlackBot] Missing SLACK_BOT_TOKEN");
      return;
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: `I found ${items.length} item(s) in your message.`,
        blocks,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[SlackBot] Failed to post message:", data.error);
    }
  } catch (err) {
    console.error("[SlackBot] Error processing message:", err);
  }
}

function buildInteractiveBlocks(items: ExtractedItem[]) {
  const checkboxOptions = items.map((item, i) => {
    const meta = [
      item.priority,
      item.project || "No project",
      item.assignee ? `@${item.assignee}` : null,
      item.due_date || null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      text: {
        type: "mrkdwn" as const,
        text: `*${item.title}*\n${meta}`,
      },
      value: String(i),
    };
  });

  // Encode items in the button value (keep descriptions short to stay under 2000 char limit)
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

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *I found ${items.length} item(s) in your message:*`,
      },
    },
    {
      type: "actions",
      block_id: "task_checkboxes",
      elements: [
        {
          type: "checkboxes",
          action_id: "select_tasks",
          options: checkboxOptions,
          initial_options: checkboxOptions, // All selected by default
        },
      ],
    },
    {
      type: "actions",
      block_id: "task_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Add Selected" },
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

  return blocks;
}
