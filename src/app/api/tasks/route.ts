import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();
  try {
    const tasks = await sql`
      SELECT t.*, row_to_json(p.*) as projects
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.created_at DESC
    `;
    return NextResponse.json(tasks);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, status, approved, title, description, priority, assignee } = body;
  if (!id) return NextResponse.json({ error: "Missing task id" }, { status: 400 });

  // project_id handled separately: explicit key in body = always write it (allows clearing to null)
  const hasProjectId = Object.prototype.hasOwnProperty.call(body, "project_id");
  const project_id: string | null = body.project_id || null;

  const sql = getDb();
  try {
    await sql`
      UPDATE tasks SET
        status = COALESCE(${status ?? null}, status),
        approved = COALESCE(${approved ?? null}, approved),
        title = COALESCE(${title ?? null}, title),
        description = COALESCE(${description ?? null}, description),
        priority = COALESCE(${priority ?? null}, priority),
        project_id = CASE WHEN ${hasProjectId} THEN ${project_id} ELSE project_id END,
        assignee = COALESCE(${assignee ?? null}, assignee)
      WHERE id = ${id}
    `;

    const [withProject] = await sql`
      SELECT t.*, row_to_json(p.*) as projects
      FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ${id}
    `;
    if (!withProject) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json(withProject);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing task id" }, { status: 400 });

  const sql = getDb();
  try {
    await sql`DELETE FROM tasks WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
