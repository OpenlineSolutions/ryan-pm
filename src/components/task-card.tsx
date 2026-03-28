"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Task, Project, PRIORITY_COLORS } from "@/lib/types";
import { Draggable } from "@hello-pangea/dnd";

interface TaskCardProps {
  task: Task;
  index: number;
  projects: Project[];
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

export function TaskCard({
  task,
  index,
  projects,
  onApprove,
  onReject,
  onEdit,
}: TaskCardProps) {
  const project = projects.find((p) => p.id === task.project_id);
  const isInbox = task.status === "inbox";

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-2"
        >
          <Card
            className={`p-3 border-border bg-card cursor-grab active:cursor-grabbing transition-shadow ${
              snapshot.isDragging ? "shadow-lg shadow-black/20 ring-1 ring-primary/30" : ""
            } ${isInbox ? "border-l-2 border-l-yellow-500" : ""}`}
            onClick={() => onEdit(task)}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="text-sm font-medium text-foreground leading-tight">
                {task.title}
              </h3>
              <Badge
                variant="outline"
                className={`text-[10px] shrink-0 ${PRIORITY_COLORS[task.priority]}`}
              >
                {task.priority}
              </Badge>
            </div>

            {task.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                {task.description}
              </p>
            )}

            <div className="flex items-center justify-between">
              {project && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                    {project.name}
                  </span>
                </div>
              )}

              {isInbox && (
                <div className="flex gap-1 ml-auto" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10"
                    onClick={() => onApprove(task.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => onReject(task.id)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </Draggable>
  );
}
