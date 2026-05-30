import { NextResponse } from "next/server";
import { cancelRun } from "@/app/lib/executor";
import { findResumableRun } from "@/app/lib/storage";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  let runId = url.searchParams.get("run_id");
  if (!runId) {
    const active = await findResumableRun(id);
    if (!active) {
      return NextResponse.json(
        { error: "no_active_run" },
        { status: 404 },
      );
    }
    runId = active.run_id;
  }

  const cancelled = cancelRun(id, runId);
  return NextResponse.json({ cancelled, runId });
}
