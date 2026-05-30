import { NextResponse } from "next/server";
import {
  deleteScorer,
  listScorers,
  saveScorer,
} from "@/app/lib/storage";
import type { LlmJudgeScorerDef } from "@/app/lib/types";

export async function GET() {
  const scorers = await listScorers();
  return NextResponse.json({ scorers });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { scorers: LlmJudgeScorerDef[] };
  const incoming = body.scorers ?? [];

  const seen = new Set<string>();
  for (const s of incoming) {
    if (!s.name) {
      return NextResponse.json(
        { error: "Every scorer needs a name." },
        { status: 400 },
      );
    }
    if (seen.has(s.name)) {
      return NextResponse.json(
        { error: `Duplicate scorer name "${s.name}".` },
        { status: 400 },
      );
    }
    seen.add(s.name);
  }

  // Delete files for scorers that were removed from the list, then upsert the rest.
  const existing = await listScorers();
  for (const prior of existing) {
    if (!seen.has(prior.name)) {
      await deleteScorer(prior.name);
    }
  }

  try {
    for (const s of incoming) {
      await saveScorer(s);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const scorers = await listScorers();
  return NextResponse.json({ scorers });
}
