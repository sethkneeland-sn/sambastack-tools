import fs from "fs/promises";
import path from "path";
import {
  DATASETS_DIR,
  EXPERIMENTS_DIR,
  PROVIDERS_FILE,
  RESULTS_DIR,
  SCORERS_DIR,
  datasetFilePath,
  experimentFilePath,
  experimentRunsDir,
  legacyResultsFilePath,
  runDir,
  runExperimentSnapshotPath,
  runMetaPath,
  runResultsPath,
  scorerFilePath,
} from "./paths";
import type {
  Experiment,
  LlmJudgeScorerDef,
  Provider,
  ResultRow,
  RunMeta,
} from "./types";
import { parseCsv, stringifyCsv } from "./csv";

async function ensureDirs() {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
  await fs.mkdir(DATASETS_DIR, { recursive: true });
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.mkdir(SCORERS_DIR, { recursive: true });
}

function migrateLegacyExperiment(raw: unknown): Experiment | null {
  if (!raw || typeof raw !== "object") return null;
  // Legacy experiments embedded `providers: Provider[]` with api_keys, and used
  // `provider` (not `provider_name`) on models. Migrate on load.
  const r = raw as Record<string, unknown>;
  delete r.providers;

  if (Array.isArray(r.models)) {
    r.models = (r.models as Record<string, unknown>[]).map((m) => {
      if (m.provider_name === undefined && typeof m.provider === "string") {
        const { provider, ...rest } = m;
        return { ...rest, provider_name: provider };
      }
      return m;
    });
  }

  return r as unknown as Experiment;
}

export async function listExperiments(): Promise<Experiment[]> {
  await ensureDirs();
  const entries = await fs.readdir(EXPERIMENTS_DIR);
  const experiments: Experiment[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(EXPERIMENTS_DIR, entry), "utf8");
      const exp = migrateLegacyExperiment(JSON.parse(raw));
      if (exp) {
        // Ensure id matches filename so it round-trips correctly.
        const slug = entry.replace(/\.json$/, "");
        if (exp.id !== slug) exp.id = slug;
        experiments.push(exp);
      }
    } catch {
      // skip malformed files
    }
  }
  experiments.sort((a, b) => a.id.localeCompare(b.id));
  return experiments;
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(experimentFilePath(id), "utf8");
    return migrateLegacyExperiment(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveExperiment(exp: Experiment): Promise<void> {
  await ensureDirs();
  await fs.writeFile(experimentFilePath(exp.id), JSON.stringify(exp, null, 2));
}

export async function deleteExperiment(id: string): Promise<void> {
  await ensureDirs();
  await fs.rm(experimentFilePath(id), { force: true });
  await fs.rm(legacyResultsFilePath(id), { force: true });
  await fs.rm(experimentRunsDir(id), { recursive: true, force: true });
}

export async function nextExperimentId(): Promise<string> {
  const existing = new Set((await listExperiments()).map((e) => e.id));
  let i = 1;
  while (existing.has(String(i))) i++;
  return String(i);
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    name: "SambaNova",
    api_url: "https://api.sambanova.ai/v1",
    api_key: "Obtain from https://cloud.sambanova.ai/apis",
  },
];

export async function listProviders(): Promise<Provider[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(PROVIDERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(
        PROVIDERS_FILE,
        JSON.stringify(DEFAULT_PROVIDERS, null, 2),
      );
      return DEFAULT_PROVIDERS;
    }
    return [];
  }
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  await ensureDirs();
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify(providers, null, 2));
}

const SCORER_NAME_RE = /^[A-Za-z0-9._-]+$/;

function validateScorerName(name: string): void {
  if (!name || !SCORER_NAME_RE.test(name)) {
    throw new Error(
      `Invalid scorer name "${name}". Use letters, digits, dot, underscore, or dash.`,
    );
  }
}

