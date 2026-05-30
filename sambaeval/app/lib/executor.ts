import { parseCsv } from "./csv";
import {
  completeRun,
  createRun,
  findResumableRun,
  getScorer,
  listProviders,
  markRunResumed,
  readDataset,
  readRunMeta,
  readRunResults,
  saveRunResults,
  upsertRunResultRow,
} from "./storage";
import { experimentFilePath } from "./paths";
import {
  heuristicScore,
  llmJudgeScore,
  messagesToTranscript,
} from "./scoring";
import {
  resolveOutputGenerator,
  runOutputGenerator,
  type OutputGeneratorMetrics,
} from "./python";
import type {
  DatasetRow,
  Experiment,
  Message,
  MessageRole,
  ModelConfig,
  ResultRow,
  RunMeta,
} from "./types";

export interface ExecutorProgress {
  total: number;
  completed: number;
  errors: number;
  currentLabel?: string;
  runId: string;
}

export type RunMode = "new" | "resume";

export interface ExecutorOptions {
  concurrency?: number;
  onProgress?: (p: ExecutorProgress) => void;
  signal?: AbortSignal;
  mode: RunMode;
  runId?: string;
}

export interface RunResult {
  runId: string;
  meta: RunMeta;
  results: ResultRow[];
}

function isValidRole(role: unknown): role is MessageRole {
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}

function coerceMessages(value: unknown, exampleId: number): Message[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`JSONL row ${exampleId}: "messages" must be a non-empty array`);
  }
  return value.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(
        `JSONL row ${exampleId}: messages[${i}] must be an object`,
      );
    }
    const m = raw as Record<string, unknown>;
    if (!isValidRole(m.role)) {
      throw new Error(
        `JSONL row ${exampleId}: messages[${i}].role must be system|user|assistant|tool`,
      );
    }
    if (typeof m.content !== "string") {
      throw new Error(
        `JSONL row ${exampleId}: messages[${i}].content must be a string`,
      );
    }
    const msg: Message = { role: m.role, content: m.content };
    if (m.tool_calls !== undefined) msg.tool_calls = m.tool_calls;
    if (typeof m.tool_call_id === "string") msg.tool_call_id = m.tool_call_id;
    if (typeof m.name === "string") msg.name = m.name;
    return msg;
  });
}

