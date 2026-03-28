"use client";

import { useState, useEffect, useCallback } from "react";
import { VoiceInput } from "@/components/voice-input";
import { KanbanBoard } from "@/components/kanban-board";
import { AgentsPanel } from "@/components/agents-panel";
import { TaskSheet } from "@/components/task-sheet";
import { Separator } from "@/components/ui/separator";
import { Task, Project, TaskStatus } from "@/lib/types";
import { toast } from "sonner";

type Tab = "board" | "agents";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("board");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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
  const displayTasks = selectedProjectId
    ? tasks.filter((t) => t.project_id === selectedProjectId)
    : tasks;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-stone-900 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </div>
          <span className="text-[15px] font-semibold text-stone-900">FlowBoard</span>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("board")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === "board"
                ? "bg-white text-stone-900 shadow-sm font-medium"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Board
          </button>
          <button
            onClick={() => setActiveTab("agents")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === "agents"
                ? "bg-white text-stone-900 shadow-sm font-medium"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Agents
          </button>
        </div>

        {/* Task count */}
        <span className="text-xs text-stone-400 shrink-0">
          {activeTasks} active {activeTasks === 1 ? "task" : "tasks"}
        </span>
      </header>

      <Separator />

      {/* Board tab */}
      {activeTab === "board" && (
        <main className="p-5 flex flex-col gap-5">
          {/* Project filter pills */}
          {projects.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setSelectedProjectId(null)}
                className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${
                  selectedProjectId === null
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-500 hover:text-stone-800 border border-stone-200 hover:border-stone-300"
                }`}
              >
                All projects
              </button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id === selectedProjectId ? null : p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${
                    selectedProjectId === p.id
                      ? "bg-stone-900 text-white"
                      : "bg-white text-stone-500 hover:text-stone-800 border border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <VoiceInput onBoardChanged={fetchTasks} />

          <KanbanBoard
            tasks={displayTasks}
            projects={projects}
            onMoveTask={handleMoveTask}
            onApprove={handleApprove}
            onReject={handleReject}
            onEdit={setEditingTask}
          />
        </main>
      )}

      {/* Agents tab */}
      {activeTab === "agents" && <AgentsPanel onBoardChanged={fetchTasks} />}

      {/* Task edit sheet */}
      <TaskSheet
        task={editingTask}
        projects={projects}
        open={editingTask !== null}
        onOpenChange={(open) => { if (!open) setEditingTask(null); }}
        onSaved={fetchTasks}
      />
    </div>
  );
}
