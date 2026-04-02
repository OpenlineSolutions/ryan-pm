"use client";

import { useEffect, useState, useCallback } from "react";

type TaskItem = {
  title: string;
  description: string;
  steps: string[];
  project: string | null;
  assignee: string | null;
  priority: string;
  due_date: string | null;
  included: boolean;
};

const PROJECTS = [
  "McDonalds",
  "Burger King",
  "In-N-Out",
  "Chick-fil-A",
  "Chipotle",
  "Internal",
];
const ASSIGNEES = ["Ryan", "Sarah", "Jake", "Mike"];
const PRIORITIES = ["Urgent", "High", "Medium", "Low"];

function getPriorityColor(priority: string): string {
  switch (priority) {
    case "Urgent":
      return "#e53935";
    case "High":
      return "#fb8c00";
    case "Medium":
      return "#fdd835";
    case "Low":
      return "#66bb6a";
    default:
      return "#999";
  }
}

export default function TelegramMiniApp() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [chatId, setChatId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Load Telegram Web App SDK
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = () => {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
      }
    };
    document.head.appendChild(script);

    // Parse task data from URL
    const params = new URLSearchParams(window.location.search);
    const dataParam = params.get("data");
    const chatParam = params.get("chat");

    if (chatParam) setChatId(chatParam);

    if (dataParam) {
      try {
        const decoded = JSON.parse(atob(dataParam));
        const items: TaskItem[] = (decoded.tasks || []).map((t: any) => ({
          title: t.title || "",
          description: t.description || "",
          steps: t.steps || [],
          project: t.project || null,
          assignee: t.assignee || null,
          priority: t.priority || "Medium",
          due_date: t.due_date || null,
          included: true,
        }));
        setTasks(items);
        if (decoded.chatId) setChatId(decoded.chatId);
      } catch (e) {
        setError("Failed to load task data");
      }
    } else {
      setError("No task data provided");
    }
    setLoading(false);
  }, []);

  const updateTask = useCallback(
    (index: number, field: keyof TaskItem, value: any) => {
      setTasks((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
    },
    []
  );

  const handleApprove = async () => {
    const selected = tasks.filter((t) => t.included);
    if (selected.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/telegram/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: selected, chatId }),
      });
      if (!res.ok) throw new Error("Failed to create tasks");
      setSuccess(true);

      // Close the Mini App after a short delay
      setTimeout(() => {
        const tg = (window as any).Telegram?.WebApp;
        if (tg) tg.close();
      }, 1500);
    } catch (e) {
      setError("Failed to approve tasks. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) tg.close();
  };

  const selectedCount = tasks.filter((t) => t.included).length;

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.loadingText}>Loading tasks...</p>
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <div style={styles.container}>
        <p style={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (success) {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <span style={{ fontSize: 48 }}>&#10003;</span>
          <h2 style={styles.successTitle}>Tasks Created!</h2>
          <p style={styles.successSub}>
            {selectedCount} task{selectedCount !== 1 ? "s" : ""} added to Notion
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Review Tasks</h1>
        <p style={styles.subtitle}>
          {tasks.length} task{tasks.length !== 1 ? "s" : ""} found.{" "}
          {selectedCount} selected.
        </p>
      </div>

      <div style={styles.taskList}>
        {tasks.map((task, i) => (
          <div
            key={i}
            style={{
              ...styles.taskCard,
              opacity: task.included ? 1 : 0.5,
            }}
          >
            {/* Toggle + Title Row */}
            <div style={styles.taskHeader}>
              <button
                onClick={() => updateTask(i, "included", !task.included)}
                style={{
                  ...styles.toggleBtn,
                  backgroundColor: task.included
                    ? "var(--tg-theme-button-color, #2481cc)"
                    : "transparent",
                  border: task.included
                    ? "none"
                    : "2px solid var(--tg-theme-hint-color, #999)",
                }}
              >
                {task.included && (
                  <span style={{ color: "#fff", fontSize: 14 }}>&#10003;</span>
                )}
              </button>
              <input
                type="text"
                value={task.title}
                onChange={(e) => updateTask(i, "title", e.target.value)}
                style={styles.titleInput}
                placeholder="Task title"
              />
            </div>

            {task.included && (
              <div style={styles.fields}>
                {/* Project */}
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>Project</label>
                  <select
                    value={task.project || ""}
                    onChange={(e) =>
                      updateTask(
                        i,
                        "project",
                        e.target.value || null
                      )
                    }
                    style={styles.select}
                  >
                    <option value="">None</option>
                    {PROJECTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assignee */}
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>Assignee</label>
                  <select
                    value={task.assignee || ""}
                    onChange={(e) =>
                      updateTask(
                        i,
                        "assignee",
                        e.target.value || null
                      )
                    }
                    style={styles.select}
                  >
                    <option value="">None</option>
                    {ASSIGNEES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Priority */}
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>Priority</label>
                  <select
                    value={task.priority}
                    onChange={(e) => updateTask(i, "priority", e.target.value)}
                    style={{
                      ...styles.select,
                      borderLeft: `3px solid ${getPriorityColor(task.priority)}`,
                    }}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Due Date */}
                <div style={styles.fieldRow}>
                  <label style={styles.fieldLabel}>Due Date</label>
                  <input
                    type="date"
                    value={task.due_date || ""}
                    onChange={(e) =>
                      updateTask(
                        i,
                        "due_date",
                        e.target.value || null
                      )
                    }
                    style={styles.dateInput}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.footer}>
        <button onClick={handleCancel} style={styles.cancelBtn}>
          Cancel
        </button>
        <button
          onClick={handleApprove}
          disabled={submitting || selectedCount === 0}
          style={{
            ...styles.approveBtn,
            opacity: submitting || selectedCount === 0 ? 0.5 : 1,
          }}
        >
          {submitting
            ? "Creating..."
            : `Approve ${selectedCount} Task${selectedCount !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #000)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    padding: "16px",
    boxSizing: "border-box",
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: "var(--tg-theme-hint-color, #999)",
    margin: "4px 0 0 0",
  },
  taskList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 80,
  },
  taskCard: {
    backgroundColor: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    borderRadius: 12,
    padding: 14,
    transition: "opacity 0.2s",
  },
  taskHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  toggleBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: "pointer",
    padding: 0,
  },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--tg-theme-text-color, #000)",
    padding: "4px 0",
  },
  fields: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  fieldRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    color: "var(--tg-theme-hint-color, #999)",
    width: 70,
    flexShrink: 0,
  },
  select: {
    flex: 1,
    fontSize: 14,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ddd)",
    backgroundColor: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #000)",
    appearance: "auto" as any,
  },
  dateInput: {
    flex: 1,
    fontSize: 14,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ddd)",
    backgroundColor: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #000)",
  },
  footer: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    padding: "12px 16px",
    paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
    backgroundColor: "var(--tg-theme-bg-color, #fff)",
    borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
    display: "flex",
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    padding: "12px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 10,
    border: "1px solid var(--tg-theme-hint-color, #ddd)",
    backgroundColor: "transparent",
    color: "var(--tg-theme-text-color, #000)",
    cursor: "pointer",
  },
  approveBtn: {
    flex: 2,
    padding: "12px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    backgroundColor: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    cursor: "pointer",
  },
  loadingText: {
    textAlign: "center",
    marginTop: 100,
    fontSize: 16,
    color: "var(--tg-theme-hint-color, #999)",
  },
  errorText: {
    color: "#e53935",
    fontSize: 14,
    textAlign: "center",
    padding: "8px 0",
  },
  successBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
    gap: 8,
    color: "#66bb6a",
  },
  successTitle: {
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
    color: "var(--tg-theme-text-color, #000)",
  },
  successSub: {
    fontSize: 14,
    color: "var(--tg-theme-hint-color, #999)",
    margin: 0,
  },
};
