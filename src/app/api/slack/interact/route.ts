import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack";
import { createTask, queryTasks, NotionTask } from "@/lib/notion-tasks";
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
      // Get the original items data from the button value
      const allItems: ExtractedItem[] = JSON.parse(action.value);

      const stateValues = payload.state?.values || {};

      // Check if checkboxes exist (compact view) to filter selected items
      const checkboxState =
        stateValues?.task_checkboxes?.select_tasks?.selected_options;
      const selectedIndices = checkboxState
        ? new Set(checkboxState.map((opt: any) => parseInt(opt.value)))
        : null; // null means all selected (edit view has no checkboxes)

      // Create tasks in Notion for selected items (with any dropdown edits)
      const created: string[] = [];
      for (let i = 0; i < allItems.length; i++) {
        // Skip unselected items if checkboxes were present
        if (selectedIndices && !selectedIndices.has(i)) continue;

        const item = allItems[i];
        const itemState = stateValues[`item_${i}`] || {};

        // Apply dropdown/datepicker overrides if user changed them (edit view)
        const project =
          itemState[`project_${i}`]?.selected_option?.value || item.project;
        const assignee =
          itemState[`assignee_${i}`]?.selected_option?.value || item.assignee;
        const priority = item.priority;
        const dueDate =
          itemState[`due_date_${i}`]?.selected_date || item.due_date;

        const result = await createTask({
          title: item.title,
          status: "Inbox",
          project: project === "Internal" ? null : project,
          priority,
          assignee: assignee === "Unassigned" ? null : assignee,
          dueDate: dueDate,
          source: "Slack",
          notes: item.description,
          steps: item.steps || [],
        });

        const projectTag = project ? ` \`${project}\`` : "";
        created.push(`${projectTag}  <${result.url}|${item.title}>`);
      }

      const summary = created.map((link) => `${link}`).join("\n");
      await updateOriginalMessage(
        responseUrl,
        `:white_check_mark: *Added ${created.length} task${created.length === 1 ? "" : "s"} to Notion:*\n\n${summary}`
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

  if (actionId === "edit_tasks") {
    try {
      const allItems: ExtractedItem[] = JSON.parse(action.value);
      const editBlocks = buildEditBlocks(allItems);
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace_original: "true",
          text: "Editing tasks...",
          blocks: editBlocks,
        }),
      });
    } catch (err: any) {
      console.error("[Interact] Error expanding edit view:", err?.message);
    }
    return NextResponse.json({ ok: true });
  }

  // --- Quick Action: View All Tasks ---
  if (actionId === "home_view_tasks") {
    const userId = payload.user?.id;
    if (userId) {
      handleViewAllTasks(userId).catch((err) =>
        console.error("[Interact] View all tasks error:", err)
      );
    }
    return NextResponse.json({ ok: true });
  }

  // --- Quick Action: Morning Digest ---
  if (actionId === "home_digest") {
    const userId = payload.user?.id;
    if (userId) {
      handleDigest(userId).catch((err) =>
        console.error("[Interact] Digest error:", err)
      );
    }
    return NextResponse.json({ ok: true });
  }

  // For dropdown changes, just acknowledge (state is tracked by Slack)
  return NextResponse.json({ ok: true });
}

// --- Quick Action Handlers ---

async function handleViewAllTasks(userId: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return;

  const tasks = await queryTasks({ statusNot: "Done" });

  const lines = tasks.map((t) => {
    const project = t.project ? `\`${t.project}\`` : "";
    const assignee = t.assignee || "";
    const due = t.dueDate ? `due ${t.dueDate}` : "";
    const parts = [project, assignee, due].filter(Boolean).join(" · ");
    return `• *${t.title}*  ${parts}`;
  });

  const text =
    tasks.length > 0
      ? `:clipboard: *All Open Tasks* (${tasks.length})\n\n${lines.join("\n")}`
      : "_No open tasks._";

  // Open a DM with the user and post there
  const dmRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });
  const dmData = await dmRes.json();
  if (!dmData.ok) {
    console.error("[Interact] Failed to open DM:", dmData.error);
    return;
  }

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: dmData.channel.id,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      unfurl_links: false,
    }),
  });
}

