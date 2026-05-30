import { NextResponse } from "next/server";
import { listRuns } from "@/app/lib/storage";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const runs = await listRuns(id);
  return NextResponse.json({ runs });
}
