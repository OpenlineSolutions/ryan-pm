-- Enable pgvector extension (for future semantic search)
create extension if not exists vector;

-- Projects table
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

-- Voice logs table
create table if not exists voice_logs (
  id uuid primary key default gen_random_uuid(),
  transcript text not null,
  embedding vector(1536),
  processed_at timestamptz not null default now(),
  task_count integer not null default 0
);

-- Tasks table
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  project_id uuid references projects(id) on delete set null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'inbox' check (status in ('inbox', 'todo', 'in_progress', 'done')),
  assignee text,
  voice_log_id uuid references voice_logs(id) on delete set null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_project_idx on tasks(project_id);
create index if not exists tasks_created_idx on tasks(created_at desc);
create index if not exists voice_logs_processed_idx on voice_logs(processed_at desc);

-- Seed projects for Ryan
insert into projects (name, color) values
  ('Joy Dental Marketing', '#22c55e'),
  ('Double Helix Design', '#6366f1'),
  ('Biotech Client', '#f59e0b'),
  ('Personal', '#64748b')
on conflict do nothing;

-- Disable RLS for POC (single user, no auth)
alter table projects enable row level security;
alter table voice_logs enable row level security;
alter table tasks enable row level security;

create policy "Allow all on projects" on projects for all using (true) with check (true);
create policy "Allow all on voice_logs" on voice_logs for all using (true) with check (true);
create policy "Allow all on tasks" on tasks for all using (true) with check (true);
