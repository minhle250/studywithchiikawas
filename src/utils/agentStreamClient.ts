import type { AgentTraceStep, GeneratedCardDraft, ResearchSource } from '../types/quiz';

export interface AgentQuizResult {
  title: string;
  description: string;
  subject: string;
  tool: 'agents';
  isQuantHeavy?: boolean;
  pedagogicalPlan?: string;
  researchSources?: ResearchSource[];
  cards: GeneratedCardDraft[];
}

export async function runAgentQuizStream(
  payload: {
    fileNames?: string[];
    sections?: Array<{ fileName?: string; title: string; content: string }>;
    topic?: string;
    notes?: string;
    difficulty: string;
    count: number;
  },
  onStep: (step: AgentTraceStep, sources?: ResearchSource[]) => void
): Promise<AgentQuizResult> {
  const res = await fetch('/api/agents/build-quiz-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Could not connect to AI Agent pipeline.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: AgentQuizResult | null = null;
  let streamError: string | null = null;

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const rawData = dataLines.join('\n');
    if (!rawData) return;

    const parsed = JSON.parse(rawData);
    if (eventName === 'agent-step') {
      const step: AgentTraceStep = {
        agent: parsed.agent,
        label: parsed.label,
        status: parsed.status,
        detail: parsed.detail,
      };
      onStep(step, Array.isArray(parsed.sources) ? parsed.sources : undefined);
    } else if (eventName === 'complete') {
      finalResult = parsed as AgentQuizResult;
    } else if (eventName === 'error') {
      streamError = parsed.error || 'AI Agent execution failed.';
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const b of blocks) {
        if (b.trim()) processBlock(b);
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    processBlock(buffer);
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!finalResult) {
    throw new Error('AI Agent stream closed before returning exercises.');
  }

  return finalResult;
}
