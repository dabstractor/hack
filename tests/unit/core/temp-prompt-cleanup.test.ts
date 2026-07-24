/**
 * Regression tests for `src/core/temp-prompt-cleanup.ts` (PRD §9.3.3 — temp-file
 * cleanup half of "Prompt Delivery (no argv-size limit)").
 *
 * @remarks
 * These tests use a REAL tmpdir + REAL filesystem (NO module-wide `vi.mock`),
 * mirroring `tests/unit/core/file-lock.test.ts`. The unlink/Set.clear semantics
 * are meaningless against a mocked `node:fs`, so every disk-touching case
 * performs genuine I/O. A `vi.spyOn(process, 'exit')` is used to exercise the
 * signal-handler exit paths without terminating the test process (mirrors
 * file-lock.test.ts:413-471).
 *
 * Coverage map:
 *   1. temp-prompt-file registry — register/unregister/query (symmetric,
 *      idempotent).
 *   2. writeTempPromptFile — retry resilience (PRD §9.3.3: re-writes +
 *      re-registers on EVERY call).
 *   3. cleanupTrackedTempPromptFiles — disk unlink + Set.clear + idempotency
 *      (the load-bearing double-cleanup case: `exit` fires after a signal
 *      handler's `process.exit()`).
 *   4. process cleanup handlers — mockExit Variant A (explicit injectable) +
 *      Variant B (`vi.spyOn(process,'exit')`), 130/143.
 *   5. static invariant — no temp file backs a prompt today (PRD §9.3.3) +
 *      scanner self-test + `isPromptDeliveryProgrammatic` sentinel (ties the
 *      two §9.3.3 halves).
 *   6. SIGKILL / power-loss limitation is documented (PRD §9.3.3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  registerTempPromptFile,
  unregisterTempPromptFile,
  isTempPromptFileTracked,
  cleanupTrackedTempPromptFiles,
  onTempCleanupSignal,
  onTempSIGINTCleanup,
  onTempSIGTERMCleanup,
  writeTempPromptFile,
} from '../../../src/core/temp-prompt-cleanup.js';
import { isPromptDeliveryProgrammatic } from '../../../src/agents/prompt-delivery.js';

// ============================================================================
// TEST FIXTURES & HELPERS
// ============================================================================

/** Per-test temp dir (real fs; cleaned up in afterEach). */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'temp-prompt-cleanup-'));
});

afterEach(() => {
  // Clean the per-test dir (best-effort) AND reset spies/mocks.
  try {
    for (const f of readdirSync(dir)) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        // already gone — fine
      }
    }
    rmdirSync(dir);
  } catch {
    // already gone — fine
  }
  // Also drain any paths tracked from the previous test so registry state does
  // not leak across tests in this fork.
  cleanupTrackedTempPromptFiles();
  vi.restoreAllMocks();
});

// ============================================================================
// 1. temp-prompt-file registry
// ============================================================================

describe('temp-prompt-file registry', () => {
  it('register adds the path to the registry (isTempPromptFileTracked true)', () => {
    const p = join(dir, 'a.txt');
    expect(isTempPromptFileTracked(p)).toBe(false);
    registerTempPromptFile(p);
    expect(isTempPromptFileTracked(p)).toBe(true);
  });

  it('unregister removes the path (isTempPromptFileTracked false)', () => {
    const p = join(dir, 'b.txt');
    registerTempPromptFile(p);
    expect(isTempPromptFileTracked(p)).toBe(true);
    unregisterTempPromptFile(p);
    expect(isTempPromptFileTracked(p)).toBe(false);
  });

  it('double-unregister is a safe no-op (idempotent re-delete)', () => {
    const p = join(dir, 'c.txt');
    registerTempPromptFile(p);
    unregisterTempPromptFile(p);
    // Calling unregister again on an untracked path MUST NOT throw.
    expect(() => unregisterTempPromptFile(p)).not.toThrow();
    expect(isTempPromptFileTracked(p)).toBe(false);
  });

  it('querying an untracked path returns false', () => {
    expect(isTempPromptFileTracked(join(dir, 'never-registered.txt'))).toBe(
      false
    );
  });

  it('re-registering the same path tracks it exactly once (Set dedupes)', () => {
    const p = join(dir, 'd.txt');
    registerTempPromptFile(p);
    registerTempPromptFile(p);
    registerTempPromptFile(p);
    expect(isTempPromptFileTracked(p)).toBe(true);
    // A single unregister clears it.
    unregisterTempPromptFile(p);
    expect(isTempPromptFileTracked(p)).toBe(false);
  });
});

