"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AiChatProps {
  onBoardChanged?: () => void;
}

const SUGGESTIONS = [
  "What's my highest priority?",
  "Mark the team standup as done",
  "Move all inbox tasks to To Do",
];

const SILENCE_DELAY = 2000;

export function AiChat({ onBoardChanged }: AiChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    setInput("");
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
      let assistantMessage = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantMessage += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantMessage };
          return updated;
        });
      }

      // Refresh the board — AI may have moved/deleted tasks
      onBoardChanged?.();
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, onBoardChanged]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input.trim());
  };

  // Voice for chat commands
  const stopVoice = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.close();
    }
    setIsRecording(false);
    transcriptRef.current = "";
  }, []);

  const startVoice = useCallback(async () => {
    if (isLoading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tokenRes = await fetch("/api/deepgram-token");
      if (!tokenRes.ok) throw new Error("Token failed");
      const { token } = await tokenRes.json();

      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true`,
        ["token", token]
      );
      socketRef.current = socket;

      socket.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

        const mr = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(e.data);
          }
        };
        mr.start(250);
        setIsRecording(true);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.channel?.alternatives?.[0]) {
          const text = data.channel.alternatives[0].transcript;
          if (data.is_final && text) {
            transcriptRef.current = transcriptRef.current
              ? transcriptRef.current + " " + text
              : text;
            setInput(transcriptRef.current);

            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              const cmd = transcriptRef.current.trim();
              stopVoice();
              if (cmd) sendMessage(cmd);
            }, SILENCE_DELAY);
          }
        }
      };

      socket.onerror = () => {
        toast.error("Voice connection issue.");
        stopVoice();
      };
    } catch {
      toast.error("Microphone access denied.");
    }
  }, [isLoading, stopVoice, sendMessage]);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 gap-2 shadow-lg z-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        Ask AI
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-5 right-5 w-[380px] max-h-[540px] flex flex-col z-50 shadow-xl border-stone-200">
      <CardHeader className="p-4 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-stone-900">AI Assistant</p>
            <p className="text-xs text-stone-500">Ask questions or give commands</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-stone-400 hover:text-stone-600"
            onClick={() => setIsOpen(false)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      </CardHeader>

      <Separator />

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[370px]">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-stone-400 text-center">Try asking or commanding:</p>
            {SUGGESTIONS.map((q) => (
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
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      ul: ({ children }) => <ul className="list-disc pl-4 mb-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-1">{children}</ol>,
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

      <Separator />

      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3 shrink-0">
        {/* Voice button */}
        <button
          type="button"
          onClick={isRecording ? stopVoice : startVoice}
          disabled={isLoading}
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
            isRecording
              ? "bg-red-500 hover:bg-red-600"
              : "bg-stone-100 hover:bg-stone-200"
          }`}
          title={isRecording ? "Stop recording" : "Speak a command"}
        >
          {isRecording ? (
            <span className="w-2.5 h-2.5 rounded-sm bg-white" />
          ) : (
            <svg className="w-4 h-4 text-stone-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>

        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isRecording ? "Listening..." : "Ask or command..."}
          disabled={isLoading}
          className="text-sm border-stone-200 focus-visible:ring-1 focus-visible:ring-blue-500"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isLoading || !input.trim()}
          className="shrink-0 px-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Button>
      </form>
    </Card>
  );
}
