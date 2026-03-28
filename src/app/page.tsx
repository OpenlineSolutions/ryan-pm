"use client";

import { useState, useEffect, useCallback } from "react";
import { VoiceInput } from "@/components/voice-input";
import { KanbanBoard } from "@/components/kanban-board";
import { AiChat } from "@/components/ai-chat";
import { Task, Project, TaskStatus } from "@/lib/types";
import { toast } from "sonner";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch {
      console.error("Failed to fetch tasks");
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch {
      console.error("Failed to fetch projects");
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTasks(), fetchProjects()]).finally(() =>
      setIsLoading(false)
    );
  }, [fetchTasks, fetchProjects]);

  const handleProcess = async (transcript: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      if (!res.ok) throw new Error("Processing failed");

      await fetchTasks();
      toast.success("Tasks extracted and added to Inbox!");
    } catch {
      toast.error("Failed to process. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMoveTask = async (taskId: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus, approved: newStatus !== "inbox" }
          : t
      )
    );

    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          status: newStatus,
          approved: newStatus !== "inbox",
        }),
      });
    } catch {
      fetchTasks(); // Revert on error
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

  const handleEdit = (task: Task) => {
    // For POC, just log. Could open a dialog.
    console.log("Edit task:", task);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin w-8 h-8 text-muted-foreground" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-sm text-muted-foreground">Loading FlowBoard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <svg className="w-4 h-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">FlowBoard</h1>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            AI Project Manager
          </span>
        </div>
        <div className="flex items-center gap-4">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-4">
        <VoiceInput onProcess={handleProcess} isProcessing={isProcessing} />
        <KanbanBoard
          tasks={tasks}
          projects={projects}
          onMoveTask={handleMoveTask}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
        />
      </main>

      {/* AI Chat */}
      <AiChat />
    </div>
  );
}
