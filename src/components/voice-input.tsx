"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
            setTranscript((prev) => (prev ? prev + " " + text : text));
            setInterimText("");
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
  }, []);

  const stopRecording = useCallback(() => {
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

  const handleProcess = async () => {
    const fullText = transcript.trim();
    if (!fullText) {
      toast.error("Record or type something first.");
      return;
    }
    await onProcess(fullText);
    setTranscript("");
  };

  const displayText = transcript + (interimText ? " " + interimText : "");
  const wordCount = displayText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <Card className="shadow-sm border-stone-200">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">

          {/* Mic side */}
          <div className="flex flex-col items-center justify-center gap-3 p-8 md:w-52 shrink-0">
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
                className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
                  isRecording
                    ? "bg-red-500 hover:bg-red-600 focus:ring-red-500 shadow-lg shadow-red-200"
                    : "bg-stone-900 hover:bg-stone-700 focus:ring-stone-900 shadow-md"
                }`}
              >
                <svg
                  className="w-9 h-9 text-white"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  {isRecording ? (
                    <rect x="7" y="7" width="10" height="10" rx="2" />
                  ) : (
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  )}
                </svg>
              </button>
            </div>

            {isRecording ? (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium text-red-600">Recording</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {isProcessing ? "Processing..." : "Tap to record"}
              </span>
            )}
          </div>

          {/* Divider */}
          <Separator orientation="vertical" className="hidden md:block" />

          {/* Transcript side */}
          <div className="flex flex-col flex-1 p-6 gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Transcript</span>
              {wordCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {wordCount} words
                </Badge>
              )}
            </div>

            <Textarea
              value={displayText}
              onChange={(e) => {
                setTranscript(e.target.value);
                setInterimText("");
              }}
              placeholder="Your transcript will appear here as you speak. You can also paste notes or type directly."
              className="flex-1 min-h-[100px] resize-none text-sm border-stone-200 focus-visible:ring-1 focus-visible:ring-blue-500 bg-stone-50"
            />

            <div className="flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={isProcessing || !transcript.trim()}
                className="gap-2"
              >
                {isProcessing ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Extracting tasks...
                  </>
                ) : (
                  <>
                    Extract Tasks
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
