/**
 * Commit-identity structural guard (PRD §9.10.2 "Commit-Identity Structural Guard").
 *
 * @remarks
 * A self-source-scan test that mirrors stagecoach's FR-39a identity-invariant discipline: it
 * recursively walks every production TypeScript file under src/ (and Go files under cmd/ if
 * present), skips test files + the guard's own file + comment lines, and FAILS THE BUILD if any
 * non-comment production line contains a forbidden identity/attribution literal.
 *
 * This is the STRUCTURAL backstop for incident 1 (a hardcoded Co-Authored-By trailer that
 * violated §5.1's identity-transparency rule on every work-item commit). The behavioral fix is
 * already done (formatCommitMessage at src/utils/git-commit.ts emits no trailer); this guard
 * makes the prohibition a permanent compile/test-time invariant so the literal cannot land in
 * production code again without failing the build. See PRD §9.10.2 "structural enforcement
 * (self-source-scan test)".
 *
 * Forbidden-literal classes (call-site string literals, NOT bare comment substrings):
 * - trailer tokens (co-authored-by / co-authored / coauthor, case-insensitive);
 * - cargo-culted strings (noreply@anthropic.com, "Generated with [Claude Code]", 🤖 Generated);
 * - identity env-var names (GIT_AUTHOR_NAME / GIT_COMMITTER_* etc. — exact);
 * - identity-config writes (the shell form "git config user.name|email" or the array form
 *   ['config','user.name|email']; a bare user.name is NOT flagged without git-config proximity).
 *
 * Skip rules:
 * - test files (suffixes _test.go, .test.ts, .spec.ts);
 * - the guard's own file (it contains the literals as test fixtures);
 * - comment lines — full-line // comments, *-prefixed JSDoc continuation, and lines inside
 *   block comments (multi-line + inline) — so the 13 doc citations of incident 1 do not self-trip.
 *
 * Known limitation: a trailing line-comment on a CODE line is NOT stripped (only full comment
 * lines + block contents are skipped). Verified: no such line exists in the current src/ tree —
 * all 13 incident citations are full comment lines. If a future false-positive appears, strip
 * from the first unquoted line-comment marker.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// REPO_ROOT resolution (path-resolution-bug-proof; mirror prp-template-validation.test.ts).
// Resolve from the TEST FILE's location, NOT process.cwd() — the >0-files-visited
// assertion below exists to catch a wrong root.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url); // …/tests/unit/guards/commit-identity-guard.test.ts
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../..'); // repo root (3 levels up from tests/unit/guards/)
const SRC_DIR = join(REPO_ROOT, 'src');
const CMD_DIR = join(REPO_ROOT, 'cmd');

// ---------------------------------------------------------------------------
// Forbidden-literal detector (PURE — unit-testable; shared by both describe blocks).
// ---------------------------------------------------------------------------
// Case-insensitive trailer tokens; cargo-culted strings as written; exact env-var names.
const TRAILER_TOKENS = [/co-authored-by/i, /co-authored/i, /coauthor/i];
const CARGO_CULT = [
  /noreply@anthropic\.com/i,
  /Generated with \[Claude Code\]/,
  /🤖 Generated/,
];
const IDENTITY_ENV = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
];
// identity-config writes: user.name/user.email as args to a git-config call.
// Shell form (string command): git config user.name  /  git config user.email
// Array form: ['config', 'user.name']  /  ['config', 'user.email']
const CONFIG_WRITE = [
  /\bgit\s+config\s+user\.(name|email)\b/i,
  /\[\s*['"]config['"]\s*,\s*['"]user\.(name|email)['"]/,
];

type Violation = { file: string; line: number; literal: string };

/**
 * Returns the list of forbidden literals matched in a NON-COMMENT line (empty = clean).
 * Pure: same input → same output; no I/O. Shared by the detector unit tests + the walker.
 */
