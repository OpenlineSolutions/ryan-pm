"use client";

import { useState, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface VoiceInputProps {
  onBoardChanged: () => void;
}

const SILENCE_DELAY = 2500;

export function VoiceInput({ onBoardChanged }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [agentReply, setAgentReply] = useState("");
  const [textInput, setTextInput] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopRecording = useCallback(() => {
    clearSilenceTimer();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.close();
    }
    setIsRecording(false);
    setInterimText("");
  }, []);

  const runAgent = useCallback(async (text: string) => {
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

      setTranscript("");
      transcriptRef.current = "";
      onBoardChanged();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [onBoardChanged]);

  const autoSubmit = useCallback(async () => {
    stopRecording();
    const text = transcriptRef.current.trim();
    if (text) await runAgent(text);
  }, [stopRecording, runAgent]);

  const startRecording = useCallback(async () => {
    if (isProcessing) return;
    setAgentReply("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tokenRes = await fetch("/api/deepgram-token");
      if (!tokenRes.ok) throw new Error("Failed to get token");
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
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

        const mediaRecorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
        });
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };
        mediaRecorder.start(250);
        setIsRecording(true);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.channel?.alternatives?.[0]) {
          const text = data.channel.alternatives[0].transcript;
          if (data.is_final && text) {
            const updated = transcriptRef.current
              ? transcriptRef.current + " " + text
              : text;
            transcriptRef.current = updated;
            setTranscript(updated);
            setInterimText("");

            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              autoSubmit();
            }, SILENCE_DELAY);
          } else if (text) {
            setInterimText(text);
          }
        }
      };

      socket.onerror = () => {
        toast.error("Voice connection issue. Type below instead.");
        stopRecording();
      };
    } catch {
      toast.error("Microphone access denied. Allow it in your browser and try again.");
    }
  }, [isProcessing, stopRecording, autoSubmit]);

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

        {/* Status */}
        <div className="h-6 flex items-center justify-center">
          {isProcessing ? (
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Thinking...
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
      {displayText && !agentReply && (
        <div className="w-full max-w-xl bg-stone-50 border border-stone-200 rounded-xl px-5 py-4">
          <p className="text-sm text-stone-700 leading-relaxed">
            {transcript}
            {interimText && <span className="text-stone-400"> {interimText}</span>}
          </p>
        </div>
      )}

      {/* AI reply after processing */}
      {agentReply && (
        <div className="w-full max-w-xl bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-emerald-500 mt-0.5 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p className="text-sm text-emerald-800 leading-relaxed">{agentReply}</p>
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
