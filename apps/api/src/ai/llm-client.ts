import type { Config } from "../plugins/env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface ChatResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
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
    };
  }

  throw new LlmClientError("Unrecognized LLM response shape", response.status, body);
}

function buildOllamaUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/chat`;
}

function buildOpenRouterUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

export async function chatCompletion(
  options: ChatOptions,
  config: Config,
): Promise<ChatResponse> {
  const provider = config.LLM_PROVIDER;

  if (provider === "ollama") {
    const response = await fetch(buildOllamaUrl(config.OLLAMA_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.OLLAMA_API_KEY
          ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
        },
        ...(options.jsonMode ? { format: "json" } : {}),
      }),
    });

    return parseResponse(response);
  }

  // OpenRouter / OpenAI-compatible path
  const response = await fetch(buildOpenRouterUrl(config.OPENROUTER_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.OPENROUTER_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  return parseResponse(response);
}
