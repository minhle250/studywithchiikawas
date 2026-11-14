import type { GeneratedCardDraft } from '../types/quiz';

/**
 * Safe recursive-descent arithmetic expression evaluator (no eval / Function).
 * Supports +, -, *, /, ^, parentheses, percentages (e.g. 75% -> 0.75),
 * constants (pi, e), and functions (sqrt, abs, sin, cos, tan, ln, log).
 */
export function evaluateMathExpression(raw: string): number | null {
  let expr = raw.trim();
  if (!expr) return null;

  // Strip common prefix labels like "x =" or "f'(x) =" if user typed an equation
  const eqParts = expr.split('=');
  if (eqParts.length === 2 && eqParts[1].trim().length > 0 && eqParts[0].trim().length <= 16) {
    expr = eqParts[1].trim();
  }

  // Normalize unicode operators and constants
  expr = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/\s+/g, '');

  // Convert trailing percent like 75% -> (75/100)
  expr = expr.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');

  // Insert implicit multiplication: 2pi -> 2*pi, 2(3) -> 2*(3), (2)(3) -> (2)*(3)
  expr = expr
    .replace(/(\d)(pi|e|sqrt|abs|sin|cos|tan|ln|log|\()/gi, '$1*$2')
    .replace(/(\))(\d|pi|e|\()/gi, '$1*$2');

  let pos = 0;

  const peek = () => expr[pos] ?? '';
  const consume = () => expr[pos++] ?? '';

  const parseExpression = (): number => {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      val = op === '+' ? val + right : val - right;
    }
    return val;
  };

  const parseTerm = (): number => {
    let val = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parsePower();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        val /= right;
      } else {
        val *= right;
      }
    }
    return val;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === '^') {
      consume();
      const exp = parsePower(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    if (peek() === '(') {
      consume();
      const inner = parseExpression();
      if (consume() !== ')') throw new Error('Missing closing parenthesis');
      return inner;
    }

    // Number literal
    const numMatch = /^\d+(?:\.\d+)?/.exec(expr.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return Number(numMatch[0]);
    }

    // Identifier: constant or math function
    const idMatch = /^[a-zA-Z]+/.exec(expr.slice(pos));
    if (idMatch) {
      const name = idMatch[0].toLowerCase();
      pos += idMatch[0].length;
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;

      if (peek() === '(') {
        consume();
        const arg = parseExpression();
        if (consume() !== ')') throw new Error('Missing closing parenthesis');
        switch (name) {
          case 'sqrt':
            if (arg < 0) throw new Error('Negative sqrt');
            return Math.sqrt(arg);
          case 'abs':
            return Math.abs(arg);
          case 'sin':
            return Math.sin(arg);
          case 'cos':
            return Math.cos(arg);
          case 'tan':
            return Math.tan(arg);
          case 'ln':
            if (arg <= 0) throw new Error('Non-positive ln');
            return Math.log(arg);
          case 'log':
            if (arg <= 0) throw new Error('Non-positive log');
            return Math.log10(arg);
          default:
            throw new Error(`Unknown function: ${name}`);
        }
      }
      throw new Error(`Unknown symbol: ${name}`);
    }

    throw new Error(`Unexpected token at ${pos}`);
  };

  try {
    const result = parseExpression();
    if (pos !== expr.length || !Number.isFinite(result)) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export function normalizeAlgebraicString(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '');
}

/**
 * Checks if two mathematical answers represent the same numeric value (within tolerance)
 * or identical normalized algebraic expressions (e.g. "3/4" == "0.75", "2x + 3" == "2x+3").
 */
export function areMathExpressionsEquivalent(
  userInput: string,
  expectedAnswer: string,
  tolerance: number = 1e-3
): boolean {
  const normA = normalizeAlgebraicString(userInput);
  const normB = normalizeAlgebraicString(expectedAnswer);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const valA = evaluateMathExpression(userInput);
  const valB = evaluateMathExpression(expectedAnswer);
  if (valA !== null && valB !== null) {
    const scale = Math.max(1, Math.abs(valB));
    return Math.abs(valA - valB) <= tolerance * scale;
  }

  return false;
}

export interface MathDomainSignal {
  isQuantHeavy: boolean;
  confidence: number;
  detectedTopics: string[];
}

const MATH_SIGNAL_KEYWORDS: Array<{ pattern: RegExp; topic: string }> = [
  { pattern: /\b(derivative|integral|differenti|antiderivative|calculus|limit|taylor|series)\b/i, topic: 'Calculus' },
  { pattern: /\b(matrix|matrices|eigenvalue|eigenvector|determinant|linear algebra|vector space|dot product)\b/i, topic: 'Linear Algebra' },
  { pattern: /\b(probability|variance|standard deviation|bayes|distribution|expectation|hypothesis|p-value)\b/i, topic: 'Probability & Statistics' },
  { pattern: /\b(equation|polynomial|quadratic|logarithm|exponential|trigonometr|sin|cos|slope|intercept)\b/i, topic: 'Algebra & Functions' },
  { pattern: /\b(differential equation|laplace|fourier|ode|pde|gradient|divergence)\b/i, topic: 'Differential Equations' },
  { pattern: /\b(complexity|big-o|recurrence|algorithm|dynamic programming|binary search|graph)\b/i, topic: 'Algorithms & Discrete Math' },
  { pattern: /\b(molarity|stoichiometry|enthalpy|kinetic|velocity|acceleration|force|ohm|voltage)\b/i, topic: 'Quantitative Science' },
];

export function detectMathDomainFromText(text: string): MathDomainSignal {
  if (!text || !text.trim()) {
    return { isQuantHeavy: false, confidence: 0, detectedTopics: [] };
  }

  const matchedTopics: string[] = [];
  for (const entry of MATH_SIGNAL_KEYWORDS) {
    if (entry.pattern.test(text)) {
      matchedTopics.push(entry.topic);
    }
  }

  // Also count formula/equation/symbol density (=, ∫, ∑, ^, dx, dy, fractions)
  const symbolMatches = text.match(/[=+\-*/^∫∑√πλΔ]/g)?.length ?? 0;
  const equationDensity = symbolMatches / Math.max(1, text.length / 100);

  const score = Math.min(1, matchedTopics.length * 0.28 + (equationDensity > 1.2 ? 0.3 : 0));
  return {
    isQuantHeavy: matchedTopics.length > 0 || equationDensity > 1.8,
    confidence: Number(score.toFixed(2)),
    detectedTopics: matchedTopics,
  };
}

/**
 * Deterministic math/calculation practice generator fallback when AI is offline.
 * Extracts formulas and generates numerical/procedural calculation drills with worked steps.
 */
export function buildMathExercisesFromText(
  rawText: string,
  count: number = 5,
  subjectHint: string = 'Applied Mathematics'
): GeneratedCardDraft[] {
  const signal = detectMathDomainFromText(rawText);
  const exercises: GeneratedCardDraft[] = [];

  // Cap formula-recognition items to <= 25% of deck so hands-on numerical calculations dominate
  const maxFormulaCards = Math.max(1, Math.floor(count * 0.25));
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (exercises.length >= maxFormulaCards) break;
    const eq = /^([A-Za-z0-9\s'()-]{2,42})\s*[:–—-]\s*([^:]{3,90}=[^:]{1,90})$/.exec(line);
    if (eq) {
      const label = eq[1].trim();
      const formula = eq[2].trim();
      exercises.push({
        prompt: `Apply "${label}" (${formula}) conceptually: which formula expresses ${label}?`,
        answer: formula,
        distractors: [
          formula.includes('+') ? formula.replace('+', '-') : `${formula} + C`,
          formula.includes('*') ? formula.replace('*', '/') : `2(${formula})`,
          'f(x) = 0',
        ],
        acceptableAnswers: [formula],
        hint: `Recall the exact mathematical structure of ${label}.`,
        explanation: `${label} is given by ${formula}. Practice substituting numerical inputs step by step.`,
        conceptTag: signal.detectedTopics[0] ?? subjectHint,
        exerciseType: 'worked-example',
        formulaUsed: formula,
        workedSteps: [
          `Identify the governing rule: ${label}`,
          `Write the formula cleanly: ${formula}`,
          'Substitute known values and verify units or boundary signs.',
        ],
      });
    }
  }

  // Add concrete, verified calculation drills calibrated to detected quantitative domains
  const topicSet = new Set(signal.detectedTopics);
  const templateBank: GeneratedCardDraft[] = [];

  if (topicSet.has('Calculus') || exercises.length < count) {
    templateBank.push(
      {
        prompt: 'Compute the definite integral ∫₀² (3x² + 2x) dx.',
        answer: '12',
        distractors: ['10', '14', '8'],
        acceptableAnswers: ['12', '12.0'],
        hint: 'Find the antiderivative x³ + x² first, then evaluate from x = 0 to x = 2.',
        explanation: 'Using the Power Rule for integration, ∫(3x² + 2x)dx = x³ + x². Evaluating [2³ + 2²] - [0] = 8 + 4 = 12.',
        conceptTag: 'Definite Integration',
        exerciseType: 'calculation',
        formulaUsed: '∫ xⁿ dx = xⁿ⁺¹ / (n + 1)',
        workedSteps: [
          'Integrate term-by-term: ∫3x² dx = x³ and ∫2x dx = x².',
          'Evaluate upper bound x = 2: 2³ + 2² = 8 + 4 = 12.',
          'Evaluate lower bound x = 0: 0³ + 0² = 0, so 12 - 0 = 12.',
        ],
      },
      {
        prompt: 'Evaluate the derivative f\'(3) for f(x) = 2x³ - 5x + 7.',
        answer: '49',
        distractors: ['54', '44', '39'],
        acceptableAnswers: ['49'],
        hint: 'Differentiate term-by-term to get f\'(x) = 6x² - 5, then substitute x = 3.',
        explanation: 'Power Rule gives f\'(x) = 6x² - 5. At x = 3, f\'(3) = 6(9) - 5 = 54 - 5 = 49.',
        conceptTag: 'Differentiation Practice',
        exerciseType: 'calculation',
        formulaUsed: 'd/dx [xⁿ] = n·xⁿ⁻¹',
        workedSteps: [
          'Differentiate 2x³ → 6x² and -5x → -5; constant 7 → 0.',
          'Substitute x = 3: 6(3²) - 5 = 6(9) - 5.',
          'Compute 54 - 5 = 49.',
        ],
      }
    );
  }

  if (topicSet.has('Linear Algebra') || exercises.length < count) {
    templateBank.push(
      {
        prompt: 'Compute the determinant of the 2×2 matrix [[4, 3], [2, 5]].',
        answer: '14',
        distractors: ['26', '10', '20'],
        acceptableAnswers: ['14'],
        hint: 'For [[a, b], [c, d]], det = ad - bc.',
        explanation: 'det([[4, 3], [2, 5]]) = (4 × 5) - (3 × 2) = 20 - 6 = 14.',
        conceptTag: 'Matrix Determinants',
        exerciseType: 'calculation',
        formulaUsed: 'det(A) = ad - bc',
        workedSteps: [
          'Multiply main diagonal: 4 × 5 = 20.',
          'Multiply off-diagonal: 3 × 2 = 6.',
          'Subtract: 20 - 6 = 14.',
        ],
      },
      {
        prompt: 'Find the dot product of vectors u = (3, -2, 4) and v = (5, 1, -2).',
        answer: '5',
        distractors: ['9', '13', '-5'],
        acceptableAnswers: ['5'],
        hint: 'Multiply corresponding components and sum: u₁v₁ + u₂v₂ + u₃v₃.',
        explanation: 'u · v = (3)(5) + (-2)(1) + (4)(-2) = 15 - 2 - 8 = 5.',
        conceptTag: 'Vector Dot Product',
        exerciseType: 'calculation',
        formulaUsed: 'u · v = Σ uᵢvᵢ',
        workedSteps: [
          'Compute x-term: 3 × 5 = 15.',
          'Compute y-term: -2 × 1 = -2.',
          'Compute z-term: 4 × (-2) = -8; sum 15 - 2 - 8 = 5.',
        ],
      }
    );
  }

  if (topicSet.has('Probability & Statistics') || exercises.length < count) {
    templateBank.push({
      prompt: 'A fair 6-sided die is rolled twice. What is the probability that the sum equals 7? (Give fraction or decimal)',
      answer: '1/6',
      distractors: ['1/12', '7/36', '1/3'],
      acceptableAnswers: ['1/6', '6/36', '0.167'],
      hint: 'Count how many pairs (a, b) out of 36 satisfy a + b = 7.',
      explanation: 'There are 6 favorable outcomes: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1) out of 36 total pairs = 6/36 = 1/6.',
      conceptTag: 'Discrete Probability',
      exerciseType: 'worked-example',
      formulaUsed: 'P(E) = |E| / |Ω|',
      workedSteps: [
        'Total ordered outcomes for 2 dice: 6 × 6 = 36.',
        'List sums of 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1) → 6 pairs.',
        'Divide 6 / 36 and simplify to 1/6 (≈ 0.167).',
      ],
    });
  }

  if (topicSet.has('Algorithms & Discrete Math') || exercises.length < count) {
    templateBank.push({
      prompt: 'How many comparisons at most does binary search perform on a sorted array of 1,024 elements? (⌈log₂(N+1)⌉)',
      answer: '11',
      distractors: ['10', '32', '512'],
      acceptableAnswers: ['11', '10'],
      hint: 'Recall 2¹⁰ = 1,024, so log₂(1025) sits just above 10.',
      explanation: 'At each step binary search halves the search range. Since 2¹⁰ = 1024 < 1025 ≤ 2¹¹, at most 11 comparisons are needed.',
      conceptTag: 'Algorithmic Complexity',
      exerciseType: 'calculation',
      formulaUsed: 'T(n) ≤ ⌈log₂(n + 1)⌉',
      workedSteps: [
        'Identify array size n = 1,024.',
        'Compute 2¹⁰ = 1,024, so log₂(1024 + 1) ≈ 10.0014.',
        'Take ceiling: ⌈10.0014⌉ = 11 comparisons worst-case.',
      ],
    });
  }

  for (const item of templateBank) {
    if (exercises.length >= count) break;
    exercises.push(item);
  }

  return exercises.slice(0, count);
}
