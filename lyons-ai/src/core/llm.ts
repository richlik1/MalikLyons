import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { TaskFailure } from "./errors.js";

export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmTool = Anthropic.Beta.BetaTool;
export type LlmResponse = Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason" | "usage" | "model"> & {
  stop_details?: Anthropic.Beta.BetaMessage["stop_details"];
};

export interface LlmRequest {
  system: string;
  tools: LlmTool[];
  messages: LlmMessage[];
}

/** Narrow seam so the agent loop can be tested without network calls. */
export interface LlmClient {
  createMessage(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export class ClaudeClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(private readonly cfg: Config) {
    // maxRetries covers 429/5xx/connection errors with backoff.
    this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 5 * 60_000 });
  }

  async createMessage(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (!this.cfg.ANTHROPIC_API_KEY) throw new TaskFailure("Claude is not configured: ANTHROPIC_API_KEY is missing on the server.");
    try {
      return await this.send(req, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new TaskFailure("Claude rejected the API key (401). Check ANTHROPIC_API_KEY.");
      if (err instanceof Anthropic.PermissionDeniedError) throw new TaskFailure("Claude API permission denied (403) for this key/model.");
      if (err instanceof Anthropic.RateLimitError) throw new TaskFailure("Claude API rate limit hit after retries. Try again shortly.");
      if (err instanceof Anthropic.BadRequestError) throw new TaskFailure(`Claude API rejected the request: ${err.message}`);
      if (err instanceof Anthropic.APIConnectionError) throw new TaskFailure("Could not reach the Claude API (network error).");
      if (err instanceof Anthropic.APIError) throw new TaskFailure(`Claude API error ${err.status ?? ""}: ${err.message}`);
      throw err;
    }
  }

  private send(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const fallbacks =
      this.cfg.CLAUDE_FALLBACKS === "default"
        ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const }
        : {};
    return this.client.beta.messages.create(
      {
        model: this.cfg.CLAUDE_MODEL,
        max_tokens: this.cfg.CLAUDE_MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: this.cfg.CLAUDE_EFFORT },
        // The system prompt and tool list are stable per agent, so they cache well.
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        // Auto-cache the growing, append-only transcript so each tool-loop turn
        // re-reads earlier turns at cache price instead of full input price.
        cache_control: { type: "ephemeral" },
        tools: req.tools,
        messages: req.messages,
        ...fallbacks,
      },
      { signal },
    );
  }
}
