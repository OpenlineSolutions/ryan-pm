# Ryan PM - Brandon Setup Guide

Everything you need to pull down the Ryan PM AI project manager and start working on it.

---

## 1. Clone the Repo

```
git clone https://github.com/OpenlineSolutions/ryan-pm.git
cd ryan-pm
npm install
```

---

## 2. Environment Variables

Create a `.env.local` file in the root. Ask Josh for the values, or run `vercel env pull` if you have the Vercel CLI linked.

Needed vars:
- DATABASE_URL (Neon Postgres)
- DEEPGRAM_API_KEY (voice, web UI only)
- SLACK_BOT_TOKEN (xoxb-)
- SLACK_SIGNING_SECRET
- NOTION_API_KEY (ntn_)
- NOTION_DATABASE_ID
- CRON_SECRET
- SLACK_CHANNEL_ID

---

## 3. Run Locally

```
npm run dev
```

The web UI (original FlowBoard) runs at localhost:3000. The Slack bot only works on the deployed version (Slack sends webhooks to the Vercel URL, not localhost).

---

## 4. Deploy

Just push to main. Vercel auto-deploys.

```
git add .
git commit -m "your message"
git push origin main
```

Live URL: https://ryan-pm.vercel.app

---

## 5. Key Files to Know

| File | What it does |
|------|--------------|
| `src/lib/categorize.ts` | The AI brain. Extracts tasks from messages/transcripts. This is where the prompt lives. |
| `src/lib/notion-tasks.ts` | Creates and queries tasks in Notion. |
| `src/lib/slack.ts` | Slack signature verification. |
| `src/app/api/slack/events/route.ts` | Main Slack webhook. Handles messages, reactions, file uploads, app home. |
| `src/app/api/slack/interact/route.ts` | Handles button clicks (Approve, Edit, Skip). |
| `src/app/api/slack/command/route.ts` | Slash commands (/summary, /tasks, /project). |
| `src/app/api/cron/digest/route.ts` | Morning digest cron job. |

---

## 6. How the Slack Bot Works

**Regular message in channel:** AI extracts tasks, posts checkboxes. User approves or skips.

**@AI PM [message]:** Creates tasks instantly, no approval step.

**Flag emoji reaction:** React to any message with the flag emoji. Bot processes it as a task.

**File upload (.txt):** Drag a transcript file in. Bot reads it and extracts action items.

**/summary [text]:** Paste meeting notes. Same extraction flow.

**/tasks:** Shows all open tasks grouped by project (only visible to you).

**/project [name]:** Shows status of a specific project.

**App Home:** Click the bot in the sidebar. Dashboard with this week's tasks, project health, team workload.

---

## 7. To Change Projects or Team Members

The project list and team roster are in THREE places (all must match):

**AI prompt** (what the AI knows about):
`src/lib/categorize.ts` - search for "McDonalds" and "Ryan, Sarah, Jake, Mike"

**Slack dropdowns** (what appears in the Edit view):
`src/app/api/slack/interact/route.ts` - search for `PROJECTS` and `TEAM` constants

**Notion database** (the actual select options):
Update via the Notion UI or API. Go to the database, click a select field, edit the options.

---

## 8. Slack App Settings

The Slack app is configured at: https://api.slack.com/apps/A0AQE93S8Q0

If you need to reconfigure:

**Bot scopes:** channels:history, channels:read, chat:write, reactions:read, files:read

**Event subscriptions URL:** https://ryan-pm.vercel.app/api/slack/events

**Events subscribed:** message.channels, reaction_added, app_home_opened

**Interactivity URL:** https://ryan-pm.vercel.app/api/slack/interact

**Slash commands (all point to same URL):**
- /summary -> https://ryan-pm.vercel.app/api/slack/command
- /tasks -> https://ryan-pm.vercel.app/api/slack/command
- /project -> https://ryan-pm.vercel.app/api/slack/command

**App Home:** Home Tab toggle ON

---

## 9. Notion Database

**Bot Tasks database:** https://www.notion.so/36dce2c74c994add8517f84ba3a0b9ed

Views:
- Default (table)
- Task Board (kanban by status)
- By Project (kanban by project)

The "AI PM Bot" Notion integration must be connected to this database (... menu > Connections).

---

## 10. Vercel Project

- **Project:** ryan-pm
- **URL:** https://ryan-pm.vercel.app
- **Dashboard:** https://vercel.com/joshlavin1s-projects/ryan-pm
- **Auto-deploys** from GitHub pushes to main
- **Cron:** daily at 3pm UTC (8am PST) hitting /api/cron/digest

---

## 11. Testing the Bot

1. Go to the Openlinehq Slack workspace
2. Find a channel where AI PM is invited
3. Type: "Burger King needs the logo redesign done by Friday, assign to Sarah"
4. You should see checkboxes appear
5. Tap Approve
6. Check the Notion database for the new task

To test the digest manually:
```
curl https://ryan-pm.vercel.app/api/cron/digest -H "Authorization: Bearer ryan-pm-cron-secret-2026"
```

---

## 12. Reference Docs

- **Product Overview:** https://www.notion.so/333c2983dc4181c7b3e5ec4d63b54d7e
- **Technical Build Doc:** https://www.notion.so/333c2983dc4181fc8e0ac6cfcb3dbd7d
- **Presentation:** ~/Documents/Claude/assets/ryan-pm-presentation.html
- **GitHub:** https://github.com/OpenlineSolutions/ryan-pm
