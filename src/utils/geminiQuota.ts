/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const FREE_TIER_TEXT_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

export function isQuotaOrRateError(error: unknown): boolean {
  const msg = extractErrorText(error).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('rate-limit') ||
    msg.includes('rate limit')
  );
}

export function extractErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function parseRetryDelaySeconds(error: unknown): number {
  const text = extractErrorText(error);

  // Explicit protobuf RetryInfo: "retryDelay":"59059s"
  const retryDelayMatch = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(text);
  if (retryDelayMatch) {
    const secs = Math.ceil(Number(retryDelayMatch[1]));
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(secs, 24 * 3600);
    }
  }

  // Human-readable "Please retry in 16h24m19.5s" or "retry in 42s"
  const hmsMatch = /retry in\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i.exec(text);
  if (hmsMatch) {
    const hours = Number(hmsMatch[1] ?? 0);
    const mins = Number(hmsMatch[2] ?? 0);
    const secs = Math.ceil(Number(hmsMatch[3] ?? 0));
    const total = hours * 3600 + mins * 60 + secs;
    if (total > 0) return Math.min(total, 24 * 3600);
  }

  // Daily free-tier quota vs short per-minute rate limit
  if (/perday|per day|free_tier_requests/i.test(text)) {
    return 3600;
  }
  return 180;
}

export class ModelCooldownTracker {
  private cooldownUntilByModel = new Map<string, number>();

  getAvailableModels(candidates: readonly string[], nowMs: number = Date.now()): string[] {
    return candidates.filter((model) => {
      const until = this.cooldownUntilByModel.get(model);
      if (until === undefined) return true;
      if (nowMs >= until) {
        this.cooldownUntilByModel.delete(model);
        return true;
      }
      return false;
    });
  }

  markQuotaExceeded(model: string, error: unknown, nowMs: number = Date.now()): number {
    const retrySeconds = parseRetryDelaySeconds(error);
    const until = nowMs + retrySeconds * 1000;
    this.cooldownUntilByModel.set(model, until);
    return retrySeconds;
  }

  areAllExhausted(candidates: readonly string[], nowMs: number = Date.now()): boolean {
    return this.getAvailableModels(candidates, nowMs).length === 0;
  }

  clear(): void {
    this.cooldownUntilByModel.clear();
  }
}

export function buildFriendlyQuotaMessage(): string {
  return 'Free-tier Gemini daily request quota reached. Built-in KusaQuiz engines still handle PDF/DOCX extraction, math drills, and flashcards offline — or select a billing-enabled API key in Settings > Secrets for higher limits.';
}
