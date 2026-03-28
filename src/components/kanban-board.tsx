"use client";

import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { TaskCard } from "@/components/task-card";
import { Task, Project, STATUS_COLUMNS, TaskStatus } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface KanbanBoardProps {
  tasks: Task[];
  projects: Project[];
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

export function KanbanBoard({
  tasks,
  projects,
  onMoveTask,
  onApprove,
  onReject,
  onEdit,
}: KanbanBoardProps) {
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    if (newStatus !== result.source.droppableId) {
      onMoveTask(result.draggableId, newStatus);
    }
  };

  const columnColors: Record<TaskStatus, string> = {
    inbox: "bg-yellow-500",
    todo: "bg-blue-500",
    in_progress: "bg-purple-500",
    done: "bg-green-500",
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Desktop: horizontal columns */}
      <div className="hidden md:grid md:grid-cols-4 gap-4 flex-1 min-h-0">
        {STATUS_COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span
                  className={`w-2 h-2 rounded-full ${columnColors[col.key]}`}
                />
                <h3 className="text-sm font-medium text-muted-foreground">
                  {col.label}
                </h3>
                <span className="text-xs text-muted-foreground/60 ml-auto">
                  {columnTasks.length}
                </span>
              </div>
              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <ScrollArea className="flex-1">
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-[100px] rounded-lg p-2 transition-colors ${
                        snapshot.isDraggingOver
                          ? "bg-primary/5 ring-1 ring-primary/20"
                          : "bg-muted/30"
                      }`}
                    >
                      {columnTasks.length === 0 && !snapshot.isDraggingOver && (
                        <p className="text-xs text-muted-foreground/40 text-center py-8">
                          {col.key === "inbox"
                            ? "Record a voice note to get started"
                            : "Drag tasks here"}
                        </p>
                      )}
                      {columnTasks.map((task, index) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={index}
                          projects={projects}
                          onApprove={onApprove}
                          onReject={onReject}
                          onEdit={onEdit}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  </ScrollArea>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>

      {/* Mobile: stacked columns */}
      <div className="md:hidden space-y-4 flex-1 overflow-y-auto">
        {STATUS_COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.key);
          if (columnTasks.length === 0 && col.key !== "inbox") return null;
          return (
            <div key={col.key}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span
                  className={`w-2 h-2 rounded-full ${columnColors[col.key]}`}
                />
                <h3 className="text-sm font-medium text-muted-foreground">
                  {col.label}
                </h3>
                <span className="text-xs text-muted-foreground/60">
                  {columnTasks.length}
                </span>
              </div>
              <Droppable droppableId={col.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[60px] rounded-lg p-2 transition-colors ${
                      snapshot.isDraggingOver
                        ? "bg-primary/5 ring-1 ring-primary/20"
                        : "bg-muted/30"
                    }`}
                  >
                    {columnTasks.length === 0 && (
                      <p className="text-xs text-muted-foreground/40 text-center py-4">
                        Record a voice note to get started
                      </p>
                    )}
                    {columnTasks.map((task, index) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        index={index}
                        projects={projects}
                        onApprove={onApprove}
                        onReject={onReject}
                        onEdit={onEdit}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
