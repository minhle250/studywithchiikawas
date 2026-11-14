import OpenAI from 'openai';

export const GITHUB_MODELS_BASE_URL = 'https://models.inference.ai.azure.com';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type RouterProvider = 'github' | 'groq' | 'openrouter';
export type ModelTier = 'fast' | 'deep';

export interface RouterTarget {
  provider: RouterProvider;
  model: string;
  supportsJsonMode: boolean;
}

export interface ChatCompletionLike {
  choices: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
}

export interface ChatClientLike {
  chat: {
    completions: {
      create: (params: {
        model: string;
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        temperature?: number;
        max_tokens?: number;
        response_format?: { type: 'json_object' };
      }) => Promise<ChatCompletionLike>;
    };
  };
}

export interface ModelRouterOptions {
  githubToken?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
  clientFactory?: (provider: RouterProvider, apiKey: string, baseURL: string) => ChatClientLike;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

function isValidEnvSecret(val: string | undefined, placeholder: string): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.trim() !== placeholder;
}

export function isRateLimitOrQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  };
  if (errObj.status === 429 || errObj.statusCode === 429) return true;
  if (errObj.code === 'rate_limit_exceeded' || errObj.code === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  const msg = (errObj.message ?? '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource_exhausted')
  );
}

function readHeaderValue(headers: unknown, key: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const maybeHeaders = headers as {
    get?: (name: string) => string | null;
    [k: string]: unknown;
  };
  if (typeof maybeHeaders.get === 'function') {
    return maybeHeaders.get(key) ?? maybeHeaders.get(key.toLowerCase());
  }
  for (const [k, v] of Object.entries(maybeHeaders)) {
    if (k.toLowerCase() === key.toLowerCase() && typeof v === 'string') {
      return v;
    }
  }
  return null;
}

export function parseRetryAfterMs(error: unknown, nowMs: number = Date.now()): number {
  if (error && typeof error === 'object') {
    const errObj = error as {
      headers?: unknown;
      response?: { headers?: unknown };
      message?: string;
    };

    const rawHeader =
      readHeaderValue(errObj.headers, 'retry-after') ??
      readHeaderValue(errObj.response?.headers, 'retry-after');

    if (rawHeader) {
      const trimmed = rawHeader.trim();
      const asSeconds = Number(trimmed);
      if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return Math.min(MAX_COOLDOWN_MS, Math.max(1000, Math.ceil(asSeconds * 1000)));
      }
      const asDate = Date.parse(trimmed);
      if (Number.isFinite(asDate) && asDate > nowMs) {
        return Math.min(MAX_COOLDOWN_MS, Math.max(1000, asDate - nowMs));
      }
    }

    const msg = typeof errObj.message === 'string' ? errObj.message : '';
    const secMatch =
      /(?:retry|try again)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)/i.exec(msg) ||
      /retryDelay["':\s]+(\d+)s/i.exec(msg);
    if (secMatch) {
      const parsed = Number(secMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(MAX_COOLDOWN_MS, Math.ceil(parsed * 1000));
      }
    }

    const minMatch = /(?:retry|try again)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:m|min|minutes?)/i.exec(msg);
    if (minMatch) {
      const parsed = Number(minMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(MAX_COOLDOWN_MS, Math.ceil(parsed * 60_000));
      }
    }
  }

  return DEFAULT_COOLDOWN_MS;
}

export class ModelCooldownTracker {
  private readonly cooldownUntil = new Map<string, number>();

  private keyFor(target: Pick<RouterTarget, 'provider' | 'model'>): string {
    return `${target.provider}:${target.model}`;
  }

  public isCoolingDown(target: Pick<RouterTarget, 'provider' | 'model'>, nowMs = Date.now()): boolean {
    const until = this.cooldownUntil.get(this.keyFor(target));
    if (!until) return false;
    if (nowMs >= until) {
      this.cooldownUntil.delete(this.keyFor(target));
      return false;
    }
    return true;
  }

  public markRateLimited(
    target: Pick<RouterTarget, 'provider' | 'model'>,
    error: unknown,
    nowMs = Date.now()
  ): number {
    const waitMs = parseRetryAfterMs(error, nowMs);
    this.cooldownUntil.set(this.keyFor(target), nowMs + waitMs);
    return waitMs;
  }

  public getAvailableTargets(targets: RouterTarget[], nowMs = Date.now()): RouterTarget[] {
    return targets.filter((t) => !this.isCoolingDown(t, nowMs));
  }
}

/**
 * Safely extracts and parses JSON from model completions, handling:
 * - DeepSeek-R1 `<think>...</think>` reasoning blocks
 * - Markdown ```json ... ``` or ``` ... ``` fences
 * - Leading/trailing explanatory prose outside the outermost `{...}` or `[...]`
 */
export function extractJsonObject<T = unknown>(raw: string): T {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Locate outermost balanced JSON object or array
  }

  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  let openChar = '{';
  let closeChar = '}';

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    openChar = '{';
    closeChar = '}';
  } else if (arrStart !== -1) {
    start = arrStart;
    openChar = '[';
    closeChar = ']';
  }

  if (start === -1) {
    throw new Error('No JSON object or array found in model response.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        return JSON.parse(candidate) as T;
      }
    }
  }

  throw new Error('Incomplete JSON block in model response.');
}

export function buildFriendlyRateLimitMessage(): string {
  return 'Free-tier model rate limits are temporarily cooling down. KusaQuiz switched cleanly to its built-in multilingual document analyzer so you can keep studying without interruption.';
}

