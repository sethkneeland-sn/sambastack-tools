import { NextResponse } from "next/server";
import {
  deleteDataset,
  listDatasets,
  readDataset,
  writeDataset,
} from "@/app/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (name) {
    try {
      const content = await readDataset(name);
      const contentType = name.toLowerCase().endsWith(".jsonl")
        ? "application/x-ndjson; charset=utf-8"
        : "text/csv; charset=utf-8";
      return new Response(content, {
        headers: { "Content-Type": contentType },
      });
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  const datasets = await listDatasets();
  return NextResponse.json({ datasets });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name: string; content: string };
  const lower = body.name?.toLowerCase() ?? "";
  if (!body.name || !(lower.endsWith(".csv") || lower.endsWith(".jsonl"))) {
    return NextResponse.json(
      { error: "Dataset name must end with .csv or .jsonl" },
      { status: 400 },
    );
  }
  await writeDataset(body.name, body.content ?? "");
  return NextResponse.json({ name: body.name });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  await deleteDataset(name);
  return NextResponse.json({ ok: true });
}
