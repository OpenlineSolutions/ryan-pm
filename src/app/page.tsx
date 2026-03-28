"use client";

import { useState, useEffect, useCallback } from "react";
import { VoiceInput } from "@/components/voice-input";
import { KanbanBoard } from "@/components/kanban-board";
import { AiChat } from "@/components/ai-chat";
import { Separator } from "@/components/ui/separator";
import { Task, Project, TaskStatus } from "@/lib/types";
import { toast } from "sonner";
// toast is used in handleApprove / handleReject below

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) setTasks(await res.json());
    } catch {
      console.error("Failed to fetch tasks");
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) setProjects(await res.json());
    } catch {
      console.error("Failed to fetch projects");
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTasks(), fetchProjects()]).finally(() => setIsLoading(false));
  }, [fetchTasks, fetchProjects]);

  const handleMoveTask = async (taskId: string, newStatus: TaskStatus) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: newStatus, approved: newStatus !== "inbox" } : t
      )
    );
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus, approved: newStatus !== "inbox" }),
      });
    } catch {
      fetchTasks();
      toast.error("Failed to move task");
    }
  };

  const handleApprove = async (taskId: string) => {
    await handleMoveTask(taskId, "todo");
    toast.success("Task approved!");
  };

  const handleReject = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      toast("Task rejected");
    } catch {
      fetchTasks();
      toast.error("Failed to reject task");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-stone-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
          <p className="text-sm text-stone-500">Loading FlowBoard...</p>
        </div>
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-stone-900 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold text-stone-900">FlowBoard</span>
        </div>

        <div className="hidden sm:flex items-center gap-4">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-xs text-stone-500">{p.name}</span>
            </div>
          ))}
        </div>

        <span className="text-xs text-stone-400">
          {activeTasks} active {activeTasks === 1 ? "task" : "tasks"}
        </span>
      </header>

      <Separator />

      {/* Main */}
      <main className="p-5 flex flex-col gap-5">
        <VoiceInput onBoardChanged={fetchTasks} />

        <KanbanBoard
          tasks={tasks}
          projects={projects}
          onMoveTask={handleMoveTask}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={(task) => console.log("Edit:", task)}
        />
      </main>

      <AiChat onBoardChanged={fetchTasks} />
    </div>
  );
}
