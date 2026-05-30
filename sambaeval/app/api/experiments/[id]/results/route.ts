import { NextResponse } from "next/server";
import {
  findLatestRun,
  readLatestResults,
  readRunResults,
  readRunResultsCsv,
} from "@/app/lib/storage";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const runId = url.searchParams.get("run_id");

  if (format === "csv") {
    const targetRunId = runId ?? (await findLatestRun(id))?.run_id;
    if (!targetRunId) {
      return NextResponse.json({ error: "No results" }, { status: 404 });
    }
    const csv = await readRunResultsCsv(id, targetRunId);
    if (csv === null) {
      return NextResponse.json({ error: "No results" }, { status: 404 });
    }
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}_${targetRunId}_results.csv"`,
      },
    });
  }

  if (runId) {
    const rows = await readRunResults(id, runId);
    if (rows === null) {
      return NextResponse.json({ results: null, runId });
    }
    return NextResponse.json({ results: rows, runId });
  }

  const latest = await readLatestResults(id);
  if (!latest) {
    return NextResponse.json({ results: null, runId: null });
  }
  return NextResponse.json({ results: latest.rows, runId: latest.runId });
}