async function handleDigest(userId: string) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return;

  const today = new Date().toISOString().split("T")[0];

  const [dueTodayTasks, overdueTasks, inboxTasks] = await Promise.all([
    queryTasks({ dueDate: today }),
    queryTasks({ overdue: true }),
    queryTasks({ status: "Inbox" }),
  ]);

  const dueToday = dueTodayTasks.filter((t) => t.status !== "Done");
  const overdue = overdueTasks.filter((t) => t.dueDate && t.dueDate < today);

  const sections: string[] = [];

  if (overdue.length > 0) {
    const lines = overdue.map(
      (t) => `- <${t.url}|${t.title}> (due ${t.dueDate}) ${t.assignee ? `@${t.assignee}` : ""}`
    );
    sections.push(`:rotating_light: *Overdue (${overdue.length})*\n${lines.join("\n")}`);
  }

  if (dueToday.length > 0) {
    const lines = dueToday.map(
      (t) => `- <${t.url}|${t.title}> [${t.status}] ${t.assignee ? `@${t.assignee}` : ""}`
    );
    sections.push(`:calendar: *Due Today (${dueToday.length})*\n${lines.join("\n")}`);
  }

  if (inboxTasks.length > 0) {
    const lines = inboxTasks.map(
      (t) => `- <${t.url}|${t.title}> ${t.project ? `[${t.project}]` : ""}`
    );
    sections.push(`:inbox_tray: *Inbox (${inboxTasks.length})*\n${lines.join("\n")}`);
  }

  const total = dueToday.length + overdue.length + inboxTasks.length;
  const digestText =
    total > 0
      ? `:sunrise: *Morning Digest - ${today}*\n\n${sections.join("\n\n")}\n\n_${total} items need attention._`
      : `:sunrise: *Morning Digest - ${today}*\n\n_Nothing to report. All clear!_`;

  // Open DM and post digest
  const dmRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });
  const dmData = await dmRes.json();
  if (!dmData.ok) {
    console.error("[Interact] Failed to open DM for digest:", dmData.error);
    return;
  }

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: dmData.channel.id,
      text: digestText,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: digestText } }],
      unfurl_links: false,
    }),
  });
}

const PROJECTS = ["McDonalds", "Burger King", "In-N-Out", "Chick-fil-A", "Chipotle", "Internal"];
const PRIORITIES = ["Urgent", "High", "Medium", "Low"];
const TEAM = ["Ryan", "Sarah", "Jake", "Mike", "Unassigned"];

function getPriorityEmoji(priority: string): string {
  switch (priority) {
    case "Urgent": return ":rotating_light:";
    case "High": return ":red_circle:";
    case "Medium": return ":large_orange_circle:";
    case "Low": return ":white_circle:";
    default: return ":white_circle:";
  }
}

function buildEditBlocks(items: ExtractedItem[]) {
  const itemsPayload = JSON.stringify(
    items.map((item) => ({
      type: item.type,
      title: item.title,
      description: item.description?.slice(0, 80) || "",
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
        text: `:pencil2: *Editing ${items.length} item${items.length === 1 ? "" : "s"}:*`,
      },
    },
  ];

  items.forEach((item, i) => {
    const emoji = getPriorityEmoji(item.priority);
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji}  *${item.title}*`,
      },
    });
    blocks.push({
      type: "actions",
      block_id: `item_${i}`,
      elements: [
        {
          type: "static_select",
          action_id: `project_${i}`,
          placeholder: { type: "plain_text", text: "Project" },
          initial_option: item.project
            ? { text: { type: "plain_text", text: item.project }, value: item.project }
            : { text: { type: "plain_text", text: "Internal" }, value: "Internal" },
          options: PROJECTS.map((p) => ({
            text: { type: "plain_text", text: p },
            value: p,
          })),
        },
        {
          type: "static_select",
          action_id: `assignee_${i}`,
          placeholder: { type: "plain_text", text: "Assignee" },
          initial_option: item.assignee && TEAM.includes(item.assignee)
            ? { text: { type: "plain_text", text: item.assignee }, value: item.assignee }
            : { text: { type: "plain_text", text: "Unassigned" }, value: "Unassigned" },
          options: TEAM.map((t) => ({
            text: { type: "plain_text", text: t },
            value: t,
          })),
        },
        {
          type: "datepicker",
          action_id: `due_date_${i}`,
          placeholder: { type: "plain_text", text: "Due date" },
          ...(item.due_date ? { initial_date: item.due_date } : {}),
        },
      ],
    });
  });

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    block_id: "task_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Save All to Notion" },
        style: "primary",
        action_id: "add_selected",
        value: itemsPayload,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Cancel" },
        action_id: "skip_all",
        value: "skip",
      },
    ],
  });

  return blocks;
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
