"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

interface UseDeepgramOptions {
  /** Milliseconds of silence before auto-submitting. Default 2500. */
  silenceDelay?: number;
  /** Called with the accumulated transcript after silence is detected. */
  onTranscript: (text: string) => void;
}

export function useDeepgram({ silenceDelay = 2500, onTranscript }: UseDeepgramOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  // Always use the latest callback — avoids stale closure without adding it to deps
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

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

  const startRecording = useCallback(async () => {
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
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

        const mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}) });
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
            const updated = transcriptRef.current
              ? transcriptRef.current + " " + text
              : text;
            transcriptRef.current = updated;
            setTranscript(updated);
            setInterimText("");

            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              const final = transcriptRef.current.trim();
              stopRecording();
              if (final) onTranscriptRef.current(final);
            }, silenceDelay);
          } else if (text) {
            setInterimText(text);
          }
        }
      };

      socket.onerror = () => {
        toast.error("Voice connection issue. Type instead.");
        stopRecording();
      };
    } catch {
      toast.error("Microphone access denied. Allow it in your browser and try again.");
    }
  }, [silenceDelay, stopRecording]);

  const resetTranscript = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
    setInterimText("");
  }, []);

  return {
    isRecording,
    transcript,
    interimText,
    startRecording,
    stopRecording,
    resetTranscript,
  };
}
