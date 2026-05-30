import type { ModelConfig, Provider } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
  error?: { message?: string };
}

function joinUrl(base: string, suffix: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}${suffix}`;
}

export async function callModel(args: {
  provider: Provider;
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
}): Promise<string> {
  const { provider, model, systemPrompt, userPrompt, responseFormat, signal } = args;
  const url = joinUrl(provider.api_url, "/chat/completions");
  const messages: ChatMessage[] = [];
  if (systemPrompt && systemPrompt.length > 0) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const body: Record<string, unknown> = {
    model: model.name,
    messages,
    temperature: model.temperature,
  };
  if (typeof model.seed === "number" && Number.isFinite(model.seed)) {
    body.seed = model.seed;
  }
  if (model.additional_kwargs) {
    for (const [k, v] of Object.entries(model.additional_kwargs)) {
      if (v !== undefined) body[k] = v;
    }
  }
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Provider ${provider.name} returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  if (data.error?.message) throw new Error(data.error.message);
  const content =
    data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "";
  return content;
}
