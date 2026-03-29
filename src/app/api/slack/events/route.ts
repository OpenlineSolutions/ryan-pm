import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { categorizeMessage } from "@/lib/categorize";
import { createCard } from "@/lib/trello";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const body = JSON.parse(rawBody);

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

    // Respond to Slack immediately (3 second timeout)
    // Process in the background
    const processingPromise = processMessage(messageText, event.channel);

    // Use waitUntil if available (Vercel), otherwise just fire and forget
    if (typeof globalThis !== "undefined" && "waitUntil" in globalThis) {
      // @ts-ignore
      globalThis.waitUntil(processingPromise);
    } else {
      processingPromise.catch((err) =>
        console.error("Error processing message:", err)
      );
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

async function processMessage(messageText: string, channel: string) {
  try {
    console.log(`Processing message: "${messageText}"`);

    const category = await categorizeMessage(messageText);

    if (!category) {
      console.log("Message not categorized as a task, skipping.");
      return;
    }

    console.log("Categorized as task:", category);

    const card = await createCard({
      title: category.title,
      description: category.description,
      list: category.list,
      project: category.project,
      isUrgent: category.is_urgent,
    });

    console.log(`Created Trello card: ${card.shortUrl}`);

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
    console.error("Error processing Slack message:", err);
  }
}
