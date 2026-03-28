import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();
  try {
    const projects = await sql`SELECT * FROM projects ORDER BY name`;
    return NextResponse.json(projects);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
