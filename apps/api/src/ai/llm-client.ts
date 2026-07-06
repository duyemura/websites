import type { Config } from "../plugins/env";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResponse {
  content: string;
  usage?: LlmUsage;
  latencyMs?: number;
  raw?: Record<string, unknown>;
}

export interface SanitizedLlmMetadata {
  providerResponseId?: string;
  responseModel?: string;
  finishReason?: string;
  usage?: LlmUsage;
  createdAt?: number;
}

export function sanitizeRawResponse(
  raw: Record<string, unknown> | undefined,
): SanitizedLlmMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const usage = raw.usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_eval_count?: number;
        eval_count?: number;
      }
    | undefined;

  const normalizedUsage: LlmUsage | undefined = usage
    ? {
        promptTokens:
          usage.prompt_tokens ?? usage.prompt_eval_count ?? undefined,
        completionTokens:
          usage.completion_tokens ?? usage.eval_count ?? undefined,
        totalTokens: usage.total_tokens,
      }
    : undefined;

  const firstChoice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const finishReason =
    (firstChoice?.finish_reason as string | undefined) ??
    (raw.done_reason as string | undefined);

  return {
    providerResponseId: raw.id as string | undefined,
    responseModel: raw.model as string | undefined,
    finishReason,
    usage: normalizedUsage,
    createdAt: raw.created as number | undefined,
  };
}

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: unknown,
  ) {
    super(message);
    this.name = "LlmClientError";
  }
}

async function parseResponse(response: Response): Promise<ChatResponse> {
  const body = (await response.json().catch(() => undefined)) as Record<
    string,
    unknown
  > | undefined;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body.error as { message?: string }).message ?? response.statusText)
        : response.statusText;
    throw new LlmClientError(message, response.status, body);
  }

  if (!body) {
    throw new LlmClientError("Empty response from LLM API", response.status, body);
  }

  // Ollama /api/chat shape
  const message = body.message as { content?: string } | undefined;
  if (message?.content) {
    return {
      content: message.content,
      usage: body.eval_count
        ? {
            promptTokens: body.prompt_eval_count as number | undefined,
            completionTokens: body.eval_count as number | undefined,
            totalTokens:
              ((body.prompt_eval_count as number | undefined) ?? 0) +
              ((body.eval_count as number | undefined) ?? 0),
          }
        : undefined,
      raw: body,
    };
  }

  // OpenAI-compatible /v1/chat/completions shape
  const choices = body.choices as Array<{
    message?: { content?: string };
  }> | undefined;
  const firstChoice = choices?.[0];
  if (firstChoice?.message?.content) {
    const usage = body.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    return {
      content: firstChoice.message.content,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
      raw: body,
    };
  }

  throw new LlmClientError("Unrecognized LLM response shape", response.status, body);
}

function buildOllamaUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/chat`;
}

function buildOpenRouterUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  // Base URL may already include /v1 (e.g. https://openrouter.ai/api/v1)
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

const LLM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per call

export async function chatCompletion(
  options: ChatOptions,
  config: Config,
): Promise<ChatResponse> {
  const start = performance.now();
  const provider = config.LLM_PROVIDER;

  let response: ChatResponse;

  if (provider === "ollama") {
    const fetchResponse = await fetch(buildOllamaUrl(config.OLLAMA_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.OLLAMA_API_KEY
          ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: await buildOllamaMessages(options.messages),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
        ...(options.jsonMode ? { format: "json" } : {}),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    response = await parseResponse(fetchResponse);
  } else {
    // OpenRouter / OpenAI-compatible path
    const fetchResponse = await fetch(buildOpenRouterUrl(config.OPENROUTER_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENROUTER_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: buildOpenRouterMessages(options.messages),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    response = await parseResponse(fetchResponse);
  }

  return {
    ...response,
    latencyMs: Math.round(performance.now() - start),
  };
}

async function buildOllamaMessages(
  messages: ChatMessage[],
): Promise<Array<{ role: string; content: string; images?: string[] }>> {
  return Promise.all(
    messages.map(async (msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      let content = "";
      const images: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          content += part.text;
        } else if (part.type === "image_url") {
          const base64 = await urlToBase64(part.image_url.url);
          if (base64) images.push(base64);
        }
      }
      return { role: msg.role, content, ...(images.length ? { images } : {}) };
    }),
  );
}

function buildOpenRouterMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: string | ChatContentPart[] }> {
  return messages.map((msg) => ({ role: msg.role, content: msg.content }));
}

async function urlToBase64(url: string): Promise<string | null> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    return comma === -1 ? null : url.slice(comma + 1);
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}
