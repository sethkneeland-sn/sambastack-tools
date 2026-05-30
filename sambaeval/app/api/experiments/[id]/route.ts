import { NextResponse } from "next/server";
import {
  deleteExperiment,
  getExperiment,
  saveExperiment,
} from "@/app/lib/storage";
import type { Experiment } from "@/app/lib/types";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ experiment });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Experiment>;
  const experiment: Experiment = {
    id: id,
    name: body.name ?? `Experiment ${id}`,
    models: body.models ?? [],
    system_prompt: body.system_prompt ?? "",
    dataset: body.dataset ?? "",
    scorer: body.scorer ?? { type: "heuristic" },
    output_generator: body.output_generator ?? "",
  };
  await saveExperiment(experiment);
  return NextResponse.json({ experiment });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteExperiment(id);
  return NextResponse.json({ ok: true });
}