// ============================================================================
// 2. writeTempPromptFile — retry resilience (PRD §9.3.3)
// ============================================================================

describe('writeTempPromptFile — retry resilience (PRD §9.3.3)', () => {
  it('re-writes the file on every call (last write wins) and registers it', async () => {
    const p = join(dir, 'prompt.txt');
    // Three sequential writes with different content (simulating retries).
    await writeTempPromptFile(p, 'v1');
    await writeTempPromptFile(p, 'v2');
    await writeTempPromptFile(p, 'v3');
    // VERIFY: the file on disk reflects the THIRD write (re-written every call).
    expect(readFileSync(p, 'utf8')).toBe('v3');
    // VERIFY: the path is tracked (registered; Set dedupes to exactly once).
    expect(isTempPromptFileTracked(p)).toBe(true);
  });

  it('simulated retry factory re-writes + re-registers on every attempt', async () => {
    const p = join(dir, 'retry.txt');
    // A retry factory that re-writes the temp file on every invocation — the
    // shape a retryAgentPrompt(() => Promise<T>) consumer would use.
    const factory = async (content: string): Promise<string> => {
      const pp = await writeTempPromptFile(p, content);
      return pp;
    };
    await factory('attempt-1');
    await factory('attempt-2');
    await factory('attempt-3');
    // Last write wins (survives a /tmp mid-run sweep because each attempt
    // re-writes — PRD §9.3.3 retry clause).
    expect(readFileSync(p, 'utf8')).toBe('attempt-3');
    // Tracked exactly once (Set dedupes re-registers).
    expect(isTempPromptFileTracked(p)).toBe(true);
  });

  it('writing to a NEW path registers that path too', async () => {
    const p1 = join(dir, 'p1.txt');
    const p2 = join(dir, 'p2.txt');
    await writeTempPromptFile(p1, 'first');
    await writeTempPromptFile(p2, 'second');
    expect(isTempPromptFileTracked(p1)).toBe(true);
    expect(isTempPromptFileTracked(p2)).toBe(true);
    // Both files exist on disk with their respective content.
    expect(readFileSync(p1, 'utf8')).toBe('first');
    expect(readFileSync(p2, 'utf8')).toBe('second');
  });

  it('returns the targetPath for chaining', async () => {
    const p = join(dir, 'returned.txt');
    const returned = await writeTempPromptFile(p, 'x');
    expect(returned).toBe(p);
  });
});

// ============================================================================
// 3. cleanupTrackedTempPromptFiles
// ============================================================================

describe('cleanupTrackedTempPromptFiles', () => {
  it('unlinks every tracked file from disk and clears the registry', () => {
    // SETUP: write 2 real temp files + register each.
    const p1 = join(dir, 'one.txt');
    const p2 = join(dir, 'two.txt');
    writeFileSync(p1, 'one');
    writeFileSync(p2, 'two');
    registerTempPromptFile(p1);
    registerTempPromptFile(p2);
    expect(existsSync(p1)).toBe(true);
    expect(existsSync(p2)).toBe(true);

    // EXECUTE: cleanup.
    cleanupTrackedTempPromptFiles();

    // VERIFY: both unlinked from disk AND the Set is cleared.
    expect(existsSync(p1)).toBe(false);
    expect(existsSync(p2)).toBe(false);
    expect(isTempPromptFileTracked(p1)).toBe(false);
    expect(isTempPromptFileTracked(p2)).toBe(false);
  });

  it('is a safe no-op when called twice (idempotency — the load-bearing case)', () => {
    // The `exit` event fires AFTER a signal handler's process.exit(), so
    // cleanup runs TWICE. It MUST not throw on the second call.
    const p = join(dir, 'idempotent.txt');
    writeFileSync(p, 'x');
    registerTempPromptFile(p);
    cleanupTrackedTempPromptFiles(); // first run: unlinks + clears Set
    expect(existsSync(p)).toBe(false);
    // Second run iterates an empty Set + tryUnlink swallows ENOENT.
    expect(() => cleanupTrackedTempPromptFiles()).not.toThrow();
  });

  it('is a safe no-op when the registry is empty', () => {
    expect(() => cleanupTrackedTempPromptFiles()).not.toThrow();
  });

  it('swallows ENOENT for a tracked file that was already removed from disk', () => {
    const p = join(dir, 'vanished.txt');
    writeFileSync(p, 'x');
    registerTempPromptFile(p);
    unlinkSync(p); // remove from disk BEFORE cleanup (race / external sweep)
    expect(existsSync(p)).toBe(false);
    // cleanup MUST NOT throw on the already-gone file.
    expect(() => cleanupTrackedTempPromptFiles()).not.toThrow();
    expect(isTempPromptFileTracked(p)).toBe(false);
  });
});