function parseJsonlDataset(raw: string): DatasetRow[] {
  const out: DatasetRow[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `JSONL line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const exampleId = Number(row.example_id);
    if (!Number.isFinite(exampleId)) {
      throw new Error(`JSONL line ${i + 1}: "example_id" is required`);
    }
    const hasPrompt = typeof row.prompt === "string";
    const hasMessages = row.messages !== undefined;
    if (hasPrompt && hasMessages) {
      throw new Error(
        `JSONL row ${exampleId}: set either "prompt" or "messages", not both`,
      );
    }
    if (!hasPrompt && !hasMessages) {
      throw new Error(
        `JSONL row ${exampleId}: either "prompt" or "messages" is required`,
      );
    }
    const messages: Message[] = hasMessages
      ? coerceMessages(row.messages, exampleId)
      : [{ role: "user", content: row.prompt as string }];

    out.push({
      example_id: exampleId,
      messages,
      system_prompt:
        typeof row.system_prompt === "string" ? row.system_prompt : null,
      expected_output:
        typeof row.expected_output === "string" ? row.expected_output : "",
      weight:
        typeof row.weight === "number" && Number.isFinite(row.weight)
          ? row.weight
          : 1.0,
    });
  }
  return out;
}

function parseCsvDataset(raw: string): DatasetRow[] {
  const { rows } = parseCsv(raw);
  return rows.map((r) => ({
    example_id: Number(r.example_id),
    messages: [{ role: "user", content: r.prompt ?? "" }],
    system_prompt: null,
    expected_output: r.expected_output ?? "",
    weight: r.weight && r.weight !== "" ? Number(r.weight) : 1.0,
  }));
}

export async function loadDataset(name: string): Promise<DatasetRow[]> {
  const raw = await readDataset(name);
  if (name.toLowerCase().endsWith(".jsonl")) {
    return parseJsonlDataset(raw);
  }
  return parseCsvDataset(raw);
}

interface Task {
  resultId: number;
  modelIndex: number;
  model: ModelConfig;
  row: DatasetRow;
}

function rowKey(provider: string, model: string, exampleId: number): string {
  return `${provider}|${model}|${exampleId}`;
}

const activeRuns = new Map<string, AbortController>();

function activeKey(experimentId: string, runId: string): string {
  return `${experimentId}/${runId}`;
}

export function cancelRun(experimentId: string, runId: string): boolean {
  const ctl = activeRuns.get(activeKey(experimentId, runId));
  if (!ctl) return false;
  ctl.abort();
  return true;
}

export function isRunActive(experimentId: string, runId: string): boolean {
  return activeRuns.has(activeKey(experimentId, runId));
}

export async function runExperiment(
  experiment: Experiment,
  options: ExecutorOptions,
): Promise<RunResult> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const dataset = await loadDataset(experiment.dataset);

  const providers = await listProviders();
  const providerByName = new Map(providers.map((p) => [p.name, p]));

  const totalTasks = experiment.models.length * dataset.length;

  let runId: string;
  let priorRows: ResultRow[] = [];
  if (options.mode === "resume") {
    if (!options.runId) {
      const resumable = await findResumableRun(experiment.id);
      if (!resumable) {
        throw new Error("No resumable run found");
      }
      runId = resumable.run_id;
    } else {
      runId = options.runId;
    }
    const existing = await readRunResults(experiment.id, runId);
    if (existing === null) {
      throw new Error(`Run ${runId} has no results to resume from`);
    }
    priorRows = existing;
    await markRunResumed(experiment.id, runId, totalTasks);
  } else {
    const meta = await createRun(experiment, totalTasks);
    runId = meta.run_id;
  }

  const priorByKey = new Map<string, ResultRow>();
  for (const r of priorRows) {
    priorByKey.set(rowKey(r.provider, r.model, r.example_id), r);
  }

  const universe: ResultRow[] = [];
  const tasks: Task[] = [];
  for (let mi = 0; mi < experiment.models.length; mi++) {
    const model = experiment.models[mi];
    for (let ri = 0; ri < dataset.length; ri++) {
      const row = dataset[ri];
      const resultId = mi * dataset.length + ri + 1;
      const carried = priorByKey.get(
        rowKey(model.provider_name, model.name, row.example_id),
      );
      if (carried && carried.status === "completed") {
        universe.push({ ...carried, result_id: resultId });
      } else {
        tasks.push({ resultId, modelIndex: mi, model, row });
      }
    }
  }

  const scriptPath = resolveOutputGenerator(experiment.output_generator);
  const experimentPath = experimentFilePath(experiment.id);

  // Prune orphans and lay down the carried rows so a mid-run crash leaves a
  // consistent CSV.
  await saveRunResults(experiment.id, runId, universe);

  const finalRows = new Map<number, ResultRow>();
  for (const r of universe) finalRows.set(r.result_id, r);

  let completed = universe.length;
  let errors = 0;
  let cursor = 0;

  const controller = new AbortController();
  activeRuns.set(activeKey(experiment.id, runId), controller);
  const cleanupController = () => {
    activeRuns.delete(activeKey(experiment.id, runId));
  };

  // The external signal (e.g. client disconnect) and the cancel-button signal
  // both flow through the controller, so the executor only has to watch one.
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const report = (label?: string) => {
    options.onProgress?.({
      total: totalTasks,
      completed,
      errors,
      currentLabel: label,
      runId,
    });
  };

  report();

  const worker = async () => {
    while (true) {
      if (controller.signal.aborted) return;
      const idx = cursor++;
      if (idx >= tasks.length) return;
      const task = tasks[idx];
      const label = `${task.model.provider_name}/${task.model.name} #${task.row.example_id}`;
      report(label);

      let output = "";
      let score = 0;
      let scoreReason: string | null = null;
      let status: "completed" | "error" = "completed";
      let metrics: OutputGeneratorMetrics | null = null;

      try {
        const result = await runOutputGenerator({
          scriptPath,
          experimentPath,
          modelIndex: task.modelIndex,
          messages: task.row.messages,
          systemPromptOverride: task.row.system_prompt ?? null,
          signal: controller.signal,
        });
        output = result.output;
        metrics = result.metrics;
      } catch (err) {
        if (controller.signal.aborted) return;
        output = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
        score = 0;
        status = "error";
        errors++;
      }

      if (status === "completed") {
        try {
          const scorer = experiment.scorer ?? { type: "heuristic" };
          if (scorer.type === "llm") {
            if (!scorer.scorer_name) {
              throw new Error(
                `Experiment uses an LLM judge but "scorer.scorer_name" is missing`,
              );
            }
            const def = await getScorer(scorer.scorer_name);
            if (!def) {
              throw new Error(
                `Scorer "${scorer.scorer_name}" not found in data/scorers/`,
              );
            }
            const judgeProvider = providerByName.get(def.provider_name);
            if (!judgeProvider) {
              throw new Error(
                `Judge provider "${def.provider_name}" not found in providers.json`,
              );
            }
            const judged = await llmJudgeScore({
              scorer: def,
              provider: judgeProvider,
              prompt: messagesToTranscript(task.row.messages),
              expected: task.row.expected_output,
              output,
              weight: task.row.weight,
              signal: controller.signal,
            });
            score = judged.score;
            scoreReason = judged.score_reason;
          } else {
            score = heuristicScore(task.row.expected_output, output, task.row.weight);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          output = `${output}\n\n[JUDGE ERROR: ${err instanceof Error ? err.message : String(err)}]`;
          score = 0;
          status = "error";
          errors++;
        }
      }

      const row: ResultRow = {
        result_id: task.resultId,
        status,
        provider: task.model.provider_name,
        model: task.model.name,
        example_id: task.row.example_id,
        output,
        score,
        score_reason: scoreReason,
        input_tokens: metrics?.input_tokens ?? null,
        output_tokens: metrics?.output_tokens ?? null,
        latency_ms: metrics?.latency_ms ?? null,
        ttft_ms: metrics?.ttft_ms ?? null,
        tps: metrics?.tps ?? null,
        num_llm_calls: metrics?.num_llm_calls ?? null,
      };

      await upsertRunResultRow(experiment.id, runId, row);
      finalRows.set(row.result_id, row);
      completed++;
      report(label);
    }
  };

  try {
    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length || 1) },
      () => worker(),
    );
    await Promise.all(workers);
  } finally {
    if (options.signal) {
      options.signal.removeEventListener("abort", onExternalAbort);
    }
    cleanupController();
  }

  const aborted = controller.signal.aborted;
  await completeRun(experiment.id, runId, aborted ? "aborted" : "completed");

  const meta = await readRunMeta(experiment.id, runId);
  if (!meta) {
    throw new Error(`Run ${runId} disappeared mid-execution`);
  }

  return {
    runId,
    meta,
    results: Array.from(finalRows.values()).sort(
      (a, b) => a.result_id - b.result_id,
    ),
  };
}
