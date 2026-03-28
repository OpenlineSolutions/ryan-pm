export type TaskStatus = "inbox" | "todo" | "in_progress" | "done";
export type Priority = "high" | "medium" | "low";

export interface Project {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  project?: Project;
  priority: Priority;
  status: TaskStatus;
  assignee: string | null;
  voice_log_id: string | null;
  approved: boolean;
  created_at: string;
}

export interface VoiceLog {
  id: string;
  transcript: string;
  processed_at: string;
  task_count: number;
}

export const STATUS_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};
