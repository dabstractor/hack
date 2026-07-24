/**
 * Unit tests for src/agents/prompt-delivery.ts
 *
 * @remarks
 * Regression suite for PRD §9.3.3 "Prompt Delivery (no argv-size limit)".
 *
 * Two describe blocks:
 * 1. `assertPromptNotRoutedViaArgv` — unit tests for the defensive guard
 *    (under / over / boundary cases).
 * 2. `argv prompt delivery — static invariant audit (PRD §9.3.3)` — re-runs
 *    the P3.M2.T6.S1 audit at test time: reads the agent-runtime source
 *    files (`src/agents/*.ts` + `src/tools/bash-mcp.ts`) and asserts NONE
 *    passes a prompt-named identifier as a spawn/exec argv argument. This is
 *    the test that FAILS LOUDLY the moment a future commit reintroduces argv
 *    prompt delivery.
 *
 * IMPLEMENTATION NOTE (scanner): the PRP blueprint specifies a RegExp-based
 * scanner. Under the project's pinned vitest 1.6.1 running on Node 26, a
 * collected test file that applies a `spawn|exec`-matching RegExp to matching
 * input triggers an unrecoverable worker heap OOM during the collect phase
 * (a vitest↔Node-26 incompatibility — vitest 1.6.1 predates Node 26). To keep
 * the regression enforceable on this runtime, the scanner is implemented with
 * plain string search (`indexOf` + tokenization) instead of RegExp. The
 * detection semantics are identical: it flags any `spawn(`/`exec(`/`execSync(`/
 * `execFile(`/`spawnSync(` call whose argv region (up to the first close
 * paren, ≤400 chars) contains a prompt-named identifier
 * (`injectedPrompt`, `fixPrompt`, `request.prompt`, or any `*Prompt` token).
 * The self-test (TEST 7) proves the scanner is not a no-op.
 *
 * @see plan/008_15504f60a0ef/P3M2T6S1/research/01_prompt_delivery_audit.md
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPromptNotRoutedViaArgv,
  isPromptDeliveryProgrammatic,
  MAX_ARG_STRLEN,
} from '../../../src/agents/prompt-delivery.js';

/**
 * spawn/exec-family function names whose argv we audit. Anchored on the
 * function-call form (`fn + "("`) so prose / comments ("* spawn the agent")
 * do NOT trigger a match.
 */
const SPAWN_FNS = ['spawn', 'exec', 'execSync', 'execFile', 'spawnSync'];

/**
 * Prompt-named identifiers that, if found inside a spawn/exec argv, indicate
 * a prompt is routed via a command-line argument (PRD §9.3.3 violation).
 * Pinned by research/01 §"Project call sites".
 */
const PROMPT_ID_SUBSTRINGS = [
  'injectedPrompt', // prp-executor.ts L311
  'fixPrompt', // prp-executor.ts L616
  'request.prompt', // groundswell HarnessRequest.prompt (defensive)
  'Prompt', // catch-all suffix: anyXxxPrompt
];

/**
 * Maximum number of characters after a `fn(` open-paren to scan for a prompt
 * identifier before giving up (bounded to avoid scanning an entire file and
 * to mirror the PRP blueprint's `[^)]{0,400}?` look-ahead).
 */
const ARGV_SCAN_WINDOW = 400;

/**
 * Returns true if `token` looks like a prompt-named identifier.
 *
 * Matches any token containing one of the explicit prompt names, OR ending in
 * the `Prompt` suffix (the `\w+Prompt` catch-all from the PRP blueprint).
 */
function isPromptIdentifier(token: string): boolean {
  if (token.length === 0) return false;
  for (const id of PROMPT_ID_SUBSTRINGS) {
    if (token.includes(id)) return true;
  }
  return false;
}

/**
 * Scans source text for any spawn/exec-family call whose argv (text between
 * the open paren and the first close paren, up to `ARGV_SCAN_WINDOW` chars)
 * contains a prompt-named identifier. Returns the list of matching argv
 * regions (empty = invariant holds).
 *
 * @param source - The TypeScript source text to scan.
 * @returns Matching argv substrings (whitespace-collapsed, truncated).
 */
