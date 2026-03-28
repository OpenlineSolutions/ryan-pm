"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDeepgram } from "@/hooks/use-deepgram";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { VoiceLog } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AgentsPanelProps {
  onBoardChanged: () => void;
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const AGENT_SUGGESTIONS = [
  "What's my highest priority right now?",
  "Move all inbox tasks to To Do",
  "What did I work on this week?",
];

export function AgentsPanel({ onBoardChanged }: AgentsPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activity, setActivity] = useState<VoiceLog[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resetTranscriptRef = useRef<() => void>(() => {});

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      if (res.ok) setActivity(await res.json());
    } catch {
      // activity feed is non-critical
    }
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      setInput("");
      resetTranscriptRef.current();
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) throw new Error("Chat failed");

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let reply = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: reply };
            return updated;
          });
        }

        onBoardChanged();
        fetchActivity();
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
        toast.error("Chat failed. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, onBoardChanged, fetchActivity] // resetTranscript added after hook init
  );

  const { isRecording, startRecording, stopRecording, resetTranscript } = useDeepgram({
    silenceDelay: 2000,
    onTranscript: (text) => {
      setInput(text);
      sendMessage(text);
    },
  });

  // Keep ref current so sendMessage always calls the latest resetTranscript
  resetTranscriptRef.current = resetTranscript;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input.trim());
  };

  return (
    <div className="p-5 max-w-4xl mx-auto flex flex-col gap-8">
      {/* Agent Cards */}
      <section>
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
          Your Agents
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Task Agent — active */}
          <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-lg bg-stone-900 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </div>
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">
                Active
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-900">Task Agent</p>
              <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                Listens to your voice and text commands. Creates, moves, and manages tasks on your board.
              </p>
            </div>
            {activity.length > 0 && (
              <p className="text-[11px] text-stone-400">
                Last active {relativeTime(activity[0].processed_at)}
              </p>
            )}
          </div>

          {/* Slack Agent — coming soon */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex flex-col gap-3 opacity-60">
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-lg bg-stone-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-stone-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
              </div>
              <Badge variant="outline" className="text-[11px] text-stone-400 border-stone-300">
                Coming soon
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-700">Slack Agent</p>
              <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
                Monitors Slack messages and turns action items into board tasks automatically.
              </p>
            </div>
          </div>

          {/* WhatsApp Agent — coming soon */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex flex-col gap-3 opacity-60">
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-lg bg-stone-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-stone-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
              </div>
              <Badge variant="outline" className="text-[11px] text-stone-400 border-stone-300">
                Coming soon
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-700">WhatsApp Agent</p>
              <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">
                Captures tasks and updates from WhatsApp messages and voice notes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Activity Feed */}
      <section>
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
          Recent Activity
        </h2>
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          {activity.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-8">
              No activity yet. Speak or type a command to get started.
            </p>
          ) : (
            <div className="divide-y divide-stone-100">
              {activity.slice(0, 8).map((log) => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-700 truncate">
                      {log.transcript.length > 80
                        ? log.transcript.slice(0, 80) + "..."
                        : log.transcript}
                    </p>
                    {log.task_count > 0 && (
                      <p className="text-xs text-stone-400 mt-0.5">
                        {log.task_count} task{log.task_count !== 1 ? "s" : ""} created
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-stone-400 shrink-0 mt-0.5">
                    {relativeTime(log.processed_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Talk to Agents */}
      <section>
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
          Talk to Your Agents
        </h2>
        <div className="bg-white border border-stone-200 rounded-xl flex flex-col overflow-hidden">
          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[320px]"
          >
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-stone-400 text-center">Try asking:</p>
                {AGENT_SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left text-xs text-stone-600 hover:text-stone-900 px-3 py-2 rounded-lg bg-stone-50 hover:bg-stone-100 border border-stone-200 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-stone-900 text-white rounded-br-sm"
                      : "bg-stone-100 text-stone-800 border border-stone-200 rounded-bl-sm"
                  }`}
                >
                  {msg.content ? (
                    msg.role === "assistant" ? (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          strong: ({ children }) => (
                            <strong className="font-semibold">{children}</strong>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc pl-4 mb-1">{children}</ul>
                          ),
                          li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )
                  ) : (
                    <span className="inline-flex gap-1 items-center py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-stone-100 p-3">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-stone-100 hover:bg-stone-200"
                }`}
              >
                {isRecording ? (
                  <span className="w-2.5 h-2.5 rounded-sm bg-white" />
                ) : (
                  <svg
                    className="w-4 h-4 text-stone-500"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                )}
              </button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isRecording ? "Listening..." : "Ask anything or give a command..."}
                disabled={isLoading}
                className="text-sm border-stone-200 focus-visible:ring-1 focus-visible:ring-blue-500"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isLoading || !input.trim()}
                className="shrink-0 px-3"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </Button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
