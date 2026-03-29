import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { categorizeMessage } from "@/lib/categorize";
import { createCard } from "@/lib/trello";

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

    const category = await categorizeMessage(messageText);

    if (!category) {
      console.log("[SlackBot] Not a task, skipping.");
      return;
    }

    console.log("[SlackBot] Categorized as task:", JSON.stringify(category));

    const card = await createCard({
      title: category.title,
      description: category.description,
      list: category.list,
      project: category.project,
      isUrgent: category.is_urgent,
    });

    console.log(`[SlackBot] Created Trello card: ${card.shortUrl}`);

    // Post a confirmation back to Slack
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      const projectLabel = category.project ? ` [${category.project}]` : "";
      const urgentLabel = category.is_urgent ? " :rotating_light:" : "";
      const confirmMsg = `Task created${urgentLabel}${projectLabel}: *${category.title}*\n${card.shortUrl}`;

      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          text: confirmMsg,
          unfurl_links: false,
        }),
      });
    }
  } catch (err) {
    console.error("[SlackBot] Error processing message:", err);
  }
}