export async function listScorers(): Promise<LlmJudgeScorerDef[]> {
  await ensureDirs();
  const entries = await fs.readdir(SCORERS_DIR);
  const scorers: LlmJudgeScorerDef[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(SCORERS_DIR, entry), "utf8");
      const parsed = JSON.parse(raw) as Partial<LlmJudgeScorerDef>;
      const slug = entry.replace(/\.json$/, "");
      scorers.push({
        name: typeof parsed.name === "string" && parsed.name ? parsed.name : slug,
        provider_name: parsed.provider_name ?? "",
        model: parsed.model ?? "",
        temperature:
          typeof parsed.temperature === "number" ? parsed.temperature : 0,
        judge_prompt: parsed.judge_prompt ?? "",
        max_score:
          typeof parsed.max_score === "number" &&
          Number.isFinite(parsed.max_score) &&
          parsed.max_score > 0
            ? parsed.max_score
            : 5,
      });
    } catch {
      // skip malformed files
    }
  }
  scorers.sort((a, b) => a.name.localeCompare(b.name));
  return scorers;
}

export async function getScorer(
  name: string,
): Promise<LlmJudgeScorerDef | null> {
  await ensureDirs();
  validateScorerName(name);
  try {
    const raw = await fs.readFile(scorerFilePath(name), "utf8");
    const parsed = JSON.parse(raw) as Partial<LlmJudgeScorerDef>;
    return {
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : name,
      provider_name: parsed.provider_name ?? "",
      model: parsed.model ?? "",
      temperature:
        typeof parsed.temperature === "number" ? parsed.temperature : 0,
      judge_prompt: parsed.judge_prompt ?? "",
      max_score:
        typeof parsed.max_score === "number" &&
        Number.isFinite(parsed.max_score) &&
        parsed.max_score > 0
          ? parsed.max_score
          : 5,
    };
  } catch {
    return null;
  }
}

export async function saveScorer(scorer: LlmJudgeScorerDef): Promise<void> {
  await ensureDirs();
  validateScorerName(scorer.name);
  await fs.writeFile(
    scorerFilePath(scorer.name),
    JSON.stringify(scorer, null, 2),
  );
}

export async function deleteScorer(name: string): Promise<void> {
  await ensureDirs();
  validateScorerName(name);
  await fs.rm(scorerFilePath(name), { force: true });
}

export async function listDatasets(): Promise<string[]> {
  await ensureDirs();
  const entries = await fs.readdir(DATASETS_DIR);
  return entries.filter((e) => {
    const lower = e.toLowerCase();
    return lower.endsWith(".csv") || lower.endsWith(".jsonl");
  });
}

export async function readDataset(name: string): Promise<string> {
  return fs.readFile(datasetFilePath(name), "utf8");
}

export async function writeDataset(name: string, content: string): Promise<void> {
  await ensureDirs();
  await fs.writeFile(datasetFilePath(name), content);
}

export async function deleteDataset(name: string): Promise<void> {
  await ensureDirs();
  await fs.rm(datasetFilePath(name), { force: true });
}

const RESULT_HEADERS = [
  "result_id",
  "status",
  "provider",
  "model",
  "example_id",
  "output",
  "score",
  "score_reason",
  "input_tokens",
  "output_tokens",
  "latency_ms",
  "ttft_ms",
  "tps",
  "num_llm_calls",
];

const numOrEmpty = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "" : String(v);

const parseNumOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function atomicWriteFile(target: string, data: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

function serializeRows(rows: ResultRow[]): string {
  return stringifyCsv(
    RESULT_HEADERS,
    rows.map((r) => [
      String(r.result_id),
      r.status,
      r.provider,
      r.model,
      String(r.example_id),
      r.output,
      String(r.score),
      r.score_reason ?? "",
      numOrEmpty(r.input_tokens),
      numOrEmpty(r.output_tokens),
      numOrEmpty(r.latency_ms),
      numOrEmpty(r.ttft_ms),
      numOrEmpty(r.tps),
      numOrEmpty(r.num_llm_calls),
    ]),
  );
}

function parseRows(raw: string): ResultRow[] {
  const { rows } = parseCsv(raw);
  return rows.map((row) => {
    const output = row.output ?? "";
    const rawStatus = row.status;
    const status: "completed" | "error" =
      rawStatus === "error" || rawStatus === "completed"
        ? rawStatus
        : output.startsWith("ERROR:") || output.includes("[JUDGE ERROR:")
          ? "error"
          : "completed";
    return {
      result_id: Number(row.result_id),
      status,
      provider: row.provider ?? "",
      model: row.model ?? "",
      example_id: Number(row.example_id),
      output,
      score: Number(row.score),
      score_reason: row.score_reason && row.score_reason !== "" ? row.score_reason : null,
      input_tokens: parseNumOrNull(row.input_tokens),
      output_tokens: parseNumOrNull(row.output_tokens),
      latency_ms: parseNumOrNull(row.latency_ms),
      ttft_ms: parseNumOrNull(row.ttft_ms),
      tps: parseNumOrNull(row.tps),
      num_llm_calls: parseNumOrNull(row.num_llm_calls),
    };
  });
}

const resultsLocks = new Map<string, Promise<unknown>>();

function withRunLock<T>(
  experimentId: string,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${experimentId}/${runId}`;
  const prev = resultsLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn());
  resultsLocks.set(key, next);
  return next;
}

async function readRunMetaUnlocked(
  experimentId: string,
  runId: string,
): Promise<RunMeta | null> {
  try {
    const raw = await fs.readFile(runMetaPath(experimentId, runId), "utf8");
    const parsed = JSON.parse(raw) as RunMeta;
    return parsed;
  } catch {
    return null;
  }
}

async function writeRunMetaUnlocked(
  experimentId: string,
  meta: RunMeta,
): Promise<void> {
  await atomicWriteFile(
    runMetaPath(experimentId, meta.run_id),
    JSON.stringify(meta, null, 2),
  );
}

async function readResultsRowsUnlocked(
  experimentId: string,
  runId: string,
): Promise<ResultRow[]> {
  try {
    const raw = await fs.readFile(runResultsPath(experimentId, runId), "utf8");
    return parseRows(raw);
  } catch {
    return [];
  }
}

function rowKey(provider: string, model: string, exampleId: number): string {
  return `${provider}|${model}|${exampleId}`;
}

function recountMeta(meta: RunMeta, rows: ResultRow[]): RunMeta {
  let completed = 0;
  let errors = 0;
  for (const r of rows) {
    completed++;
    if (r.status === "error") errors++;
  }
  return { ...meta, completed, errors };
}

function isoRunId(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString().replace(/[:.]/g, "-");
}

async function migrateLegacyResultsIfPresent(experimentId: string): Promise<void> {
  const legacyPath = legacyResultsFilePath(experimentId);
  let stat;
  try {
    stat = await fs.stat(legacyPath);
  } catch {
    return; // no legacy file
  }
  if (!stat.isFile()) return;

  // If there's already a runs directory, treat the legacy CSV as an unrelated
  // stale artifact and leave it alone — we don't want to overwrite history.
  try {
    const existing = await fs.readdir(experimentRunsDir(experimentId));
    if (existing.length > 0) return;
  } catch {
    // dir doesn't exist; safe to create
  }

  const runId = isoRunId(stat.mtimeMs);
  const dir = runDir(experimentId, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.rename(legacyPath, runResultsPath(experimentId, runId));

  const rows = await readResultsRowsUnlocked(experimentId, runId);
  const iso = new Date(stat.mtimeMs).toISOString();
  const meta: RunMeta = {
    run_id: runId,
    status: "completed",
    started_at: iso,
    finished_at: iso,
    resumed_at: [],
    total: rows.length,
    completed: rows.length,
    errors: rows.filter((r) => r.status === "error").length,
  };
  await writeRunMetaUnlocked(experimentId, meta);
}

export async function listRuns(experimentId: string): Promise<RunMeta[]> {
  await ensureDirs();
  await migrateLegacyResultsIfPresent(experimentId);
  const dir = experimentRunsDir(experimentId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const runs: RunMeta[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const meta = await readRunMetaUnlocked(experimentId, entry);
    if (meta) runs.push(meta);
  }
  // Newest first; sort by started_at.
  runs.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return runs;
}

export async function readRunMeta(
  experimentId: string,
  runId: string,
): Promise<RunMeta | null> {
  return withRunLock(experimentId, runId, () =>
    readRunMetaUnlocked(experimentId, runId),
  );
}

export async function findResumableRun(
  experimentId: string,
): Promise<RunMeta | null> {
  const runs = await listRuns(experimentId);
  if (runs.length === 0) return null;
  // Only resume the latest run, and only if it didn't complete. An older
  // "running" entry sitting behind a newer completed run is an orphan from a
  // server crash, not a resumable state.
  const latest = runs[0];
  return latest.status !== "completed" ? latest : null;
}

export async function findLatestRun(
  experimentId: string,
): Promise<RunMeta | null> {
  const runs = await listRuns(experimentId);
  return runs[0] ?? null;
}

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function createRun(
  experiment: Experiment,
  totalTasks: number,
): Promise<RunMeta> {
  await ensureDirs();
  const runId = newRunId();
  const dir = runDir(experiment.id, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    runExperimentSnapshotPath(experiment.id, runId),
    JSON.stringify(experiment, null, 2),
  );
  const meta: RunMeta = {
    run_id: runId,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    resumed_at: [],
    total: totalTasks,
    completed: 0,
    errors: 0,
  };
  await writeRunMetaUnlocked(experiment.id, meta);
  // Write an empty results CSV so downstream readers find a well-formed file.
  await atomicWriteFile(runResultsPath(experiment.id, runId), serializeRows([]));
  return meta;
}

export async function markRunResumed(
  experimentId: string,
  runId: string,
  totalTasks: number,
): Promise<RunMeta | null> {
  return withRunLock(experimentId, runId, async () => {
    const meta = await readRunMetaUnlocked(experimentId, runId);
    if (!meta) return null;
    const updated: RunMeta = {
      ...meta,
      status: "running",
      resumed_at: [...meta.resumed_at, new Date().toISOString()],
      total: totalTasks,
    };
    await writeRunMetaUnlocked(experimentId, updated);
    return updated;
  });
}

export async function completeRun(
  experimentId: string,
  runId: string,
  status: "completed" | "aborted",
): Promise<void> {
  await withRunLock(experimentId, runId, async () => {
    const meta = await readRunMetaUnlocked(experimentId, runId);
    if (!meta) return;
    const updated: RunMeta = {
      ...meta,
      status,
      finished_at: new Date().toISOString(),
    };
    await writeRunMetaUnlocked(experimentId, updated);
  });
}

export async function saveRunResults(
  experimentId: string,
  runId: string,
  rows: ResultRow[],
): Promise<void> {
  await withRunLock(experimentId, runId, async () => {
    await fs.mkdir(runDir(experimentId, runId), { recursive: true });
    await atomicWriteFile(runResultsPath(experimentId, runId), serializeRows(rows));
    const meta = await readRunMetaUnlocked(experimentId, runId);
    if (meta) {
      await writeRunMetaUnlocked(experimentId, recountMeta(meta, rows));
    }
  });
}

export async function upsertRunResultRow(
  experimentId: string,
  runId: string,
  row: ResultRow,
): Promise<void> {
  await withRunLock(experimentId, runId, async () => {
    await fs.mkdir(runDir(experimentId, runId), { recursive: true });
    const existing = await readResultsRowsUnlocked(experimentId, runId);
    const key = rowKey(row.provider, row.model, row.example_id);
    const next = existing.filter(
      (r) => rowKey(r.provider, r.model, r.example_id) !== key,
    );
    next.push(row);
    next.sort((a, b) => a.result_id - b.result_id);
    await atomicWriteFile(runResultsPath(experimentId, runId), serializeRows(next));
    const meta = await readRunMetaUnlocked(experimentId, runId);
    if (meta) {
      await writeRunMetaUnlocked(experimentId, recountMeta(meta, next));
    }
  });
}

export async function readRunResults(
  experimentId: string,
  runId: string,
): Promise<ResultRow[] | null> {
  return withRunLock(experimentId, runId, async () => {
    try {
      await fs.access(runResultsPath(experimentId, runId));
    } catch {
      return null;
    }
    return readResultsRowsUnlocked(experimentId, runId);
  });
}

export async function readRunResultsCsv(
  experimentId: string,
  runId: string,
): Promise<string | null> {
  try {
    return await fs.readFile(runResultsPath(experimentId, runId), "utf8");
  } catch {
    return null;
  }
}

export async function readLatestResults(
  experimentId: string,
): Promise<{ runId: string; rows: ResultRow[] } | null> {
  const latest = await findLatestRun(experimentId);
  if (!latest) return null;
  const rows = await readRunResults(experimentId, latest.run_id);
  if (rows === null) return null;
  return { runId: latest.run_id, rows };
}
