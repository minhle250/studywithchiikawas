/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_TIER_TEXT_MODELS,
  ModelCooldownTracker,
  buildFriendlyQuotaMessage,
  isQuotaOrRateError,
  parseRetryDelaySeconds,
} from './geminiQuota';

test('isQuotaOrRateError detects 429 and RESOURCE_EXHAUSTED payloads without false positives', () => {
  const real429 = new Error(
    '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}'
  );
  assert.equal(isQuotaOrRateError(real429), true);
  assert.equal(isQuotaOrRateError(new Error('Rate limit exceeded')), true);
  assert.equal(isQuotaOrRateError(new Error('SyntaxError: Unexpected token')), false);
});

test('parseRetryDelaySeconds extracts protobuf retryDelay and h/m/s durations cleanly', () => {
  const protoErr = new Error('... "retryDelay":"59059s" ...');
  assert.equal(parseRetryDelaySeconds(protoErr), 59059);

  const humanErr = new Error('Please retry in 1h2m30s.');
  assert.equal(parseRetryDelaySeconds(humanErr), 3750);

  const genericPerDay = new Error('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  assert.equal(parseRetryDelaySeconds(genericPerDay), 3600);
});

test('ModelCooldownTracker skips exhausted models until cooldown expires and falls back to lite model', () => {
  const tracker = new ModelCooldownTracker();
  const t0 = 1_000_000;

  assert.deepEqual(tracker.getAvailableModels(FREE_TIER_TEXT_MODELS, t0), [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ]);

  tracker.markQuotaExceeded(
    'gemini-4-hydrogen',
    new Error('Please retry in 120s.'),
    t0
  );

  // Primary model is skipped, lite fallback remains available
  assert.deepEqual(tracker.getAvailableModels(FREE_TIER_TEXT_MODELS, t0 + 1000), [
    'gemini-3.1-flash-lite',
  ]);
  assert.equal(tracker.areAllExhausted(FREE_TIER_TEXT_MODELS, t0 + 1000), false);

  // Exhausting fallback marks all models exhausted until expiry
  tracker.markQuotaExceeded(
    'gemini-3.1-flash-lite',
    new Error('Please retry in 60s.'),
    t0 + 1000
  );
  assert.equal(tracker.areAllExhausted(FREE_TIER_TEXT_MODELS, t0 + 5000), true);

  // After 125 seconds, both cooldowns have cleared
  assert.deepEqual(tracker.getAvailableModels(FREE_TIER_TEXT_MODELS, t0 + 125_000), [
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
  ]);
  assert.ok(buildFriendlyQuotaMessage().includes('Settings > Secrets'));
});
