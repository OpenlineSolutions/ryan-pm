const TRELLO_KEY = process.env.TRELLO_API_KEY!;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN!;

// List IDs
const LISTS = {
  inbox: "69c98084d575eddfe3797686",
  todo: "69c98083be1996603dd8185a",
  in_progress: "69c980832c4a267e56a7533c",
  done: "69c98083b612ccad82d441f0",
  agents: "69c98082fcdf96002bc8e9f1",
} as const;

// Label IDs (projects)
const LABELS = {
  "Website Redesign": "69c9808b6ed4e8ade7ad9495",
  "Client Onboarding": "69c9808c9fff101e2135f326",
  "Internal Ops": "69c9808c2a45862d6ec65bf9",
  "Marketing": "69c9808cb612ccad82d45997",
  "Urgent": "69c9808d7088424cdd454a94",
} as const;

export type TrelloList = keyof typeof LISTS;
export type TrelloProject = keyof typeof LABELS;

export async function createCard({
  title,
  description,
  list,
  project,
  isUrgent,
}: {
  title: string;
  description: string;
  list: TrelloList;
  project: TrelloProject | null;
  isUrgent: boolean;
}) {
  const listId = LISTS[list];
  const labelIds: string[] = [];

  if (project && LABELS[project]) {
    labelIds.push(LABELS[project]);
  }
  if (isUrgent) {
    labelIds.push(LABELS["Urgent"]);
  }

  const params = new URLSearchParams({
    key: TRELLO_KEY,
    token: TRELLO_TOKEN,
    name: title,
    desc: `${description}\n\n---\n_Created from Slack by AI PM Bot_`,
    idList: listId,
  });

  if (labelIds.length > 0) {
    params.set("idLabels", labelIds.join(","));
  }

  const res = await fetch(
    `https://api.trello.com/1/cards?${params.toString()}`,
    { method: "POST" }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API error: ${res.status} ${text}`);
  }

  return res.json();
}
