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
      // Get the original items data from the button value
      const allItems: ExtractedItem[] = JSON.parse(action.value);

      // Read any dropdown overrides from the state
      const stateValues = payload.state?.values || {};

      // Create tasks in Notion for ALL items (with any edits applied)
      const created: string[] = [];
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const itemState = stateValues[`item_${i}`] || {};

        // Apply dropdown overrides if the user changed them
        const project =
          itemState[`project_${i}`]?.selected_option?.value || item.project;
        const assignee =
          itemState[`assignee_${i}`]?.selected_option?.value || item.assignee;
        const priority =
          itemState[`priority_${i}`]?.selected_option?.value || item.priority;

        const result = await createTask({
          title: item.title,
          status: "Inbox",
          project: project === "Internal" ? null : project,
          priority,
          assignee: assignee === "Unassigned" ? null : assignee,
          dueDate: item.due_date,
          source: "Slack",
          notes: item.description,
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

  // For dropdown changes, just acknowledge (state is tracked by Slack)
  return NextResponse.json({ ok: true });
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
          type: "static_select",
          action_id: `priority_${i}`,
          placeholder: { type: "plain_text", text: "Priority" },
          initial_option: {
            text: { type: "plain_text", text: item.priority },
            value: item.priority,
          },
          options: PRIORITIES.map((p) => ({
            text: { type: "plain_text", text: p },
            value: p,
          })),
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
