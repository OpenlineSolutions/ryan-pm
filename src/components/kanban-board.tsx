"use client";

import { useState, useRef } from "react";
import { Task, Project, STATUS_COLUMNS, TaskStatus } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface KanbanBoardProps {
  tasks: Task[];
  projects: Project[];
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

const COLUMN_DOT: Record<TaskStatus, string> = {
  inbox: "bg-amber-400",
  todo: "bg-blue-400",
  in_progress: "bg-violet-400",
  done: "bg-emerald-400",
};

const COLUMN_EMPTY: Record<TaskStatus, string> = {
  inbox: "Record a voice note to add tasks",
  todo: "Approved tasks appear here",
  in_progress: "Drag tasks here to start",
  done: "Completed tasks land here",
};

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function TaskCard({
  task,
  projects,
  onApprove,
  onReject,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  projects: Project[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isDragging: boolean;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}) {
  const project = projects.find((p) => p.id === task.project_id);
  const isInbox = task.status === "inbox";

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Don't drag if clicking a button
        if ((e.target as HTMLElement).closest("button")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className={`mb-2 cursor-grab active:cursor-grabbing transition-opacity duration-150 ${
        isDragging ? "opacity-40" : "opacity-100"
      }`}
    >
      <Card className="overflow-hidden border-stone-200 shadow-sm select-none">
        {project && (
          <div className="h-[3px] w-full" style={{ backgroundColor: project.color }} />
        )}
        <CardContent className="p-3">
          <div className="flex items-start gap-2 mb-1.5">
            <p className="text-sm font-medium text-stone-900 leading-snug flex-1">
              {task.title}
            </p>
            <Badge
              variant="outline"
              className={`text-[10px] font-medium shrink-0 ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.medium}`}
            >
              {task.priority}
            </Badge>
          </div>

          {task.description && (
            <p className="text-xs text-stone-500 mb-2.5 line-clamp-2 leading-relaxed">
              {task.description}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {project && (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                <span className="text-[11px] text-stone-400 truncate">{project.name}</span>
              </div>
            )}

            {isInbox && (
              <div className="flex gap-1.5 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                  onClick={() => onApprove(task.id)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => onReject(task.id)}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function KanbanBoard({
  tasks,
  projects,
  onMoveTask,
  onApprove,
  onReject,
}: KanbanBoardProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  // Counter tracks nested dragenter/dragleave so highlight doesn't flicker
  const dragCounter = useRef<Record<string, number>>({});

  const handleDrop = (e: React.DragEvent, colKey: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.status !== colKey) {
      onMoveTask(taskId, colKey);
    }
    setDraggingTaskId(null);
    setOverColumn(null);
    dragCounter.current[colKey] = 0;
  };

  const handleDragEnter = (e: React.DragEvent, colKey: TaskStatus) => {
    e.preventDefault();
    dragCounter.current[colKey] = (dragCounter.current[colKey] ?? 0) + 1;
    setOverColumn(colKey);
  };

  const handleDragLeave = (colKey: TaskStatus) => {
    dragCounter.current[colKey] = (dragCounter.current[colKey] ?? 1) - 1;
    if (dragCounter.current[colKey] === 0) {
      setOverColumn((prev) => (prev === colKey ? null : prev));
    }
  };

  const renderColumns = (mobile = false) =>
    STATUS_COLUMNS.map((col) => {
      const columnTasks = tasks.filter((t) => t.status === col.key);
      if (mobile && columnTasks.length === 0 && col.key !== "inbox") return null;
      const isOver = overColumn === col.key;

      return (
        <div key={col.key} className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${COLUMN_DOT[col.key]}`} />
            <span className="text-sm font-medium text-stone-700">{col.label}</span>
            <span className="ml-auto text-xs text-stone-400 tabular-nums font-medium">
              {columnTasks.length}
            </span>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => handleDragEnter(e, col.key)}
            onDragLeave={() => handleDragLeave(col.key)}
            onDrop={(e) => handleDrop(e, col.key)}
            className={`rounded-lg p-2 transition-colors duration-100 ${
              isOver
                ? "bg-blue-50 ring-1 ring-blue-300"
                : "bg-stone-100/70"
            }`}
            style={{ minHeight: 80 }}
          >
            {columnTasks.length === 0 && !isOver && (
              <p className="text-xs text-stone-400 text-center py-8 px-2 leading-relaxed">
                {COLUMN_EMPTY[col.key]}
              </p>
            )}
            {columnTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                projects={projects}
                onApprove={onApprove}
                onReject={onReject}
                isDragging={draggingTaskId === task.id}
                onDragStart={setDraggingTaskId}
                onDragEnd={() => {
                  setDraggingTaskId(null);
                  setOverColumn(null);
                }}
              />
            ))}
          </div>
        </div>
      );
    });

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex flex-row gap-4 items-start">
        {renderColumns()}
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-4">
        {renderColumns(true)}
      </div>
    </>
  );
}
