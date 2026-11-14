import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelCooldownTracker,
  ModelRouter,
  extractJsonObject,
  isRateLimitOrQuotaError,
  parseRetryAfterMs,
  type ChatClientLike,
} from './modelRouter';

test('extractJsonObject strips DeepSeek think blocks, markdown fences, and extra prose', () => {
  const deepSeekOutput = `<think>
Let me verify the Vietnamese historical dates and distractors carefully.
</think>

Here is the JSON output you requested:
\`\`\`json
{
  "title": "Lịch sử Việt Nam",
  "cards": [
    { "prompt": "Câu hỏi 1", "answer": "Đáp án 1" }
  ]
}
\`\`\`
Hope this helps!`;

  const parsed = extractJsonObject<{ title: string; cards: Array<{ prompt: string; answer: string }> }>(
    deepSeekOutput
  );
  assert.equal(parsed.title, 'Lịch sử Việt Nam');
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].answer, 'Đáp án 1');
});

test('isRateLimitOrQuotaError and parseRetryAfterMs handle 429 status and Retry-After headers', () => {
  const errWithHeader = {
    status: 429,
    headers: { 'Retry-After': '42' },
    message: 'Too many requests',
  };
  assert.equal(isRateLimitOrQuotaError(errWithHeader), true);
  assert.equal(parseRetryAfterMs(errWithHeader), 42_000);

  const errWithText = {
    status: 429,
    message: 'Rate limit exceeded. Please retry in 15 seconds.',
  };
  assert.equal(parseRetryAfterMs(errWithText), 15_000);

  const nonRateErr = { status: 400, message: 'Bad request' };
  assert.equal(isRateLimitOrQuotaError(nonRateErr), false);
});

test('ModelCooldownTracker puts rate-limited models into cooldown and restores after expiry', () => {
  const tracker = new ModelCooldownTracker();
  const target = { provider: 'github' as const, model: 'gpt-4o', supportsJsonMode: true };
  const now = 1_000_000;

  assert.equal(tracker.isCoolingDown(target, now), false);
  tracker.markRateLimited(target, { status: 429, headers: { 'retry-after': '10' } }, now);
  assert.equal(tracker.isCoolingDown(target, now + 5_000), true);
  assert.equal(tracker.isCoolingDown(target, now + 10_500), false);
});

test('ModelRouter falls back from gpt-4o to Llama-3.3-70B-Instruct and DeepSeek-R1 on 429 rate limits', async () => {
  const calledModels: string[] = [];

  const mockClient: ChatClientLike = {
    chat: {
      completions: {
        async create({ model }) {
          calledModels.push(model);
          if (model === 'gpt-4o' || model === 'Llama-3.3-70B-Instruct') {
            const err = new Error('Rate limit reached for model');
            (err as { status?: number; headers?: Record<string, string> }).status = 429;
            (err as { headers?: Record<string, string> }).headers = { 'retry-after': '30' };
            throw err;
          }
          return {
            choices: [
              {
                message: {
                  content: `<think>Reasoning in Vietnamese</think>\n{"domain":"social_humanities","ok":true}`,
                },
              },
            ],
          };
        },
      },
    },
  };

  const router = new ModelRouter({
    githubToken: 'ghp_test_token_12345',
    groqApiKey: '',
    openrouterApiKey: '',
    clientFactory: () => mockClient,
  });

  const res = await router.generateJson<{ domain: string; ok: boolean }>({
    tier: 'deep',
    systemPrompt: 'Return JSON.',
    userPrompt: 'Analyze.',
  });

  assert.deepEqual(calledModels, ['gpt-4o', 'Llama-3.3-70B-Instruct', 'DeepSeek-R1']);
  assert.equal(res.modelUsed, 'DeepSeek-R1');
  assert.equal(res.providerUsed, 'github');
  assert.equal(res.data?.domain, 'social_humanities');
  assert.equal(res.rateLimited, false);
});
