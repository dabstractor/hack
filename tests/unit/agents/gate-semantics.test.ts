import { describe, expect, it } from 'vitest';
import { isNegatedFileExistenceGate } from '../../../src/agents/gate-semantics.js';

describe('agents/gate-semantics — isNegatedFileExistenceGate', () => {
  // EXECUTE + VERIFY — full behavior table (PRD §9.9.2 G2.1/G2.2/G2.3)
  it.each<[command: string, expected: boolean]>([
    // G2.1 — negated existence gates (must return true)
    ['! test -f src/hooks/index.ts', true],
    ['test ! -f x', true],
    ['! [ -e x ]', true],
    ['[ ! -d x ]', true],

    // G2.2 — negated content (must execute normally → false)
    ['! grep -q TODO src/x.ts', false],

    // Positive existence / content / unrelated (→ false)
    ['test -f x', false],
    ['grep -q foo x', false],
    ['npm test', false],

    // G2.3 — ambiguous (conservative → false)
    ['test -n foo', false],
    ['test foo', false],

    // Extra conservative edge cases → false
    ['test -f x -a ! -f y', false], // compound expression
    ['bash -c "! test -f x"', false], // wrapped in bash -c
  ])('returns %j for %s', (command, expected) => {
    expect(isNegatedFileExistenceGate(command)).toBe(expected);
  });

  // EXECUTE + VERIFY — defensive: empty / non-string input
  it('returns false for empty / non-string input (defensive)', () => {
    expect(isNegatedFileExistenceGate('')).toBe(false);
    expect(isNegatedFileExistenceGate('   ')).toBe(false);
  });

  // EXECUTE + VERIFY — whitespace tolerance (regex uses \s+)
  it('tolerates leading/extra whitespace in negated-existence forms', () => {
    expect(isNegatedFileExistenceGate('  test ! -d  x  ')).toBe(true);
  });
});
