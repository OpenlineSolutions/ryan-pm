"use client";

import { useState } from "react";
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
  in_progress: "Move tasks here to start",
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
  onMove,
}: {
  task: Task;
  projects: Project[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => void;
}) {
  const [showMove, setShowMove] = useState(false);
  const project = projects.find((p) => p.id === task.project_id);
  const isInbox = task.status === "inbox";
  const otherColumns = STATUS_COLUMNS.filter((c) => c.key !== task.status);

  return (
    <div className="mb-2 relative">
      <Card className="overflow-hidden border-stone-200 shadow-sm">
        {project && (
          <div className="h-[3px] w-full" style={{ backgroundColor: project.color }} />
        )}
        <CardContent className="p-3">
          <div className="flex items-start gap-2 mb-1.5">
            <p className="text-sm font-medium text-stone-900 leading-snug flex-1">
              {task.title}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant="outline"
                className={`text-[10px] font-medium ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.medium}`}
              >
                {task.priority}
              </Badge>
              {/* Move button */}
              <div className="relative">
                <button
                  onClick={() => setShowMove((v) => !v)}
                  className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                  title="Move to column"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                  </svg>
                </button>
                {showMove && (
                  <>
                    {/* backdrop */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowMove(false)}
                    />
                    <div className="absolute right-0 top-6 z-20 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[130px]">
                      <p className="text-[10px] text-stone-400 px-3 py-1 uppercase tracking-wide font-medium">
                        Move to
                      </p>
                      {otherColumns.map((col) => (
                        <button
                          key={col.key}
                          onClick={() => {
                            onMove(task.id, col.key);
                            setShowMove(false);
                          }}
                          className="w-full text-left text-xs text-stone-700 hover:bg-stone-50 px-3 py-1.5 flex items-center gap-2"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${COLUMN_DOT[col.key]}`} />
                          {col.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
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
              <div className="flex gap-1.5 ml-auto shrink-0">
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
  const renderColumns = (mobile = false) =>
    STATUS_COLUMNS.map((col) => {
      const columnTasks = tasks.filter((t) => t.status === col.key);
      if (mobile && columnTasks.length === 0 && col.key !== "inbox") return null;

      return (
        <div key={col.key} className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${COLUMN_DOT[col.key]}`} />
            <span className="text-sm font-medium text-stone-700">{col.label}</span>
            <span className="ml-auto text-xs text-stone-400 tabular-nums font-medium">
              {columnTasks.length}
            </span>
          </div>

          <div
            className="rounded-lg p-2 bg-stone-100/70"
            style={{ minHeight: 80 }}
          >
            {columnTasks.length === 0 && (
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
                onMove={onMoveTask}
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
