"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
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

function TaskCardContent({
  task,
  projects,
  onApprove,
  onReject,
  isDragging = false,
}: {
  task: Task;
  projects: Project[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  isDragging?: boolean;
}) {
  const project = projects.find((p) => p.id === task.project_id);
  const isInbox = task.status === "inbox";

  return (
    <Card
      className={`overflow-hidden border-stone-200 select-none ${
        isDragging
          ? "shadow-2xl ring-2 ring-blue-300"
          : "shadow-sm"
      }`}
    >
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

          {isInbox && onApprove && onReject && (
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

// Draggable card — listeners on the full outer div so ANY grab point works
function DraggableTaskCard({
  task,
  projects,
  onApprove,
  onReject,
  onEdit,
}: {
  task: Task;
  projects: Project[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-2 touch-none ${isDragging ? "opacity-30" : "cursor-grab active:cursor-grabbing"}`}
      {...attributes}
      {...listeners}
      // Prevent drag from stealing button clicks
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        (listeners as any)?.onPointerDown?.(e);
      }}
    >
      <TaskCardContent
        task={task}
        projects={projects}
        onApprove={onApprove}
        onReject={onReject}
        isDragging={isDragging}
      />
    </div>
  );
}

function DroppableColumn({
  col,
  tasks,
  projects,
  isOver,
  onApprove,
  onReject,
  onEdit,
}: {
  col: { key: TaskStatus; label: string };
  tasks: Task[];
  projects: Project[];
  isOver: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  const { setNodeRef, isOver: dropIsOver } = useDroppable({ id: col.key });
  const highlighted = isOver || dropIsOver;

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${COLUMN_DOT[col.key]}`} />
        <span className="text-sm font-medium text-stone-700">{col.label}</span>
        <span className="ml-auto text-xs text-stone-400 tabular-nums font-medium">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-lg p-2 transition-colors duration-100 overflow-y-auto ${
          highlighted ? "bg-blue-50 ring-1 ring-blue-300" : "bg-stone-100/70"
        }`}
        style={{ minHeight: 80 }}
      >
        {tasks.length === 0 && !highlighted && (
          <p className="text-xs text-stone-400 text-center py-8 px-2 leading-relaxed">
            {COLUMN_EMPTY[col.key]}
          </p>
        )}
        {tasks.map((task) => (
          <DraggableTaskCard
            key={task.id}
            task={task}
            projects={projects}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({
  tasks,
  projects,
  onMoveTask,
  onApprove,
  onReject,
  onEdit,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  // Track drag width so overlay matches the real card size
  const [activeDragWidth, setActiveDragWidth] = useState<number>(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
    const rect = event.active.rect.current.initial;
    if (rect) setActiveDragWidth(rect.width);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverColumn((event.over?.id as TaskStatus) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    setOverColumn(null);
    if (!event.over) return;
    const newStatus = event.over.id as TaskStatus;
    const task = tasks.find((t) => t.id === event.active.id);
    if (task && task.status !== newStatus) {
      onMoveTask(task.id, newStatus);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Desktop */}
      <div className="hidden md:flex flex-row gap-4 h-full">
        {STATUS_COLUMNS.map((col) => (
          <DroppableColumn
            key={col.key}
            col={col}
            tasks={tasks.filter((t) => t.status === col.key)}
            projects={projects}
            isOver={overColumn === col.key}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={onEdit}
          />
        ))}
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-4 overflow-y-auto">
        {STATUS_COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.key);
          if (columnTasks.length === 0 && col.key !== "inbox") return null;
          return (
            <DroppableColumn
              key={col.key}
              col={col}
              tasks={columnTasks}
              projects={projects}
              isOver={overColumn === col.key}
              onApprove={onApprove}
              onReject={onReject}
              onEdit={onEdit}
            />
          );
        })}
      </div>

      {/* DragOverlay — portal rendered at document.body, always above columns */}
      <DragOverlay
        dropAnimation={{ duration: 150, easing: "ease" }}
        style={{ zIndex: 9999 }}
      >
        {activeTask && (
          <div style={{ width: activeDragWidth || undefined }}>
            <TaskCardContent
              task={activeTask}
              projects={projects}
              isDragging
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
