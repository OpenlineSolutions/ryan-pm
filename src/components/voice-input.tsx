"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface VoiceInputProps {
  onProcess: (transcript: string) => Promise<void>;
  isProcessing: boolean;
}

export function VoiceInput({ onProcess, isProcessing }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions.query({ name: "microphone" as PermissionName }).then((result) => {
        setMicBlocked(result.state === "denied");
        result.onchange = () => setMicBlocked(result.state === "denied");
      }).catch(() => {});
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Microphone not available. Use HTTPS or type your notes below.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get Deepgram token from our API
      const tokenRes = await fetch("/api/deepgram-token");
      if (!tokenRes.ok) throw new Error("Failed to get transcription token");
      const { token } = await tokenRes.json();

      // Connect to Deepgram WebSocket
      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true`,
        ["token", token]
      );
      socketRef.current = socket;

      socket.onopen = () => {
        // Pick the best supported MIME type
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

        mediaRecorder.start(250); // Send chunks every 250ms
        setIsRecording(true);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.channel?.alternatives?.[0]) {
          const text = data.channel.alternatives[0].transcript;
          if (data.is_final && text) {
            setTranscript((prev) => (prev ? prev + " " + text : text));
            setInterimText("");
          } else if (text) {
            setInterimText(text);
          }
        }
      };

      socket.onerror = () => {
        toast.error("Voice connection issue. You can type or paste text below.");
        stopRecording();
      };
    } catch (err: any) {
      console.error("Microphone error:", err?.name, err?.message);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        toast.error("Microphone blocked. Click the lock icon in your browser's address bar to allow access, then refresh.");
      } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
        toast.error("No microphone found. Please connect a microphone and try again.");
      } else if (err?.name === "NotReadableError") {
        toast.error("Microphone is in use by another app. Close other apps and try again.");
      } else {
        toast.error("Could not access microphone. You can type or paste your notes below instead.");
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.close();
    }
    setIsRecording(false);
    setInterimText("");
  }, []);

  const handleProcess = async () => {
    const fullText = transcript.trim();
    if (!fullText) {
      toast.error("Nothing to process. Record or type something first.");
      return;
    }
    await onProcess(fullText);
    setTranscript("");
  };

  return (
    <Card className="p-6 border-border bg-card">
      {micBlocked && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
          <strong>Microphone blocked.</strong> Click the lock icon in your browser's address bar → set Microphone to <strong>Allow</strong> → refresh the page.
        </div>
      )}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all ${
            isRecording
              ? "bg-red-500 hover:bg-red-600"
              : "bg-zinc-700 hover:bg-zinc-600"
          }`}
        >
          {isRecording && (
            <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
          )}
          <svg
            className="w-6 h-6 text-white relative z-10"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            {isRecording ? (
              <rect x="6" y="6" width="12" height="12" rx="2" />
            ) : (
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            )}
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-foreground">
            {isRecording ? "Listening..." : "Voice Input"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isRecording
              ? "Speak naturally. Click stop when done."
              : "Click the mic to start recording, or type below."}
          </p>
        </div>
        <Button
          onClick={handleProcess}
          disabled={isProcessing || !transcript.trim()}
          className="px-6"
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Processing...
            </span>
          ) : (
            "Process with AI"
          )}
        </Button>
      </div>
      <Textarea
        value={transcript + (interimText ? " " + interimText : "")}
        onChange={(e) => {
          setTranscript(e.target.value);
          setInterimText("");
        }}
        placeholder="Your voice transcript will appear here, or paste meeting notes..."
        className="min-h-[100px] bg-background border-border text-foreground placeholder:text-muted-foreground resize-none"
      />
    </Card>
  );
}
