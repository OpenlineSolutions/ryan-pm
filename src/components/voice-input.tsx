"use client";

import { useState, useRef, useCallback } from "react";
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const startRecording = useCallback(async () => {
    try {
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
        // Start sending audio
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
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
    } catch (err) {
      console.error("Microphone error:", err);
      toast.error(
        "Could not access microphone. Please allow microphone access and try again."
      );
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
