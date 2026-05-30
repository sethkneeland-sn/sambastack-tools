import { findResumableRun, getExperiment } from "@/app/lib/storage";
import { runExperiment, type RunMode } from "@/app/lib/executor";

interface Ctx {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

function parseMode(value: string | null): RunMode | "auto" {
  if (value === "new" || value === "resume") return value;
  return "auto";
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const concurrency = Math.max(
    1,
    Math.min(32, Number(url.searchParams.get("concurrency") ?? "4")),
  );
  const requestedMode = parseMode(url.searchParams.get("mode"));
  const requestedRunId = url.searchParams.get("run_id") ?? undefined;

  const experiment = await getExperiment(id);
  if (!experiment) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let mode: RunMode;
  let runId = requestedRunId;
  if (requestedMode === "auto") {
    const resumable = await findResumableRun(id);
    if (resumable) {
      return new Response(
        JSON.stringify({
          error: "resumable_run_exists",
          resumable,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    mode = "new";
  } else {
    mode = requestedMode;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const { runId: actualRunId, meta, results } = await runExperiment(
          experiment,
          {
            concurrency,
            onProgress: (p) => send("progress", p),
            signal: req.signal,
            mode,
            runId,
          },
        );
        runId = actualRunId;
        send("done", { runId: actualRunId, meta, results });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
