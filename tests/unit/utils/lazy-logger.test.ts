import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('REQ-L2 — no module-scope getLogger() declarations', () => {
  it('src/ has zero top-level `const/let X = getLogger(` bindings', () => {
    // The exact acceptance grep from the PRD/work-item contract.
    let out = '';
    try {
      out = execSync(
        `rg -n "^(export )?(const|let) \\w+ = getLogger\\(" src/`,
        { encoding: 'utf-8' }
      );
    } catch (e: any) {
      // rg exits 1 on no matches — that is the PASS condition.
      expect(e.status).toBe(1);
      return;
    }
    throw new Error(`REQ-L2 violated — module-scope getLogger found:\n${out}`);
  });
});
