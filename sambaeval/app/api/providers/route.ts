import { NextResponse } from "next/server";
import { listProviders, saveProviders } from "@/app/lib/storage";
import type { Provider } from "@/app/lib/types";

export async function GET() {
  const providers = await listProviders();
  return NextResponse.json({ providers });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { providers: Provider[] };
  await saveProviders(body.providers ?? []);
  return NextResponse.json({ providers: body.providers ?? [] });
}
