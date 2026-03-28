"use client";

import { Task, Project } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TaskCardProps {
  task: Task;
  projects: Project[];
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function TaskCard({ task, projects, onApprove, onReject, onEdit }: TaskCardProps) {
  const project = projects.find((p) => p.id === task.project_id);
  const isInbox = task.status === "inbox";

  return (
    <Card
      className="overflow-hidden shadow-sm hover:shadow-md border-stone-200 transition-shadow cursor-pointer"
      onClick={() => onEdit(task)}
    >
      {project && (
        <div className="h-[3px] w-full" style={{ backgroundColor: project.color }} />
      )}
      <CardContent className="p-3">
        <div className="flex items-start gap-2 mb-1.5">
          <p className="text-sm font-medium text-stone-900 leading-snug flex-1">{task.title}</p>
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
  );
}
