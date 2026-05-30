import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const EXPERIMENTS_DIR = path.join(DATA_DIR, "experiments");
export const DATASETS_DIR = path.join(DATA_DIR, "datasets");
export const RESULTS_DIR = path.join(DATA_DIR, "results");
export const SCORERS_DIR = path.join(DATA_DIR, "scorers");
export const PROVIDERS_FILE = path.join(DATA_DIR, "providers.json");

export function scorerFilePath(name: string): string {
  const safe = path.basename(name);
  return path.join(SCORERS_DIR, `${safe}.json`);
}

export function experimentFilePath(id: string): string {
  return path.join(EXPERIMENTS_DIR, `${id}.json`);
}

export function legacyResultsFilePath(id: string): string {
  return path.join(RESULTS_DIR, `${id}_results.csv`);
}

export function experimentRunsDir(id: string): string {
  return path.join(RESULTS_DIR, id);
}

export function runDir(experimentId: string, runId: string): string {
  return path.join(experimentRunsDir(experimentId), runId);
}

export function runResultsPath(experimentId: string, runId: string): string {
  return path.join(runDir(experimentId, runId), "results.csv");
}

export function runMetaPath(experimentId: string, runId: string): string {
  return path.join(runDir(experimentId, runId), "run.json");
}

export function runExperimentSnapshotPath(
  experimentId: string,
  runId: string,
): string {
  return path.join(runDir(experimentId, runId), "experiment.json");
}

export function datasetFilePath(name: string): string {
  const safe = path.basename(name);
  return path.join(DATASETS_DIR, safe);
}