export class ModelRouter {
  private readonly cooldowns = new ModelCooldownTracker();
  private readonly clients = new Map<RouterProvider, ChatClientLike>();

  constructor(options: ModelRouterOptions = {}) {
    const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;
    const groqKey = options.groqApiKey ?? process.env.GROQ_API_KEY;
    const openrouterKey = options.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;

    const factory =
      options.clientFactory ??
      ((_provider: RouterProvider, apiKey: string, baseURL: string): ChatClientLike =>
        new OpenAI({ apiKey, baseURL }));

    if (isValidEnvSecret(githubToken, 'MY_GITHUB_MODELS_TOKEN')) {
      this.clients.set('github', factory('github', githubToken.trim(), GITHUB_MODELS_BASE_URL));
    }
    if (isValidEnvSecret(groqKey, 'MY_GROQ_API_KEY')) {
      this.clients.set('groq', factory('groq', groqKey.trim(), GROQ_BASE_URL));
    }
    if (isValidEnvSecret(openrouterKey, 'MY_OPENROUTER_API_KEY')) {
      this.clients.set(
        'openrouter',
        factory('openrouter', openrouterKey.trim(), OPENROUTER_BASE_URL)
      );
    }
  }

  public hasConfiguredProvider(): boolean {
    return this.clients.size > 0;
  }

  public getStatusSummary() {
    return {
      hasGithubToken: this.clients.has('github'),
      hasGroqKey: this.clients.has('groq'),
      hasOpenRouterKey: this.clients.has('openrouter'),
      hasAnyProvider: this.clients.size > 0,
    };
  }

  public getCandidateChain(tier: ModelTier): RouterTarget[] {
    const chain: RouterTarget[] = [];

    if (tier === 'fast') {
      if (this.clients.has('github')) {
        chain.push({ provider: 'github', model: 'gpt-4o-mini', supportsJsonMode: true });
      }
      if (this.clients.has('groq')) {
        chain.push({ provider: 'groq', model: 'llama-3.1-8b-instant', supportsJsonMode: true });
      }
      if (this.clients.has('openrouter')) {
        chain.push({
          provider: 'openrouter',
          model: 'openai/gpt-4o-mini',
          supportsJsonMode: true,
        });
      }
      if (this.clients.has('github')) {
        chain.push({
          provider: 'github',
          model: 'Llama-3.3-70B-Instruct',
          supportsJsonMode: false,
        });
      }
      return chain;
    }

    // 'deep' synthesis & verification tier
    if (this.clients.has('github')) {
      chain.push(
        { provider: 'github', model: 'gpt-4o', supportsJsonMode: true },
        { provider: 'github', model: 'Llama-3.3-70B-Instruct', supportsJsonMode: false },
        { provider: 'github', model: 'DeepSeek-R1', supportsJsonMode: false }
      );
    }
    if (this.clients.has('groq')) {
      chain.push({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        supportsJsonMode: true,
      });
    }
    if (this.clients.has('openrouter')) {
      chain.push(
        { provider: 'openrouter', model: 'openai/gpt-4o', supportsJsonMode: true },
        { provider: 'openrouter', model: 'deepseek/deepseek-chat', supportsJsonMode: false }
      );
    }
    if (this.clients.has('github')) {
      chain.push({ provider: 'github', model: 'gpt-4o-mini', supportsJsonMode: true });
    }

    return chain;
  }

  public async generateJson<T>(params: {
    tier: ModelTier;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    data: T | null;
    modelUsed: string | null;
    providerUsed: RouterProvider | null;
    rateLimited: boolean;
  }> {
    const fullChain = this.getCandidateChain(params.tier);
    if (fullChain.length === 0) {
      return { data: null, modelUsed: null, providerUsed: null, rateLimited: false };
    }

    const available = this.cooldowns.getAvailableTargets(fullChain);
    if (available.length === 0) {
      return { data: null, modelUsed: null, providerUsed: null, rateLimited: true };
    }

    let sawRateLimit = false;

    for (const target of available) {
      const client = this.clients.get(target.provider);
      if (!client) continue;

      try {
        const completion = await client.chat.completions.create({
          model: target.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
          ...(target.model === 'DeepSeek-R1'
            ? {}
            : { temperature: params.temperature ?? 0.35 }),
          max_tokens: params.maxTokens ?? (params.tier === 'fast' ? 900 : 3200),
          ...(target.supportsJsonMode ? { response_format: { type: 'json_object' } } : {}),
        });

        const rawContent = completion.choices?.[0]?.message?.content ?? '';
        if (!rawContent.trim()) {
          continue;
        }

        const parsed = extractJsonObject<T>(rawContent);
        return {
          data: parsed,
          modelUsed: target.model,
          providerUsed: target.provider,
          rateLimited: false,
        };
      } catch (err) {
        if (isRateLimitOrQuotaError(err)) {
          sawRateLimit = true;
          this.cooldowns.markRateLimited(target, err);
          continue;
        }
        const brief = err instanceof Error ? err.message.slice(0, 180) : 'Model inference error';
        console.info(`ModelRouter fallback (${target.provider}:${target.model}): ${brief}`);
      }
    }

    const allCooling = this.cooldowns.getAvailableTargets(fullChain).length === 0;
    return {
      data: null,
      modelUsed: null,
      providerUsed: null,
      rateLimited: sawRateLimit || allCooling,
    };
  }
}