// ============================================================================
// 4. process cleanup handlers (mirrors file-lock.test.ts:413-471)
// ============================================================================

describe('process cleanup handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Variant A — onTempCleanupSignal(code, mockExit) runs cleanup then surfaces the exit code', () => {
    // SETUP: register a REAL temp file so we can prove cleanup ran before mockExit.
    const p = join(dir, 'variant-a.txt');
    writeFileSync(p, 'x');
    registerTempPromptFile(p);
    expect(existsSync(p)).toBe(true);

    let exitCode: number | undefined;
    // EXECUTE: explicit injectable mockExit (Variant A).
    onTempCleanupSignal(130, c => {
      exitCode = c;
    });

    // VERIFY: exit code surfaced AND cleanup ran (file unlinked + untracked).
    expect(exitCode).toBe(130);
    expect(existsSync(p)).toBe(false);
    expect(isTempPromptFileTracked(p)).toBe(false);
  });

  it('Variant B — onTempSIGINTCleanup() exits 130 via the default-param process.exit spy', () => {
    let exitCode: number | undefined;
    // The `as never` cast is REQUIRED (TS process.exit signature differs from
    // the spy shim). The spy is hit ONLY because the default param
    // `c => process.exit(c)` re-resolves process.exit at call time.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      c?: number
    ) => {
      exitCode = c;
    }) as never);

    onTempSIGINTCleanup();

    expect(exitCode).toBe(130);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('Variant B — onTempSIGTERMCleanup() exits 143 via the default-param process.exit spy', () => {
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      c?: number
    ) => {
      exitCode = c;
    }) as never);

    onTempSIGTERMCleanup();

    expect(exitCode).toBe(143);
    expect(exitSpy).toHaveBeenCalledWith(143);
  });

  it('default path — onTempCleanupSignal(143) with NO mock arg hits process.exit(143)', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    expect(() => onTempCleanupSignal(143)).not.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(143);
  });
});

// ============================================================================
// 5. static invariant — no temp file backs a prompt today (PRD §9.3.3)
// ============================================================================

/**
 * Scanner: flags a temp-write call (`writeFile*`/`mkdtemp*`/`tmpdir()`) whose
 * bounded look-ahead (~300 chars, stopping at a statement terminator or block
 * open) references a prompt-named identifier. Scoped to the prompt-delivery
 * path — NOT a blanket `writeFile` ban (many legitimate writeFile sites exist:
 * PRP artifacts, tasks.json, metrics, MCP filesystem tool, test fixtures).
 *
 * The self-test below proves this scanner CAN match a real violation, so the
 * invariant test is not vacuously satisfied by a too-loose (always `[]`)
 * scanner.
 *
 * @remarks
 * Implementation note: the scan is done in TWO linear passes (find temp-write
 * call sites, then check a small ~300-char window after each for a prompt
 * identifier) rather than as a single regex. A single regex with a bounded
 * lazy quantifier (`[^;{]{0,300}?`) + alternation (`\w+Prompt`, `request.prompt`)
 * is catastrophically backtracking on long lines without `;`/`{` (the agent
 * source files are 10-30KB with long import/template strings). The two-pass
 * form is O(n) and semantically equivalent.
 */
const PROMPT_IDENTIFIERS = [
  'injectedPrompt',
  'fixPrompt',
  'request.prompt',
  // `\w+Prompt` covers any other *Prompt-named identifier (e.g. userPrompt,
  // fixPrompt). Matched as a word-boundary suffix check (see below).
];

// Matches a temp-write call site: writeFile / writeFileSync / mkdtemp /
// mkdtempSync / tmpdir(). Linear (no nested quantifiers over alternation).
const TEMP_WRITE_CALL_RE =
  /\b(?:writeFile|writeFileSync|mkdtemp|mkdtempSync|tmpdir\(\))\b/g;

