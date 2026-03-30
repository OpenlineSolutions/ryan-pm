import { NextRequest, NextResponse } from "next/server";
import { queryTasks, NotionTask } from "@/lib/notion-tasks";

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this as Authorization header)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error("[Digest] Invalid cron secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

    // Query Notion for digest data
    const [dueTodayTasks, overdueTasks, inboxTasks] = await Promise.all([
      queryTasks({ dueDate: today }),
      queryTasks({ overdue: true }),
      queryTasks({ status: "Inbox" }),
    ]);

    // Filter out "Done" tasks from due today
    const dueToday = dueTodayTasks.filter((t) => t.status !== "Done");
    const overdue = overdueTasks.filter(
      (t) => t.dueDate && t.dueDate < today
    );
    const inbox = inboxTasks;

    // If nothing to report, skip posting
    if (dueToday.length === 0 && overdue.length === 0 && inbox.length === 0) {
      console.log("[Digest] Nothing to report, skipping.");
      return NextResponse.json({ ok: true, message: "Nothing to report" });
    }

    // Build the Slack message
    const blocks = buildDigestBlocks(dueToday, overdue, inbox, today);

    const slackToken = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (!slackToken || !channelId) {
      console.error("[Digest] Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID");
      return NextResponse.json(
        { error: "Missing Slack config" },
        { status: 500 }
      );
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        text: `Morning Digest for ${today}`,
        blocks,
        unfurl_links: false,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[Digest] Slack post failed:", data.error);
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    console.log(`[Digest] Posted digest: ${dueToday.length} due today, ${overdue.length} overdue, ${inbox.length} inbox`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Digest] Error:", err);
    return NextResponse.json({ error: "Digest failed" }, { status: 500 });
  }
}

function buildDigestBlocks(
  dueToday: NotionTask[],
  overdue: NotionTask[],
  inbox: NotionTask[],
  today: string
) {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:sunrise: Morning Digest - ${today}`,
      },
    },
  ];

  if (overdue.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:rotating_light: *Overdue (${overdue.length})*\n` +
          overdue
            .map(
              (t) =>
                `- <${t.url}|${t.title}> (due ${t.dueDate}) ${t.assignee ? `@${t.assignee}` : ""}`
            )
            .join("\n"),
      },
    });
  }

  if (dueToday.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:calendar: *Due Today (${dueToday.length})*\n` +
          dueToday
            .map(
              (t) =>
                `- <${t.url}|${t.title}> [${t.status}] ${t.assignee ? `@${t.assignee}` : ""}`
            )
            .join("\n"),
      },
    });
  }

  if (inbox.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:inbox_tray: *Inbox - Pending Review (${inbox.length})*\n` +
          inbox
            .map((t) => `- <${t.url}|${t.title}> ${t.project ? `[${t.project}]` : ""}`)
            .join("\n"),
      },
    });
  }

  blocks.push({ type: "divider" });

  const total = dueToday.length + overdue.length + inbox.length;
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${total} items need attention. <https://www.notion.so/${process.env.NOTION_DATABASE_ID}|Open Notion>`,
      },
    ],
  });

  return blocks;
}
