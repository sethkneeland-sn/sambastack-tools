import { callModel } from "./openai-client";
import type { LlmJudgeScorerDef, Message, Provider } from "./types";

export function messagesToTranscript(messages: Message[]): string {
  if (messages.length === 1 && messages[0].role === "user") {
    return messages[0].content;
  }
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

export const DEFAULT_JUDGE_PROMPT = `You are an impartial evaluator. Given a user prompt, an expected reference answer, and a model-generated response, decide how well the model response answers the prompt and matches the expected reference.

User prompt:
{prompt}

Expected reference:
{expected_output}

Model response:
{output}

Give an INTEGER score from 0 to {max_score}, where:
- {max_score} = fully correct and aligned with the expected reference, OR functionally / semantically equivalent (trivial whitespace, formatting, or notation differences should not be penalized)
- 0 = completely wrong, unrelated, or refuses to answer
- values in between = graded partial credit

Respond with a single JSON object and NOTHING ELSE, of the form:
{"score": <integer 0..{max_score}>, "score_reason": "<one or two sentences explaining the score>"}`;

export function heuristicScore(
  expected: string,
  output: string,
  weight: number,
): number {
  const w = Number.isFinite(weight) ? weight : 1.0;
  const trimmed = expected.trim();
  const out = output.trim();
  if (trimmed.toLowerCase().startsWith("contains:")) {
    const needle = trimmed.slice("contains:".length).trim();
    return out.includes(needle) ? w : 0;
  }
  return out === trimmed ? w : 0;
}

export function scoreAnswer(
  expected: string,
  output: string,
  weight: number,
): number {
  return heuristicScore(expected, output, weight);
}

export interface JudgeResult {
  score: number;
  score_reason: string | null;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  // Find the matching closing brace, accounting for nested braces and strings.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}

function parseJudgeResponse(text: string, maxScore: number): JudgeResult {
  const clamp = (n: number) => Math.max(0, Math.min(maxScore, n)) / maxScore;

  const candidate = extractJsonObject(text);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as {
        score?: unknown;
        score_reason?: unknown;
      };
      const rawScore = Number(parsed.score);
      const score = Number.isFinite(rawScore) ? clamp(rawScore) : 0;
      const reason =
        typeof parsed.score_reason === "string" && parsed.score_reason.length > 0
          ? parsed.score_reason
          : null;
      return { score, score_reason: reason };
    } catch {
      // Fall through to fallback parsing.
    }
  }
  // Fallback: pull any number out of the text and surface the raw response as reason.
  const match = text.match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : 0;
  const score = Number.isFinite(n) ? clamp(n) : 0;
  return {
    score,
    score_reason: `[unparseable judge response] ${text.trim().slice(0, 500)}`,
  };
}

export function renderJudgePrompt(
  template: string,
  vars: {
    prompt: string;
    output: string;
    expected_output: string;
    max_score: number;
  },
): string {
  return template
    .replaceAll("{prompt}", vars.prompt)
    .replaceAll("{output}", vars.output)
    .replaceAll("{expected_output}", vars.expected_output)
    .replaceAll("{max_score}", String(vars.max_score));
}

export async function llmJudgeScore(args: {
  scorer: LlmJudgeScorerDef;
  provider: Provider;
  prompt: string;
  expected: string;
  output: string;
  weight: number;
  signal?: AbortSignal;
}): Promise<JudgeResult> {
  const { scorer, provider, prompt, expected, output, weight, signal } = args;
  const w = Number.isFinite(weight) ? weight : 1.0;
  const maxScore =
    Number.isFinite(scorer.max_score) && scorer.max_score > 0
      ? scorer.max_score
      : 5;
  const rendered = renderJudgePrompt(scorer.judge_prompt, {
    prompt,
    output,
    expected_output: expected,
    max_score: maxScore,
  });

  const judgeOutput = await callModel({
    provider,
    model: {
      name: scorer.model,
      temperature: scorer.temperature,
      system_prompt: "",
      provider_name: provider.name,
    },
    systemPrompt: "",
    userPrompt: rendered,
    responseFormat: { type: "json_object" },
    signal,
  });

  const { score, score_reason } = parseJudgeResponse(judgeOutput, maxScore);
  return { score: score * w, score_reason };
}
