import { NextResponse } from "next/server";
import {
  listExperiments,
  nextExperimentId,
  saveExperiment,
} from "@/app/lib/storage";
import type { Experiment } from "@/app/lib/types";

export async function GET() {
  const experiments = await listExperiments();
  return NextResponse.json({ experiments });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Experiment>;
  const id =
    typeof body.id === "string" && body.id.length > 0
      ? body.id
      : await nextExperimentId();
  const experiment: Experiment = {
    id,
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
