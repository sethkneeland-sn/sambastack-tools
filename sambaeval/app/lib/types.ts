export interface Provider {
  name: string;
  api_url: string;
  api_key: string;
}

export interface ModelConfig {
  name: string;
  temperature: number;
  seed?: number;
  system_prompt: string;
  provider_name: string;
  // Arbitrary extra request kwargs forwarded to the provider (top_p, top_k,
  // max_tokens, stop, etc.). Values are stored already-parsed (numbers,
  // booleans, arrays — not raw strings).
  additional_kwargs?: Record<string, unknown>;
}

export interface HeuristicScorer {
  type: "heuristic";
}

export interface LlmJudgeScorerRef {
  type: "llm";
  scorer_name: string;
}

export type Scorer = HeuristicScorer | LlmJudgeScorerRef;

export interface LlmJudgeScorerDef {
  name: string;
  provider_name: string;
  model: string;
  temperature: number;
  judge_prompt: string;
  max_score: number;
}

export interface Experiment {
  id: string;
  name: string;
  models: ModelConfig[];
  system_prompt: string;
  dataset: string;
  scorer?: Scorer;
  output_generator?: string;
  concurrency?: number;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  // Allow tool-use replay through dataset rows; the executor passes these
  // straight through to the OpenAI-compatible client.
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

export interface DatasetRow {
  example_id: number;
  messages: Message[];
  system_prompt?: string | null;
  expected_output: string;
  weight: number;
}

export interface ResultRow {
  result_id: number;
  status: "completed" | "error";
  provider: string;
  model: string;
  example_id: number;
  output: string;
  score: number;
  score_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  ttft_ms: number | null;
  tps: number | null;
  num_llm_calls: number | null;
}

export interface RunOptions {
  concurrency?: number;
}

export interface RunProgress {
  total: number;
  completed: number;
  current?: string;
}

export interface RunMeta {
  run_id: string;
  status: "running" | "completed" | "aborted";
  started_at: string;
  finished_at: string | null;
  resumed_at: string[];
  total: number;
  completed: number;
  errors: number;
}
