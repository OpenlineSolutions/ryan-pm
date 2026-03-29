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

  const res = await fetch("https://api.notion.so/v1/pages", {
    method: "POST",
    headers: NOTION_HEADERS,
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties,
    }),
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
  dueDate?: string;
  overdue?: boolean;
}): Promise<NotionTask[]> {
  const filterConditions: any[] = [];

  if (filters?.status) {
    filterConditions.push({
      property: "Status",
      select: { equals: filters.status },
    });
  }

  if (filters?.dueDate) {
    filterConditions.push({
      property: "Due Date",
      date: { equals: filters.dueDate },
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

  const body: any = {};
  if (filterConditions.length === 1) {
    body.filter = filterConditions[0];
  } else if (filterConditions.length > 1) {
    body.filter = { and: filterConditions };
  }

  const res = await fetch(
    `https://api.notion.so/v1/databases/${NOTION_DATABASE_ID}/query`,
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
