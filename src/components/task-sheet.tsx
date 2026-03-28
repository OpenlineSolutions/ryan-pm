"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Task, Project, TaskStatus, Priority } from "@/lib/types";
import { toast } from "sonner";

interface TaskSheetProps {
  task: Task | null;
  projects: Project[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

const STATUS_DOT: Record<TaskStatus, string> = {
  inbox: "bg-amber-400",
  todo: "bg-blue-400",
  in_progress: "bg-violet-400",
  done: "bg-emerald-400",
};

export function TaskSheet({ task, projects, open, onOpenChange, onSaved }: TaskSheetProps) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<TaskStatus>("inbox");
  const [isSaving, setIsSaving] = useState(false);

  // Reset form whenever the task being edited changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setProjectId(task.project_id ?? "");
      setPriority(task.priority);
      setStatus(task.status);
    }
  }, [task]);

  const handleSave = async () => {
    if (!task || !title.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          title: title.trim(),
          project_id: projectId || null,
          priority,
          status,
          approved: status !== "inbox",
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Task updated");
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-stone-100">
          <SheetTitle className="text-base font-semibold text-stone-900">
            Edit Task
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm border-stone-200 focus-visible:ring-1 focus-visible:ring-blue-500"
              placeholder="Task title"
            />
          </div>

          {/* Project */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Project
            </label>
            <div className="relative">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-800 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 pr-8"
              >
                <option value="">Uncategorized</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {projectId && (
              <button
                onClick={() => setProjectId("")}
                className="self-start text-xs text-stone-400 hover:text-stone-600 transition-colors"
              >
                Remove project
              </button>
            )}
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPriority(opt.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm transition-colors ${
                    priority === opt.value
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      priority === opt.value ? "bg-white" : PRIORITY_DOT[opt.value]
                    }`}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-stone-500 uppercase tracking-wide">
              Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={`flex items-center gap-1.5 py-2 px-3 rounded-lg border text-sm transition-colors ${
                    status === opt.value
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      status === opt.value ? "bg-white" : STATUS_DOT[opt.value]
                    }`}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Meta */}
          {task && (
            <div className="pt-2 border-t border-stone-100 flex flex-col gap-1.5">
              <p className="text-xs text-stone-400">
                Created{" "}
                {new Date(task.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              {task.voice_log_id && (
                <p className="text-xs text-stone-400">Added via voice</p>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-stone-100">
          <Button
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
            className="w-full"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
