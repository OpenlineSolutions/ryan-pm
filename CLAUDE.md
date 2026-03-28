@AGENTS.md

# FlowBoard — Ryan Meffert's AI Operations Hub

**Client:** Ryan Meffert (agency owner)
**Demo:** Monday 3/31/2026, 11:30am PT
**Live URL:** https://ryan-pm.vercel.app
**Repo:** https://github.com/OpenlineSolutions/ryan-pm
**Local path:** `/Users/joshlavin/openline/ryan-pm/`

---

## What This Is

A voice-first project management tool. Ryan speaks commands, the AI interprets them, and the Kanban board updates. Built as a POC to demonstrate the vision of an AI operations hub where multiple input channels (voice today, Slack/WhatsApp next) feed into a unified AI that manages tasks.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router |
| UI | shadcn/ui + Tailwind (stone/neutral palette) |
| Voice | Deepgram WebSocket (nova-3) |
| AI | AI SDK v6 + Vercel AI Gateway (OIDC auth) |
| Model | `anthropic/claude-sonnet-4.6` via gateway string |
| Database | Neon Postgres (`@neondatabase/serverless`) |
| Hosting | Vercel |

---

## Architecture

```
Voice/Text input
  → /api/agent (search_tasks FIRST, then act)
  → /api/chat (same search-first pattern)
  → Neon Postgres (tasks, projects, voice_logs)
  → Board re-fetches after agent completes
```

### Key design decision: search-first AI
The core bug in v1 was that saying "move X to done" created a new task instead of moving the existing one. Fix: `search_tasks` tool added to both agent routes. System prompt enforces: call `search_tasks` BEFORE creating anything.

---

## File Map

### API Routes
- `src/app/api/agent/route.ts` — voice/text → AI agent (search_tasks, create_task, move_task, delete_task)
- `src/app/api/chat/route.ts` — Agents tab chat (search_tasks, move_task, delete_task)
- `src/app/api/tasks/route.ts` — GET/PATCH/DELETE tasks
- `src/app/api/projects/route.ts` — GET projects
- `src/app/api/activity/route.ts` — GET recent voice_logs for activity feed
- `src/app/api/deepgram-token/route.ts` — returns Deepgram API key to browser

### Shared Logic
- `src/lib/agent-tools.ts` — shared tool factory functions (makeSearchTasksTool, makeMoveTaskTool, makeCreateTaskTool, makeDeleteTaskTool). Both agent routes import from here.
- `src/lib/db.ts` — Neon connection via `getDb()`
- `src/lib/types.ts` — Task, Project, VoiceLog, TaskStatus, Priority types
- `src/hooks/use-deepgram.ts` — shared Deepgram WebSocket hook used by voice-input + agents-panel

### Components
- `src/app/page.tsx` — main page: two-tab layout (Board / Agents), project filter pills, task sheet state
- `src/components/voice-input.tsx` — hero mic button + text input → /api/agent
- `src/components/kanban-board.tsx` — HTML5 DnD kanban (4 columns: Inbox, To Do, In Progress, Done). Click card → opens task sheet. Drag → moves column.
- `src/components/agents-panel.tsx` — Agents tab: agent cards (Task Agent active, Slack/WhatsApp coming soon) + activity feed + chat
- `src/components/task-sheet.tsx` — slide-in panel to edit task title, project, priority, status

---

## Database Schema

```sql
-- projects
id UUID, name TEXT, color TEXT, created_at TIMESTAMPTZ

-- tasks
id UUID, title TEXT, description TEXT, project_id UUID (FK),
priority TEXT (high/medium/low), status TEXT (inbox/todo/in_progress/done),
assignee TEXT, voice_log_id UUID (FK), approved BOOLEAN, created_at TIMESTAMPTZ

-- voice_logs
id UUID, transcript TEXT, task_count INT, processed_at TIMESTAMPTZ
```

---

## UI Layout

```
HEADER: [FlowBoard logo] | [Board] [Agents] tabs | [N active tasks]

BOARD TAB:
  [All] [Project A] [Project B] — project filter pills
  [Large mic button hero] — voice input
  [Kanban: Inbox | To Do | In Progress | Done]

AGENTS TAB:
  YOUR AGENTS
  [Task Agent — Active] [Slack — Coming soon] [WhatsApp — Coming soon]

  RECENT ACTIVITY
  [voice_logs feed]

  TALK TO YOUR AGENTS
  [chat messages + input with mic]

TASK SHEET (slide-in right):
  Title | Project dropdown | Priority toggle | Status toggle | Save
```

---

## What's Done (v2)

- [x] search_tasks tool — AI searches before creating (core bug fixed)
- [x] Shared Deepgram hook (use-deepgram.ts)
- [x] Shared agent tools (agent-tools.ts)
- [x] Two-tab layout (Board + Agents)
- [x] Project filter pills on Board tab
- [x] Agents tab with org chart + activity feed + chat
- [x] Task edit sheet (click card to edit title/project/priority/status)
- [x] "Updating board..." spinner while agent runs

## What's NOT Done (Phase 2)

- [ ] Slack/WhatsApp agent integration (cards show but no functionality)
- [ ] Touch/mobile DnD (HTML5 DnD does not fire on touch screens)
- [ ] Task edit sheet: description field
- [ ] Real-time board updates (currently polls on agent completion)
- [ ] Auth/multi-user

---

## Running Locally

```bash
cd /Users/joshlavin/openline/ryan-pm
npm run dev
```

Env vars are in `.env.local` (already configured, pulled via `vercel env pull`).

## Deploying

```bash
vercel --prod
```

Or just push to main — Vercel auto-deploys.

---

## Important Notes

- The AI model string `"anthropic/claude-sonnet-4.6" as any` is intentional — it routes through Vercel AI Gateway via OIDC. Do NOT add `@ai-sdk/anthropic` or `ANTHROPIC_API_KEY`.
- `stopWhen: stepCountIs(10)` replaces the old `maxSteps` option (AI SDK v6 breaking change).
- The kanban uses native HTML5 DnD (not dnd-kit or hello-pangea — both had React 19 compat issues).
- The `dragCounter` ref in kanban-board.tsx prevents column highlight flickering on nested dragenter/dragleave.
- `use-deepgram.ts` uses a `resetTranscriptRef` pattern to avoid stale closures across async agent calls.
