import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { extractItems, ExtractedItem } from "@/lib/categorize";
import { createTask, queryTasks, NotionTask } from "@/lib/notion-tasks";

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

  if (body.type === "event_callback") {
    const event = body.event;

    // Handle emoji reaction trigger (flag emoji)
    if (event?.type === "reaction_added" && event.reaction === "triangular_flag_on_post") {
      after(async () => {
        await processReaction(event.item.channel, event.item.ts);
      });
      return NextResponse.json({ ok: true });
    }

    // Handle App Home tab opened
    if (event?.type === "app_home_opened" && event.tab === "home") {
      after(async () => {
        await publishAppHome(event.user);
      });
      return NextResponse.json({ ok: true });
    }

    // Handle message events
    if (event?.type === "message") {
      // Ignore bot messages, edits, and thread replies
      if (event.bot_id || event.subtype || event.thread_ts) {
        return NextResponse.json({ ok: true });
      }

      const messageText = event.text;
      if (!messageText || messageText.trim().length === 0) {
        return NextResponse.json({ ok: true });
      }

      // Check for @PM prefix (direct create, no approval)
      const botUserId = "U0APDKU0DPV";
      const pmPattern = new RegExp(`^<@${botUserId}>\\s*`, "i");
      const isDirect = pmPattern.test(messageText);
      const cleanText = isDirect
        ? messageText.replace(pmPattern, "").trim()
        : messageText;

      if (!cleanText) {
        return NextResponse.json({ ok: true });
      }

      // Use Next.js after() to process in background after response is sent
      after(async () => {
        if (isDirect) {
          await directCreate(cleanText, event.channel);
        } else {
          await processMessage(cleanText, event.channel);
        }
      });

      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}

async function directCreate(messageText: string, channel: string) {
  try {
    console.log(`[SlackBot] Direct create: "${messageText.slice(0, 100)}"`);

    const items = await extractItems(messageText);
    if (items.length === 0) {
      return;
    }

    const created: string[] = [];
    for (const item of items) {
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

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      const summary = created.join("\n");
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          text: `Added ${created.length} task${created.length === 1 ? "" : "s"}:\n${summary}`,
          unfurl_links: false,
        }),
      });
    }
  } catch (err) {
    console.error("[SlackBot] Direct create error:", err);
  }
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

  // Compact checkboxes: emoji + title + metadata on one line
  const checkboxOptions = items.map((item, i) => {
    const parts = [
      item.project ? `\`${item.project}\`` : null,
      item.assignee || null,
      item.due_date || null,
    ].filter(Boolean).join("  ·  ");

    return {
      text: {
        type: "mrkdwn" as const,
        text: `*${item.title}*\n${parts}`,
      },
      value: String(i),
    };
  });

  return [
    {
      type: "actions",
      block_id: "task_checkboxes",
      elements: [
        {
          type: "checkboxes",
          action_id: "select_tasks",
          options: checkboxOptions,
          initial_options: checkboxOptions, // all selected by default
        },
      ],
    },
    {
      type: "actions",
      block_id: "task_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: "add_selected",
          value: itemsPayload,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Edit" },
          action_id: "edit_tasks",
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

// --- Feature: Emoji Reaction Trigger ---

async function processReaction(channel: string, messageTs: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.error("[SlackBot] Missing SLACK_BOT_TOKEN for reaction handler");
    return;
  }

  try {
    // Fetch the original message text
    const historyRes = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel}&latest=${messageTs}&inclusive=true&limit=1`,
      {
        headers: { Authorization: `Bearer ${slackToken}` },
      }
    );
    const historyData = await historyRes.json();

    if (!historyData.ok || !historyData.messages?.length) {
      console.error("[SlackBot] Could not fetch flagged message:", historyData.error);
      return;
    }

    const messageText = historyData.messages[0].text;
    if (!messageText || messageText.trim().length === 0) {
      return;
    }

    console.log(`[SlackBot] Processing flagged message: "${messageText.slice(0, 100)}"`);

    const items = await extractItems(messageText);
    if (items.length === 0) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          thread_ts: messageTs,
          text: "No actionable items found in the flagged message.",
        }),
      });
      return;
    }

    // Post the approval flow in a thread on the flagged message
    const blocks = buildInteractiveBlocks(items);
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        thread_ts: messageTs,
        text: `I found ${items.length} item(s) in the flagged message.`,
        blocks,
      }),
    });
  } catch (err) {
    console.error("[SlackBot] Error processing reaction:", err);
  }
}

// --- Feature: App Home Tab ---

function formatTaskLine(task: NotionTask): string {
  const parts = [
    task.project ? `\`${task.project}\`` : null,
    task.assignee || null,
    task.priority || null,
    task.dueDate ? `due ${task.dueDate}` : null,
  ].filter(Boolean).join(" · ");
  return `• *${task.title}*  ${parts}`;
}

async function publishAppHome(userId: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return;

  try {
    const today = new Date().toISOString().split("T")[0];

    // Fetch all three task lists in parallel
    const [dueTodayTasks, overdueTasks, recentTasks] = await Promise.all([
      queryTasks({ dueDate: today, statusNot: "Done" }),
      queryTasks({ overdue: true }),
      queryTasks({ recent: 5 }),
    ]);

    const blocks: any[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "AI PM Dashboard" },
      },
      { type: "divider" },
      // Due Today section
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:calendar: *Due Today* (${dueTodayTasks.length})`,
        },
      },
    ];

    if (dueTodayTasks.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: dueTodayTasks.map(formatTaskLine).join("\n"),
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No tasks due today._" },
      });
    }

    blocks.push({ type: "divider" });

    // Overdue section
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Overdue* (${overdueTasks.length})`,
      },
    });

    if (overdueTasks.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: overdueTasks.map(formatTaskLine).join("\n"),
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No overdue tasks. Nice!_" },
      });
    }

    blocks.push({ type: "divider" });

    // Recent Tasks section
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:new: *Recent Tasks* (last 5)`,
      },
    });

    if (recentTasks.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: recentTasks.map(formatTaskLine).join("\n"),
        },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No tasks yet._" },
      });
    }

    blocks.push({ type: "divider" });

    // Footer
    const now = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      dateStyle: "medium",
      timeStyle: "short",
    });
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Last updated: ${now}` },
      ],
    });

    // Publish the view
    const res = await fetch("https://slack.com/api/views.publish", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        view: {
          type: "home",
          blocks,
        },
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[SlackBot] Failed to publish app home:", data.error);
    }
  } catch (err) {
    console.error("[SlackBot] Error publishing app home:", err);
  }
}
