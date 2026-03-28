"use client";

import { useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDeepgram } from "@/hooks/use-deepgram";
import { toast } from "sonner";

interface VoiceInputProps {
  onBoardChanged: () => void;
}

export function VoiceInput({ onBoardChanged }: VoiceInputProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [agentReply, setAgentReply] = useState("");
  const [textInput, setTextInput] = useState("");
  const resetTranscriptRef = useRef<() => void>(() => {});

  const runAgent = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setIsProcessing(true);
      setAgentReply("");
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        if (!res.ok) throw new Error("Agent failed");

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let reply = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply += decoder.decode(value, { stream: true });
          setAgentReply(reply);
        }

        onBoardChanged();
      } catch {
        toast.error("Something went wrong. Please try again.");
      } finally {
        setIsProcessing(false);
        resetTranscriptRef.current();
      }
    },
    [onBoardChanged]
  );

  const { isRecording, transcript, interimText, startRecording, stopRecording, resetTranscript } =
    useDeepgram({
      silenceDelay: 2500,
      onTranscript: runAgent,
    });

  // Keep ref current so runAgent always calls the latest resetTranscript
  resetTranscriptRef.current = resetTranscript;

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text || isProcessing) return;
    setTextInput("");
    await runAgent(text);
  };

  const displayText = transcript + (interimText ? " " + interimText : "");

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {/* Mic button */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center">
          {isRecording && (
            <>
              <span className="mic-ring-1 absolute inset-0 rounded-full bg-red-500/20" />
              <span className="mic-ring-2 absolute inset-0 rounded-full bg-red-500/15" />
              <span className="mic-ring-3 absolute inset-0 rounded-full bg-red-500/10" />
            </>
          )}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-offset-2 disabled:opacity-40 ${
              isRecording
                ? "bg-red-500 hover:bg-red-600 focus:ring-red-200 shadow-xl shadow-red-200"
                : "bg-stone-900 hover:bg-stone-700 focus:ring-stone-200 shadow-lg"
            }`}
          >
            <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
              {isRecording ? (
                <rect x="7" y="7" width="10" height="10" rx="2" />
              ) : (
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              )}
            </svg>
          </button>
        </div>

        {/* Status line */}
        <div className="h-6 flex items-center justify-center">
          {isProcessing ? (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Working...
            </div>
          ) : isRecording ? (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-600">Recording — stops automatically</span>
            </div>
          ) : (
            <span className="text-sm text-stone-400">Tap to speak — add tasks, move them, anything</span>
          )}
        </div>
      </div>

      {/* Live transcript while recording */}
      {displayText && !agentReply && !isProcessing && (
        <div className="w-full max-w-xl bg-stone-50 border border-stone-200 rounded-xl px-5 py-4">
          <p className="text-sm text-stone-700 leading-relaxed">
            {transcript}
            {interimText && <span className="text-stone-400"> {interimText}</span>}
          </p>
        </div>
      )}

      {/* Live agent stream — shows while processing AND stays after done */}
      {agentReply && (
        <div className={`w-full max-w-xl rounded-xl px-5 py-4 flex items-start gap-3 transition-colors duration-500 ${
          isProcessing
            ? "bg-blue-50 border border-blue-200"
            : "bg-emerald-50 border border-emerald-200"
        }`}>
          <span className={`mt-0.5 shrink-0 ${isProcessing ? "text-blue-400" : "text-emerald-500"}`}>
            {isProcessing ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
          <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isProcessing ? "text-blue-800" : "text-emerald-800"}`}>
            {agentReply}
          </p>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 w-full max-w-xl">
        <div className="flex-1 h-px bg-stone-200" />
        <span className="text-xs text-stone-400 uppercase tracking-wide">or type</span>
        <div className="flex-1 h-px bg-stone-200" />
      </div>

      {/* Text input */}
      <form onSubmit={handleTextSubmit} className="flex gap-2 w-full max-w-xl">
        <Input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder='e.g. "Add a call with Joy Dental for Friday, mark standup as done"'
          disabled={isProcessing || isRecording}
          className="flex-1 text-sm border-stone-200 focus-visible:ring-1 focus-visible:ring-blue-500"
        />
        <Button type="submit" disabled={isProcessing || !textInput.trim()} className="shrink-0">
          Go
        </Button>
      </form>
    </div>
  );
}
