const NOTION_API_KEY = process.env.NOTION_API_KEY!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

export type CreateTaskInput = {
  title: string;
  status?: string;
  project?: string | null;
  priority?: string;
  assignee?: string | null;
  dueDate?: string | null; // ISO date string
  source?: string;
  notes?: string;
  steps?: string[]; // sub-steps written into the page body
};

export type NotionTask = {
  id: string;
  url: string;
  title: string;
  status: string;
  project: string | null;
  priority: string | null;
  assignee: string | null;
  dueDate: string | null;
  source: string | null;
  notes: string | null;
};

export async function createTask(input: CreateTaskInput): Promise<{ id: string; url: string }> {
  const properties: Record<string, any> = {
    "Task Name": {
      title: [{ text: { content: input.title } }],
    },
    Status: {
      select: { name: input.status || "Inbox" },
    },
    Priority: {
      select: { name: input.priority || "Medium" },
    },
    Source: {
      select: { name: input.source || "Slack" },
    },
  };

  if (input.project) {
    properties["Project"] = {
      select: { name: input.project },
    };
  }

  if (input.assignee) {
    properties["Assignee"] = {
      rich_text: [{ text: { content: input.assignee } }],
    };
  }

  if (input.dueDate) {
    properties["Due Date"] = {
      date: { start: input.dueDate },
    };
  }

  if (input.notes) {
    properties["Notes"] = {
      rich_text: [{ text: { content: input.notes } }],
    };
  }

  // Build page content blocks (children)
  const children: any[] = [];

  if (input.notes) {
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Context" } }],
      },
    });
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: input.notes } }],
      },
    });
  }

  if (input.steps && input.steps.length > 0) {
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Steps" } }],
      },
    });
    for (const step of input.steps) {
      children.push({
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: [{ type: "text", text: { content: step } }],
          checked: false,
        },
      });
    }
  }

  children.push({
    object: "block",
    type: "divider",
    divider: {},
  });
  children.push({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: `Created from ${input.source || "Slack"} on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` },
          annotations: { italic: true, color: "gray" },
        },
      ],
    },
  });

  const body: any = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
  };

  if (children.length > 0) {
    body.children = children;
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: NOTION_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion createTask failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return { id: data.id, url: data.url };
}

export async function queryTasks(filters?: {
  status?: string;
  statusNot?: string;
  dueDate?: string;
  dueDateRange?: { start: string; end: string };
  overdue?: boolean;
  project?: string;
  recent?: number; // return N most recently created tasks
}): Promise<NotionTask[]> {
  const filterConditions: any[] = [];

  if (filters?.status) {
    filterConditions.push({
      property: "Status",
      select: { equals: filters.status },
    });
  }

  if (filters?.statusNot) {
    filterConditions.push({
      property: "Status",
      select: { does_not_equal: filters.statusNot },
    });
  }

  if (filters?.dueDate) {
    filterConditions.push({
      property: "Due Date",
      date: { equals: filters.dueDate },
    });
  }

  if (filters?.dueDateRange) {
    filterConditions.push({
      property: "Due Date",
      date: { on_or_after: filters.dueDateRange.start },
    });
    filterConditions.push({
      property: "Due Date",
      date: { on_or_before: filters.dueDateRange.end },
    });
  }

  if (filters?.overdue) {
    const today = new Date().toISOString().split("T")[0];
    filterConditions.push({
      property: "Due Date",
      date: { before: today },
    });
    filterConditions.push({
      property: "Status",
      select: { does_not_equal: "Done" },
    });
  }

  if (filters?.project) {
    filterConditions.push({
      property: "Project",
      select: { equals: filters.project },
    });
  }

  const body: any = {};
  if (filterConditions.length === 1) {
    body.filter = filterConditions[0];
  } else if (filterConditions.length > 1) {
    body.filter = { and: filterConditions };
  }

  // Sort by created time descending for recent queries
  if (filters?.recent) {
    body.sorts = [{ timestamp: "created_time", direction: "descending" }];
    body.page_size = filters.recent;
  }

  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion queryTasks failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.results.map(parseNotionPage);
}

function parseNotionPage(page: any): NotionTask {
  const props = page.properties;
  return {
    id: page.id,
    url: page.url,
    title: props["Task Name"]?.title?.[0]?.text?.content || "(untitled)",
    status: props["Status"]?.select?.name || "Inbox",
    project: props["Project"]?.select?.name || null,
    priority: props["Priority"]?.select?.name || null,
    assignee: props["Assignee"]?.rich_text?.[0]?.text?.content || null,
    dueDate: props["Due Date"]?.date?.start || null,
    source: props["Source"]?.select?.name || null,
    notes: props["Notes"]?.rich_text?.[0]?.text?.content || null,
  };
}