// Matches a prompt-named identifier anywhere in a window: a literal from
// PROMPT_IDENTIFIERS, or any `\w+Prompt` word. Linear (no overlapping
// alternatives that share a prefix in a way that backtracks).
const PROMPT_ID_RE =
  /\b(?:injectedPrompt|fixPrompt|request\.prompt|\w+Prompt)\b/;

/**
 * Scan `source` for temp-write calls that back a prompt. Returns the matched
 * substrings (empty array = clean). For each temp-write call site, examines the
 * next ~300 chars (stopping at a statement terminator `;` or block open `{`)
 * for a prompt-named identifier.
 */
function scanForTempPromptBacking(source: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  TEMP_WRITE_CALL_RE.lastIndex = 0;
  while ((m = TEMP_WRITE_CALL_RE.exec(source)) !== null) {
    // Look ahead up to 300 chars, stopping at a statement terminator or block open.
    const windowStart = m.index + m[0].length;
    const hardEnd = Math.min(windowStart + 300, source.length);
    const slice = source.slice(windowStart, hardEnd);
    const stop = slice.search(/[;{]/);
    const effectiveSlice = stop === -1 ? slice : slice.slice(0, stop);
    if (PROMPT_ID_RE.test(effectiveSlice)) {
      matches.push(
        (m[0] + ' … ' + effectiveSlice).replace(/\s+/g, ' ').slice(0, 120)
      );
    }
    // Advance past this call site (TEMP_WRITE_CALL_RE is global + linear, so no
    // manual lastIndex nudging is needed unless the match is empty — it never is).
    if (TEMP_WRITE_CALL_RE.lastIndex === m.index)
      TEMP_WRITE_CALL_RE.lastIndex++;
  }
  return matches;
}

describe('static invariant — no temp file backs a prompt today (PRD §9.3.3)', () => {
  const agentRuntimeFiles = [
    'src/agents/prp-executor.ts',
    'src/agents/prp-generator.ts',
    'src/agents/prp-runtime.ts',
    'src/agents/agent-factory.ts',
    'src/tools/bash-mcp.ts',
  ];

  it.each(agentRuntimeFiles)(
    '%s does not back a prompt with a temp file',
    file => {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      const hits = scanForTempPromptBacking(src);
      expect(
        hits,
        `${file} must not back a prompt with a temp file (PRD §9.3.3). Matches: ${JSON.stringify(hits)}`
      ).toEqual([]);
    }
  );

  it('scanner self-test — a contrived temp-write-backing-a-prompt MUST match (proves the scanner is not a no-op)', () => {
    const contrived = 'writeFileSync(tmpPath, injectedPrompt);';
    expect(scanForTempPromptBacking(contrived)).not.toEqual([]);
  });

  it('scanner self-test — a writeFile with NO prompt identifier does NOT match (proves the scanner is scoped)', () => {
    const legit = 'writeFileSync(tasksJsonPath, JSON.stringify(backlog));';
    expect(scanForTempPromptBacking(legit)).toEqual([]);
  });

  it('isPromptDeliveryProgrammatic sentinel is true (ties the two §9.3.3 halves together)', () => {
    // S1 (argv half) confirms every prompt is delivered programmatically
    // (in-memory SDK call), so no temp file backs a prompt today. This sentinel
    // ties the two halves of PRD §9.3.3.
    expect(isPromptDeliveryProgrammatic).toBe(true);
  });
});

// ============================================================================
// 6. SIGKILL / power-loss limitation is documented (PRD §9.3.3)
// ============================================================================

describe('SIGKILL / power-loss limitation is documented (PRD §9.3.3)', () => {
  it('the production module source literally documents SIGKILL + power-loss + best-effort', () => {
    // Read the production module source. A literal-substring check LOCKS the
    // documentation in place — FAILS if a future edit silently drops the
    // limitation note.
    const src = readFileSync(
      resolve(process.cwd(), 'src/core/temp-prompt-cleanup.ts'),
      'utf8'
    );
    expect(src).toMatch(/SIGKILL/);
    expect(src).toMatch(/power-loss/);
    expect(src).toMatch(/best-effort/);
  });

  it('the production module source cites PRD §9.3.3', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/core/temp-prompt-cleanup.ts'),
      'utf8'
    );
    expect(src).toMatch(/PRD §9\.3\.3/);
  });
});
