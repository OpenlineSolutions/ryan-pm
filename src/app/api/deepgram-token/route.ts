import { NextResponse } from "next/server";

export async function GET() {
  // Return the Deepgram API key for client-side WebSocket auth
  // In production, you'd generate a short-lived token via Deepgram's API
  const token = process.env.DEEPGRAM_API_KEY;

  if (!token) {
    return NextResponse.json(
      { error: "Deepgram API key not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ token });
}
