import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const sql = getDb();
    const logs = await sql`
      SELECT id, transcript, task_count, processed_at
      FROM voice_logs
      ORDER BY processed_at DESC
      LIMIT 20
    `;
    return Response.json(logs);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
