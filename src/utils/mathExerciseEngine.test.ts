import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areMathExpressionsEquivalent,
  buildMathExercisesFromText,
  detectMathDomainFromText,
  evaluateMathExpression,
} from './mathExerciseEngine';

test('evaluateMathExpression evaluates arithmetic, powers, fractions, and constants safely', () => {
  assert.equal(evaluateMathExpression('3/4'), 0.75);
  assert.equal(evaluateMathExpression('2^3 + 4 * 5'), 28);
  assert.equal(evaluateMathExpression('(2 + 4) / 3'), 2);
  assert.equal(evaluateMathExpression('sqrt(81) - 4'), 5);
  assert.equal(evaluateMathExpression('75%'), 0.75);
  assert.equal(evaluateMathExpression('x = 12'), 12);
  assert.equal(evaluateMathExpression('1/0'), null);
});

test('areMathExpressionsEquivalent matches fractions, decimals, and normalized expressions', () => {
  assert.equal(areMathExpressionsEquivalent('0.75', '3/4'), true);
  assert.equal(areMathExpressionsEquivalent('75%', '3/4'), true);
  assert.equal(areMathExpressionsEquivalent('2x + 3', '2x+3'), true);
  assert.equal(areMathExpressionsEquivalent('6.283', '2*pi'), true);
  assert.equal(areMathExpressionsEquivalent('0.5', '3/4'), false);
});

test('detectMathDomainFromText identifies calculus and linear algebra topics', () => {
  const signal = detectMathDomainFromText(
    'Compute the definite integral and find the eigenvalue of matrix A using det(A - λI) = 0.'
  );
  assert.equal(signal.isQuantHeavy, true);
  assert.ok(signal.detectedTopics.includes('Calculus'));
  assert.ok(signal.detectedTopics.includes('Linear Algebra'));
});

test('buildMathExercisesFromText generates calculation drills with worked steps', () => {
  const notes = `# Calculus & Linear Algebra
Power Rule: d/dx[x^n] = n*x^(n-1)
Matrix Determinant: det(A) = ad - bc`;
  const drills = buildMathExercisesFromText(notes, 4, 'Calculus');
  assert.equal(drills.length, 4);
  assert.ok(drills.every((d) => Array.isArray(d.workedSteps) && d.workedSteps.length >= 2));
});