function findLineViolations(line: string): string[] {
  const hits: string[] = [];
  for (const re of TRAILER_TOKENS) {
    const m = line.match(re);
    if (m) hits.push(m[0]);
  }
  for (const re of CARGO_CULT) {
    const m = line.match(re);
    if (m) hits.push(m[0]);
  }
  for (const name of IDENTITY_ENV) {
    if (line.includes(name)) hits.push(name);
  }
  for (const re of CONFIG_WRITE) {
    const m = line.match(re);
    if (m) hits.push(`user.${m[1]}`);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Comment-skip state machine (per scanned file).
// ---------------------------------------------------------------------------
/**
 * Walks one file's lines, returning violations for NON-COMMENT lines. Skips full-line //
 * comments, *-prefixed JSDoc continuation, and lines inside block comments (multi-line + inline).
 */
function scanFileContent(absPath: string, relPath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = readFileSync(absPath, 'utf8').split('\n');
  let inBlock = false; // inside a /* … */ block
  lines.forEach((raw, idx) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return; // still inside the block → skip the whole line
      inBlock = false;
      line = line.slice(end + 2); // code after the closing */ (rare; usually empty)
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return; // full-line // comment
    if (trimmed.startsWith('*')) return; // JSDoc continuation (or */ … *-prefixed)
    if (trimmed.startsWith('/*')) {
      // a block START on this line
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        inBlock = true; // block opens, doesn't close → enter block, skip
        return;
      }
      line = line.slice(end + 2); // inline /* … */ → check the remainder
      if (!line.trim()) return;
    }
    const hits = findLineViolations(line);
    for (const literal of hits) {
      violations.push({ file: relPath, line: idx + 1, literal });
    }
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Recursive walker (skip test files + the guard's own file).
// ---------------------------------------------------------------------------
const TEST_SUFFIXES = ['_test.go', '.test.ts', '.spec.ts'];
const OWN_FILE = basename(fileURLToPath(import.meta.url)); // commit-identity-guard.test.ts

function walk(
  dir: string,
  ext: '.ts' | '.go',
  acc: { files: string[]; violations: Violation[] }
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, ext, acc);
    } else if (entry.isFile() && extname(entry.name) === ext) {
      if (TEST_SUFFIXES.some(s => entry.name.endsWith(s))) continue; // skip tests
      if (entry.name === OWN_FILE) continue; // skip the guard itself (belt-and-suspenders)
      acc.files.push(abs);
      acc.violations.push(...scanFileContent(abs, relative(REPO_ROOT, abs)));
    }
  }
}

// ===========================================================================
// (1) Detector unit tests — proves the detector FIRES on forbidden literals
//     and ignores benign code. Synthetic positive/negative lines (no tree
//     mutation). Satisfies PRD §9.10.2's "fires when injected" criterion.
// ===========================================================================
describe('commit-identity-guard > detector', () => {
  it('flags a Co-Authored-By string literal', () => {
    expect(
      findLineViolations('const trailer = "Co-Authored-By: Claude"')
    ).toContain('Co-Authored-By');
  });

  it('flags coauthor case-insensitively', () => {
    expect(findLineViolations('x(COAUTHOR)').length).toBeGreaterThan(0);
  });

  it('flags noreply@anthropic.com', () => {
    expect(
      findLineViolations('return "Claude <noreply@anthropic.com>"')
    ).toContain('noreply@anthropic.com');
  });

  it('flags a GIT_COMMITTER_NAME env literal', () => {
    expect(
      findLineViolations("process.env.GIT_COMMITTER_NAME = 'bot'")
    ).toContain('GIT_COMMITTER_NAME');
  });

  it('flags a shell-form git config user.name write', () => {
    expect(
      findLineViolations('await exec("git config user.name bot")')
    ).toContain('user.name');
  });

  it('flags an array-form [config, user.email] write', () => {
    expect(
      findLineViolations("git(['config', 'user.email', 'bot@x.com'])")
    ).toContain('user.email');
  });

  it('does NOT flag benign config (core.editor)', () => {
    expect(findLineViolations('git config core.editor vim')).toEqual([]);
  });

  it('does NOT flag npm test / plain code / empty', () => {
    expect(findLineViolations('await run("npm test")')).toEqual([]);
    expect(findLineViolations('')).toEqual([]);
  });
});

// ===========================================================================
// (2) Self-source-scan — walks the real src/ (+cmd/ if present), asserts ZERO
//     forbidden-literal violations + >0 production files visited.
// ===========================================================================
describe('commit-identity-guard > self-source-scan (PRD §9.10.2)', () => {
  it('reports ZERO forbidden identity literals across production src/ (+cmd/ if present)', () => {
    const acc: { files: string[]; violations: Violation[] } = {
      files: [],
      violations: [],
    };
    walk(SRC_DIR, '.ts', acc);
    walk(CMD_DIR, '.go', acc); // no-op today (cmd/ absent); future-proofs for a Go binary

    // Prevent a vacuous pass from a path-resolution bug:
    expect(
      acc.files.length,
      'must visit > 0 production files (path-resolution sanity)'
    ).toBeGreaterThan(0);

    // The headline assertion — zero forbidden hits:
    expect(acc.violations).toEqual([]);

    // On failure, print every violation with file:line:literal for fast triage:
    if (acc.violations.length) {
      console.error(
        acc.violations.map(v => `${v.file}:${v.line}: ${v.literal}`).join('\n')
      );
    }
  });
});