function scanForPromptArgv(source: string): string[] {
  const matches: string[] = [];
  for (const fn of SPAWN_FNS) {
    const needle = fn + '(';
    let from = 0;
    let idx: number;
    while ((idx = source.indexOf(needle, from)) !== -1) {
      // Extract the argv region: from the open paren up to the first close
      // paren (or ARGV_SCAN_WINDOW chars, whichever comes first).
      const sliceEnd = Math.min(source.length, idx + ARGV_SCAN_WINDOW);
      const slice = source.slice(idx, sliceEnd);
      const parenClose = slice.indexOf(')');
      const argvRegion = parenClose === -1 ? slice : slice.slice(0, parenClose);

      // Tokenize on common delimiters and check for prompt identifiers.
      const tokens = argvRegion.split(/[\s,;'"\[\]{}()]+/);
      let hit = false;
      for (const tok of tokens) {
        if (isPromptIdentifier(tok)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        matches.push(argvRegion.replace(/\s+/g, ' ').slice(0, 120));
      }

      from = idx + needle.length;
    }
  }
  return matches;
}

describe('assertPromptNotRoutedViaArgv', () => {
  it('passes silently for a prompt well under the argv limit', () => {
    // SETUP — a 1 KB prompt is far below MAX_ARG_STRLEN (128 KiB).
    const small = 'x'.repeat(1024);

    // EXECUTE & VERIFY — no throw.
    expect(() => assertPromptNotRoutedViaArgv(small, 'unit')).not.toThrow();
  });

  it('throws when the prompt exceeds MAX_ARG_STRLEN, citing the constraint', () => {
    // SETUP — exactly one byte over the limit.
    const big = 'x'.repeat(MAX_ARG_STRLEN + 1);

    // EXECUTE & VERIFY — throws with a self-documenting message citing all
    // three of MAX_ARG_STRLEN, E2BIG, and PRD §9.3.3 (so the failure is
    // self-diagnosing), plus the label and actual length.
    expect(() => assertPromptNotRoutedViaArgv(big, 'unit')).toThrow(
      /MAX_ARG_STRLEN/
    );
    expect(() => assertPromptNotRoutedViaArgv(big, 'unit')).toThrow(/E2BIG/);
    expect(() => assertPromptNotRoutedViaArgv(big, 'unit')).toThrow(
      /PRD §9\.3\.3/
    );
    expect(() => assertPromptNotRoutedViaArgv(big, 'CoderAgent')).toThrow(
      /\[CoderAgent\]/
    );
    expect(() => assertPromptNotRoutedViaArgv(big, 'unit')).toThrow(
      new RegExp(String(big.length))
    );
  });

  it('does NOT throw at the exact boundary (MAX_ARG_STRLEN is the max allowed)', () => {
    // SETUP — exactly MAX_ARG_STRLEN bytes (the edge). Semantics: strict `>`,
    // so a string of exactly the max-allowed length is permitted.
    const edge = 'x'.repeat(MAX_ARG_STRLEN);

    // EXECUTE & VERIFY — no throw (off-by-one safety on the `>` boundary).
    expect(() => assertPromptNotRoutedViaArgv(edge, 'unit')).not.toThrow();
  });
});

describe('argv prompt delivery — static invariant audit (PRD §9.3.3)', () => {
  // SETUP — vitest runs from the repo root (vitest.config.ts), so
  // resolve(process.cwd(), 'src/...') resolves to <repo>/src/... (corroborated
  // by the existing ../../../src/... relative imports used across this suite).
  const readSrc = (rel: string): string =>
    readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('agent runtime files pass no prompt as a spawn/exec argv', () => {
    // SETUP — the 4 agent-runtime audit targets.
    const agentFiles = [
      'src/agents/prp-executor.ts',
      'src/agents/prp-generator.ts',
      'src/agents/prp-runtime.ts',
      'src/agents/agent-factory.ts',
    ];

    // EXECUTE & VERIFY — each file must contain zero prompt-as-argv patterns.
    for (const file of agentFiles) {
      expect(
        scanForPromptArgv(readSrc(file)),
        `${file} must not pass a prompt as argv`
      ).toEqual([]);
    }
  });

  it('src/tools/bash-mcp.ts spawn command is a validation-gate command, not a prompt', () => {
    // SETUP & EXECUTE — bash-mcp.ts L178 spawn(command, { shell: true });
    // `command` is gate.command (a validation shell command), never an LLM
    // prompt (research/01 §"NOTE on bash-mcp").
    const hits = scanForPromptArgv(readSrc('src/tools/bash-mcp.ts'));

    // VERIFY
    expect(
      hits,
      'bash-mcp spawn command must be a validation-gate command, not a prompt'
    ).toEqual([]);
  });

  it('isPromptDeliveryProgrammatic sentinel asserts the audit conclusion', () => {
    // VERIFY — trivially true today, but documents the programmatic-delivery
    // conclusion as an executable assertion (research/01 §VERDICT).
    expect(isPromptDeliveryProgrammatic).toBe(true);
  });

  it('scanner self-test: catches a known prompt-as-argv violation', () => {
    // SETUP — a contrived violation that MUST be detected. Guards against the
    // scanner being too loose (e.g. never matching), which would make the
    // agent/bash-mcp assertions above vacuously pass.
    const contrived = "spawn('pi', ['--prompt', injectedPrompt])";

    // EXECUTE & VERIFY — non-empty means the scanner CAN match a real violation.
    expect(scanForPromptArgv(contrived)).not.toEqual([]);
  });
});
