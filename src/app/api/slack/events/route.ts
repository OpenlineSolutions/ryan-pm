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

    // Handle file uploads (transcripts, meeting notes)
    if (event?.type === "message" && event.files?.length > 0) {
      const file = event.files[0];
      console.log(`[SlackBot] File detected: ${file.name}, type: ${file.mimetype}, filetype: ${file.filetype}, subtype: ${event.subtype}`);
      // Process text-based files
      if (
        file.mimetype?.startsWith("text/") ||
        file.filetype === "text" ||
        file.filetype === "txt" ||
        file.name?.endsWith(".txt") ||
        file.name?.endsWith(".md") ||
        file.name?.endsWith(".csv")
      ) {
        after(async () => {
          await processFileUpload(file.id, event.channel);
        });
        return NextResponse.json({ ok: true });
      }
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
        steps: item.steps || [],
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

async function processFileUpload(fileId: string, channel: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return;

  try {
    // Get file info to get the download URL
    const infoRes = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
      headers: { Authorization: `Bearer ${slackToken}` },
    });
    const infoData = await infoRes.json();

    if (!infoData.ok || !infoData.file) {
      console.error("[SlackBot] Failed to get file info:", infoData.error);
      return;
    }

    const file = infoData.file;
    const downloadUrl = file.url_private;

    if (!downloadUrl) {
      console.error("[SlackBot] No download URL for file");
      return;
    }

    // Download the file content
    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${slackToken}` },
    });
    const fileContent = await fileRes.text();

    if (!fileContent || fileContent.trim().length === 0) {
      return;
    }

    console.log(`[SlackBot] Processing uploaded file: ${file.name} (${fileContent.length} chars)`);

    // Use the transcript extraction (better for long-form content)
    const { extractFromTranscript } = await import("@/lib/categorize");
    const items = await extractFromTranscript(fileContent);

    if (items.length === 0) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          text: `Processed *${file.name}* but found no action items.`,
        }),
      });
      return;
    }

    // Post the checkmark approval flow
    const blocks = buildInteractiveBlocks(items);
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: `Found ${items.length} action item(s) from *${file.name}*`,
        blocks: [
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: `From uploaded file: *${file.name}*` },
            ],
          },
          ...blocks,
        ],
      }),
    });
  } catch (err) {
    console.error("[SlackBot] Error processing file upload:", err);
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
      steps: item.steps || [],
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

// --- Helpers for App Home Dashboard ---

function getPSTDate(): Date {
  // Get current date/time in PST
  const pstStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(pstStr);
}

function getWeekRange(): { start: string; end: string; monday: Date } {
  const now = getPSTDate();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    end: sunday.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
    monday,
  };
}

function getDayLabel(dateStr: string, monday: Date): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[d.getDay()];
}

function daysOverdue(dueDateStr: string): number {
  const today = getPSTDate();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + "T00:00:00");
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

async function publishAppHome(userId: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return;

  try {
    const today = new Date().toISOString().split("T")[0];
    const week = getWeekRange();

    // Fetch data in parallel: this week's tasks, all tasks (for health + workload), overdue
    const [weekTasks, allTasks, overdueTasks] = await Promise.all([
      queryTasks({ dueDateRange: { start: week.start, end: week.end }, statusNot: "Done" }),
      queryTasks({}),
      queryTasks({ overdue: true }),
    ]);

    const blocks: any[] = [];

    // --- Section 1: Header ---
    const now = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "Your Operations Dashboard" },
    });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Last updated: ${now}` }],
    });
    blocks.push({ type: "divider" });

    // --- Section 2: This Week ---
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: ":calendar: *This Week*" },
    });

    if (weekTasks.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No tasks due this week._" },
      });
    } else {
      // Group by day of week
      const byDay: Record<string, NotionTask[]> = {};
      for (const task of weekTasks) {
        if (!task.dueDate) continue;
        const label = getDayLabel(task.dueDate, week.monday);
        if (!byDay[label]) byDay[label] = [];
        byDay[label].push(task);
      }

      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      for (const day of dayOrder) {
        const tasks = byDay[day];
        if (!tasks || tasks.length === 0) continue;
        const lines = tasks.map((t) => {
          const project = t.project ? ` \`${t.project}\`` : "";
          const assignee = t.assignee ? ` ${t.assignee}` : "";
          const meta = [project, assignee].filter(Boolean).join(" ·");
          return `  • ${t.title} ·${meta}`;
        });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${day}* (${tasks.length})\n${lines.join("\n")}`,
          },
        });
      }
    }

    blocks.push({ type: "divider" });

    // --- Section 3: Project Health ---
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: ":bar_chart: *Project Health*" },
    });

    const projects = ["McDonalds", "Burger King", "In-N-Out", "Chick-fil-A", "Chipotle", "Internal"];
    const projectLines: string[] = [];
    for (const proj of projects) {
      const projTasks = allTasks.filter((t) => t.project === proj || (proj === "Internal" && !t.project));
      if (projTasks.length === 0) continue;
      const done = projTasks.filter((t) => t.status === "Done").length;
      const overdueCount = projTasks.filter(
        (t) => t.status !== "Done" && t.dueDate && t.dueDate < today
      ).length;
      const taskWord = projTasks.length === 1 ? "task" : "tasks";
      const warning = overdueCount > 0 ? "  :warning:" : "";
      projectLines.push(
        `${proj}     ${projTasks.length} ${taskWord} · ${done} done · ${overdueCount} overdue${warning}`
      );
    }

    if (projectLines.length > 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: projectLines.join("\n") },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No projects with tasks._" },
      });
    }

    blocks.push({ type: "divider" });

    // --- Section 4: Team Workload ---
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: ":busts_in_silhouette: *Team Workload*" },
    });

    const openTasks = allTasks.filter((t) => t.status !== "Done");
    const byAssignee: Record<string, number> = {};
    let unassigned = 0;
    for (const t of openTasks) {
      if (t.assignee) {
        byAssignee[t.assignee] = (byAssignee[t.assignee] || 0) + 1;
      } else {
        unassigned++;
      }
    }

    const workloadLines: string[] = [];
    // Sort by count descending
    const sortedAssignees = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sortedAssignees) {
      const taskWord = count === 1 ? "open task" : "open tasks";
      workloadLines.push(`${name}        ${count} ${taskWord}`);
    }
    if (unassigned > 0) {
      const taskWord = unassigned === 1 ? "task" : "tasks";
      workloadLines.push(`Unassigned   ${unassigned} ${taskWord}`);
    }

    if (workloadLines.length > 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: workloadLines.join("\n") },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No open tasks._" },
      });
    }

    blocks.push({ type: "divider" });

    // --- Section 5: Overdue ---
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Overdue* (${overdueTasks.length})`,
      },
    });

    if (overdueTasks.length > 0) {
      const overdueLines = overdueTasks.map((t) => {
        const days = t.dueDate ? daysOverdue(t.dueDate) : 0;
        const project = t.project ? ` \`${t.project}\`` : "";
        const assignee = t.assignee ? ` ${t.assignee}` : "";
        return `• *${t.title}*${project} ·${assignee} · ${days}d late`;
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: overdueLines.join("\n") },
      });
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No overdue tasks. Nice!_" },
      });
    }

    blocks.push({ type: "divider" });

    // --- Section 6: Quick Actions ---
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View All Tasks" },
          action_id: "home_view_tasks",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Morning Digest" },
          action_id: "home_digest",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open Board" },
          url: "https://www.notion.so/36dce2c74c994add8517f84ba3a0b9ed",
          action_id: "home_open_board",
        },
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
