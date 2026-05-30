import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import type { Message } from "./types";

const ROOT = process.cwd();
const VENV_PYTHON = path.join(ROOT, ".venv", "bin", "python");

export const DEFAULT_OUTPUT_GENERATOR = path.join(
  ROOT,
  "scripts",
  "generators",
  "default_generator.py",
);

export function resolveOutputGenerator(scriptPath?: string): string {
  if (!scriptPath || scriptPath.trim() === "") return DEFAULT_OUTPUT_GENERATOR;
  return path.isAbsolute(scriptPath) ? scriptPath : path.join(ROOT, scriptPath);
}

export interface OutputGeneratorMetrics {
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  ttft_ms: number | null;
  tps: number | null;
  num_llm_calls: number | null;
}

export interface OutputGeneratorResult {
  output: string;
  metrics: OutputGeneratorMetrics | null;
}

export async function runOutputGenerator(args: {
  scriptPath: string;
  experimentPath: string;
  modelIndex: number;
  messages: Message[];
  systemPromptOverride?: string | null;
  signal?: AbortSignal;
}): Promise<OutputGeneratorResult> {
  if (!existsSync(VENV_PYTHON)) {
    throw new Error(
      `Python venv not found at .venv/. Run \`npm run setup-venv\` (or restart \`npm run dev\`) to create it.`,
    );
  }
  if (!existsSync(args.scriptPath)) {
    throw new Error(`Output generator script not found: ${args.scriptPath}`);
  }

  const stdinPayload = JSON.stringify({
    messages: args.messages,
    system_prompt: args.systemPromptOverride ?? null,
  });

  const raw = await new Promise<string>((resolve, reject) => {
    const proc = spawn(
      VENV_PYTHON,
      [args.scriptPath, args.experimentPath, String(args.modelIndex)],
      { cwd: ROOT },
    );

    const stdoutChunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      const trimmed = stderr.trim();
      reject(
        new Error(
          trimmed.length > 0
            ? trimmed
            : `Python exited with code ${code ?? "null"}`,
        ),
      );
    });

    if (args.signal) {
      const onAbort = () => proc.kill();
      if (args.signal.aborted) onAbort();
      else args.signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.output === "string"
    ) {
      const metrics = normalizeMetrics(parsed.metrics);
      return { output: parsed.output, metrics };
    }
  } catch {
    // Fall through to legacy plaintext handling.
  }
  return { output: raw, metrics: null };
}

function normalizeMetrics(value: unknown): OutputGeneratorMetrics | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  return {
    input_tokens: num(v.input_tokens),
    output_tokens: num(v.output_tokens),
    latency_ms: num(v.latency_ms),
    ttft_ms: num(v.ttft_ms),
    tps: num(v.tps),
    num_llm_calls: num(v.num_llm_calls),
  };
}
