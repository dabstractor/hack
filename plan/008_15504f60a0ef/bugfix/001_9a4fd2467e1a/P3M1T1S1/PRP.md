# PRP — P3.M1.T1.S1: Create next-bugfix-sequence helper to scan existing numbered children

---

## Goal

**Feature Goal**: Create the **foundational numbering helper** that produces the
next numbered `bugfix/NNN_hash/` directory path for a session — mirroring the
codebase's canonical `NNN_hash` session-directory convention
(`SESSION_DIR_PATTERN = /^(\d{3})_([a-f0-9]{12})$/`, `String(seq).padStart(3,'0')`
+ 12-char SHA-256 slice). This is the **pure, read-only primitive** that S2
(`runQACycle` bugfix-dir creation) and S3 (`#detectInterruptedBugfix` scanning)
will consume to replace the current flat `bugfix/` directory (PRD §4.4 step 3,
§5.1 "plan/NNN_hash/bugfix/NNN_hash/"). S1 touches **only** `session-utils.ts`
and its unit tests — NO change to `prp-pipeline.ts`.

**Deliverable**:
1. **`src/core/session-utils.ts`** — ADD two exported pure helpers (with full JSDoc):
   - `nextBugfixDir(sessionPath: string, hashSeed: string): Promise<{ dir: string; sequence: number }>` —
     scans `sessionPath/bugfix/` for existing `NNN_*` children, returns the next
     sequence number (`max(found)+1`, or `1` if none/ENOENT) and the constructed
     `resolve(sessionPath, 'bugfix', '${NNN}_${12hexhash}')` path. Hashes
     `hashSeed` via `hashPRDContent` and slices to 12 chars (mirrors
     `createSessionDirectory`'s `fullHash.slice(0, 12)`).
   - `generateBugfixHash(seed?: string): string` — returns a 12-char lowercase-hex
     hash: `hashPRDContent(seed ?? randomBytes(8).toString('hex')).slice(0, 12)`
     when `seed` is provided, else a `randomBytes(6).toString('hex')` uniqueness
     fallback (the "timestamp/random-based hash for uniqueness" option in the
     contract). Decouples hashing from numbering so S2 can pass either the bug
     report content OR nothing.
   - **ADD `readdir` to the existing `node:fs/promises` import** (currently
     missing — `readFile/writeFile/mkdir/rename/unlink/stat` are imported but
     `readdir` is not).
2. **`tests/unit/core/session-utils.test.ts`** — ADD `readdir: vi.fn()` to the
   existing `vi.mock('node:fs/promises', …)` block + a `describe('nextBugfixDir', …)`
   and `describe('generateBugfixHash', …)` covering every branch (ENOENT→1,
   empty→1, no-match→1, match→max+1, non-ENOENT rethrow, seed-hashed vs
   random-fallback) — driving **100% branch coverage** on the new code.

**Success Definition**:
- `nextBugfixDir('/plan/001_abc', bugReport)` returns
  `{ dir: '/plan/001_abc/bugfix/001_<12hex>', sequence: 1 }` when `bugfix/` is
  absent (ENOENT) or empty; `002_<12hex>` / `2` when `001_x` exists; `003` / `3`
  when `001_x` and `002_y` exist.
- The regex `/^(\d{3})_/` is used to extract sequences (rejecting non-`NNN_`
  entries like `architecture/`, stray files), mirroring `SESSION_DIR_PATTERN`.
- ENOENT on `sessionPath/bugfix/` is treated as "first iteration" (→ sequence 1),
  NOT an error; non-ENOENT errors re-throw.
- `nextBugfixDir` is **read-only** — it does NOT create any directory (S2 owns
  `mkdir`). It only reads the listing and returns a path string + integer.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: The pipeline's QA loop (`runQACycle`) and bugfix-detection logic
(`#detectInterruptedBugfix`) — internal callers, not a human.
**Use Case**: A bug-hunt iteration finds bugs → S2's `runQACycle` calls
`nextBugfixDir(sessionPath, bugReportContent)` to get the next numbered bugfix
directory → creates it → runs the fix cycle there. Each iteration gets a unique
`bugfix/NNN_hash/`, archiving (not overwriting) prior iterations.
**User Journey**: `runQACycle` (hasBugs=true) → `nextBugfixDir(...)` →
`{dir, sequence}` → `mkdir(dir, {recursive:true})` → copy `TEST_RESULTS.md` →
`#runBugFixCycle(dir, prdContent)`.
**Pain Points Addressed**: Today only ONE flat `bugfix/` dir exists per session;
re-running QA overwrites the prior iteration (no audit trail). PRD §4.4 step 3 &
§5.1 mandate numbered iterations `bugfix/001_hash/`, `bugfix/002_hash/`.

---

## Why

- **PRD compliance**: PRD §4.4 step 3 — *"Each bug hunt iteration creates a new
  numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc."*; §5.1 —
  *"Session structure: `plan/NNN_hash/bugfix/NNN_hash/`"*. The bugfix PRD (Issue 4)
  classifies the current flat-dir behavior as a Minor defect with this exact fix.
- **Foundational**: contract item 4 OUTPUT — *"Consumed by P3.M1.T1.S2 (runQACycle)
  and P3.M1.T1.S3 (#detectInterruptedBugfix)."* S1 is the prerequisite primitive;
  S2 and S3 cannot be implemented correctly without it.
- **Audit trail**: numbering preserves prior bugfix iterations (no overwrite),
  enabling the audit/recovery semantics PRD §4.4 expects.
- **Consistency**: mirrors the EXISTING `NNN_hash` convention used for top-level
  sessions (`session-manager.ts` / `session-utils.ts`) — no new naming scheme.

### Out of scope (hard fences)
- **`runQACycle` creation wiring** → S2. S1 does NOT edit `prp-pipeline.ts:~1862`.
- **`#detectInterruptedBugfix` scanning wiring** → S3. S1 does NOT edit `prp-pipeline.ts:~1913`.
- **Integration/lifecycle tests** → S4.
- **`FixCycleWorkflow`** → READ-ONLY (its `sessionPath.includes('bugfix')` check
  passes unchanged on `bugfix/001_hash/`; architecture doc confirms).
- **`PRD.md` / `tasks.json` / `prd_snapshot.md` / `vitest.config.ts`** → READ-ONLY.
- **Any mkdir / file creation** in the helper → S1's helper is READ-ONLY (returns a
  path; S2 owns `mkdir`). Do NOT create `bugfix/` inside `nextBugfixDir`.

---

## What

### User-visible behavior
None directly (internal helper). Indirectly, once S2/S3 wire it, the pipeline
will create `plan/NNN_hash/bugfix/001_<12hex>/`, `…/002_<12hex>/`, etc. instead
of a single flat `bugfix/`.

### Technical requirements (exact contract — item 3)

**(a) `nextBugfixDir(sessionPath, hashSeed)` (session-utils.ts).** Pure + async +
read-only. Mirror `SessionManager.__scanSessionDirectories`
(session-manager.ts:1395) + `#getNextSequence` (session-manager.ts:346) applied to
`sessionPath/bugfix/`:

```ts
const BUGFIX_DIR_PATTERN = /^(\d{3})_/;  // mirror SESSION_DIR_PATTERN's NNN_ prefix

/**
 * Returns the next numbered bugfix directory for a session (PRD §4.4 step 3, §5.1).
 *
 * @remarks
 * Mirrors the main-session NNN_hash convention (SESSION_DIR_PATTERN) under the
 * bugfix/ subdirectory: each bug-hunt iteration that finds bugs gets a unique
 * `bugfix/NNN_<12hexhash>/` child, archiving (not overwriting) prior iterations.
 * Scans `sessionPath/bugfix/` for existing `NNN_*` children and returns the next
 * sequence number (max(found)+1, or 1 if none). A missing bugfix/ dir (ENOENT)
 * means "first iteration" → sequence 1; the helper is READ-ONLY (it does not
 * create the directory — the caller owns mkdir).
 *
 * The 12-char hash component is derived from `hashSeed` via {@link hashPRDContent}
 * (sha256, first 12 hex chars), matching {@link createSessionDirectory}'s
 * `fullHash.slice(0, 12)` rule. Pass the bug-report content as the seed so each
 * distinct report yields a distinct hash; pass any unique string if you only need
 * uniqueness.
 *
 * @param sessionPath - The main session directory (e.g. plan/001_14b9dc2a33c7/).
 * @param hashSeed    - Seed content hashed (sha256, first 12 hex) for the dir name.
 * @returns `{ dir, sequence }` where dir = resolve(sessionPath,'bugfix','NNN_<12hex>').
 * @throws {Error} Rethrows non-ENOENT readdir errors.
 *
 * @example
 * ```ts
 * const { dir, sequence } = await nextBugfixDir(sessionPath, bugReportContent);
 * await mkdir(dir, { recursive: true });   // caller owns creation
 * // dir  = '/…/plan/001_14b9dc2a33c7/bugfix/001_a1b2c3d4e5f6'
 * // sequence = 1
 * ```
 */
export async function nextBugfixDir(
  sessionPath: string,
  hashSeed: string
): Promise<{ dir: string; sequence: number }> {
  const bugfixDir = resolve(sessionPath, 'bugfix');
  const hash12 = hashPRDContent(hashSeed).slice(0, 12);  // mirror createSessionDirectory

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(bugfixDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // First iteration: no bugfix/ dir yet.
      const sequence = 1;
      return {
        dir: resolve(bugfixDir, `${String(sequence).padStart(3, '0')}_${hash12}`),
        sequence,
      };
    }
    throw error;
  }

  const sequences = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const m = e.name.match(BUGFIX_DIR_PATTERN);
      return m ? parseInt(m[1], 10) : NaN;
    })
    .filter((n) => !Number.isNaN(n));

  const sequence = sequences.length > 0 ? Math.max(...sequences) + 1 : 1;
  return {
    dir: resolve(bugfixDir, `${String(sequence).padStart(3, '0')}_${hash12}`),
    sequence,
  };
}
```

**(b) `generateBugfixHash(seed?)` (session-utils.ts).** Decouples hashing from
numbering so S2 can pass either bug-report content OR nothing (uniqueness-only):

```ts
/**
 * Generates a 12-char lowercase-hex hash for a bugfix directory name (PRD §4.4).
 *
 * @remarks
 * When `seed` is provided, hashes it via {@link hashPRDContent} and slices to 12
 * chars (matching {@link createSessionDirectory}'s rule). When omitted, returns a
 * random 12-char hex ({@link randomBytes}(6)) for pure uniqueness — the
 * "timestamp/random-based hash" fallback noted in the work-item contract.
 *
 * @param seed - Optional content to hash (e.g. bug-report bytes). If omitted, a
 *               random 12-hex string is returned.
 * @returns 12-character lowercase-hex string.
 *
 * @example
 * ```ts
 * generateBugfixHash(bugReportContent); // 'a1b2c3d4e5f6' (deterministic)
 * generateBugfixHash();                 // '7f3e…' (random, unique)
 * ```
 */
export function generateBugfixHash(seed?: string): string {
  if (seed !== undefined) {
    return hashPRDContent(seed).slice(0, 12);
  }
  return randomBytes(6).toString('hex');  // 12 random hex chars
}
```

**(c) Add `readdir` import.** The current `node:fs/promises` import
(session-utils.ts:26-33) lists `readFile, writeFile, mkdir, rename, unlink, stat`
but NOT `readdir`. **ADD `readdir`** to that import list (alphabetical/clean
order). `createHash` and `randomBytes` are already imported from `node:crypto`
(session-utils.ts:25).

**(d) Placement.** Place `nextBugfixDir` + `generateBugfixHash` + the
`BUGFIX_DIR_PATTERN` const in `session-utils.ts`, **adjacent to
`createSessionDirectory`** (after it, ≈line 755) — they share the NNN_hash
numbering theme. Define `BUGFIX_DIR_PATTERN` as a module-level `const` near the
top of the file OR directly above the helper (consistent with
`SESSION_DIR_PATTERN` being module-level in session-manager.ts:69).

**(e) Tests [Mode A — JSDoc rides with the work].** In
`tests/unit/core/session-utils.test.ts`:
- **ADD `readdir: vi.fn()`** to the existing `vi.mock('node:fs/promises', …)` block
  (≈line 36-42) and import it (`import { …, readdir } from 'node:fs/promises';`
  ≈line 51). Cast: `const mockReaddir = readdir as any;`.
- **ADD** `describe('nextBugfixDir', …)` covering:
  - ENOENT on bugfix/ → `{ sequence: 1, dir: …/bugfix/001_<hash> }`.
  - empty entries → sequence 1.
  - entries with NO `NNN_` match (e.g. `['architecture']`, stray files) → sequence 1.
  - entries `['001_aaaaaaaaaaaa']` → sequence 2.
  - entries `['001_aaaaaaaaaaaa', '002_bbbbbbbbbbbb']` → sequence 3.
  - non-directory entries (files) ignored → sequence 1.
  - non-ENOENT error (e.g. `EACCES`) → re-thrown (`mockReaddir.mockRejectedValue(...)`).
  - hashSeed is hashed (assert the 12-hex slice appears in `.dir`).
- **ADD** `describe('generateBugfixHash', …)` covering:
  - `seed` provided → `hashPRDContent(seed).slice(0,12)` (deterministic; mock
    createHash to return a known 64-hex digest, assert the 12-char slice).
  - `seed` omitted → `randomBytes(6).toString('hex')` (mock randomBytes to a known
    12-hex value, assert it).
  - (the `seed !== undefined` branch + the else branch — both for 100% coverage).

### Success Criteria
- [ ] `nextBugfixDir` returns `sequence: 1` on ENOENT / empty / no-match; `2` on
      one `NNN_` child; `3` on two; `max+1` in general.
- [ ] `dir` = `resolve(sessionPath,'bugfix','NNN_<12hex>')` with NNN zero-padded
      to 3 digits and the hash = `hashPRDContent(hashSeed).slice(0,12)`.
- [ ] ENOENT is swallowed (→ seq 1); non-ENOENT errors re-throw.
- [ ] `nextBugfixDir` is read-only (no `mkdir` call inside it).
- [ ] `generateBugfixHash('x')` === `hashPRDContent('x').slice(0,12)`; no-arg
      returns a 12-hex random string.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a 2-file change (one source helper module + its unit tests). Its
correctness hinges on eight pre-proven facts, all pinned with file:line anchors
below: (1) the **canonical `NNN_hash` pattern** `SESSION_DIR_PATTERN =
/^(\d{3})_([a-f0-9]{12})$/` (session-manager.ts:69) and how the session ID is
BUILT (`String(seq).padStart(3,'0')` + `_` + `fullHash.slice(0,12)`,
session-utils.ts:661-666); (2) the **canonical scan-and-increment pattern**
`SessionManager.__scanSessionDirectories` (session-manager.ts:1395-1420) +
`#getNextSequence` (346-353) — the EXACT thing to mirror (readdir withFileTypes +
regex match + parseInt + ENOENT→[]); (3) the **hash primitive** `hashPRDContent`
(session-utils.ts:245-251) returns a 64-char sha256 hex, sliced to 12; (4)
`readdir` is **NOT yet imported** in session-utils.ts (must be added to the
node:fs/promises import block, lines 26-33); (5) `createHash` + `randomBytes`
**ARE already imported** (session-utils.ts:25) — no new crypto import needed;
(6) the **test mock convention** — `vi.mock('node:fs/promises', …)` exists at
session-utils.test.ts:36-42 but does NOT yet list `readdir` (must be added, else
the helper hits the real FS); (7) **100% branch coverage** is enforced
(vitest.config.ts:41-47) — every branch (ENOENT, empty, no-match, match,
non-ENOENT rethrow, seed-hashed, random-fallback) MUST be driven by a test;
(8) the helper is **read-only** (S2 owns mkdir) — placing it in session-utils.ts
(the lower pure-utility layer, already owning createSessionDirectory/hashPRD) is
correct and avoids prp-pipeline.ts coupling. Scope fences are airtight (no
prp-pipeline.ts edit, no mkdir, no FixCycleWorkflow, zero overlap with S2/S3/S4).

### Documentation & References
```yaml
# MUST READ — the PRD spec (already provided in selected_prd_content)
- docfile: PRD.md (bugfix doc)
  section: "Issue 4: Bugfix sessions use a flat bugfix/ directory" (h3.3)
       + PRD §4.4 step 3 + §5.1 (cited inside Issue 4)
  why: Issue 4 is the normative rule S1 implements — "Number bugfix sessions
       (bugfix/NNN_hash/) … archive rather than overwrite prior iterations."
  critical: The NNN_hash pattern is mandated by PRD §5.1 "plan/NNN_hash/bugfix/NNN_hash/".

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/P3M1T1S1/research/s1-codebase-analysis.md
  section: §1 (NNN_hash pattern), §2 (the canonical scan to mirror), §3 (file decision),
       §4 (imports needed), §5 (hash seed decision), §6 (ENOENT), §7 (return shape),
       §8 (test conventions), §9 (scope fences), §10 (validation commands)
  why: Proves every edit site, the regex, the ENOENT semantics, the read-only
       contract, the readdir-mock gap, and the 100%-coverage branch list.

# MUST READ — architecture reference (cited by the contract's RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/bugfix/001_9a4fd2467e1a/architecture/bugfix_numbering.md
  section: "### Session Numbering Helper" + "### Key File Paths" + "### Mutual Consistency Note"
  why: Confirms the flat-dir current state, the NNN_hash fix strategy, the exact
       helper signature sketch, and that FixCycleWorkflow's includes('bugfix')
       check passes unchanged on the numbered path.

# THE FILE TO EDIT (the helper)
- file: src/core/session-utils.ts
  section: (1) imports — ADD `readdir` to node:fs/promises import (lines 26-33);
       (2) ADD BUGFIX_DIR_PATTERN const (module-level, near where other consts
       live, OR directly above the helper); (3) ADD nextBugfixDir + generateBugfixHash
       AFTER createSessionDirectory (ends ≈line 755).
  why: session-utils.ts ALREADY owns createSessionDirectory (the NNN_hash creator,
       lines 626-754) + hashPRD/hashPRDContent — it is the canonical home for
       numbering primitives. prp-pipeline.ts imports FROM it.
  pattern: createSessionDirectory (626-754) for the padStart(3,'0')+slice(0,12)
       naming; hashPRDContent (245-251) for the hash; SessionManager.__scanSessionDirectories
       (session-manager.ts:1395-1420) for the readdir+regex+ENOENT scan.
  gotcha: readdir is NOT yet imported — ADD it. Do NOT mkdir inside nextBugfixDir
       (read-only; S2 owns creation). Use the regex /^(\d{3})_/ (NOT a loose
       split('_')) to match the canonical SESSION_DIR_PATTERN discipline and
       reject malformed entries.

# THE FILE TO EDIT (tests)
- file: tests/unit/core/session-utils.test.ts
  section: (1) vi.mock('node:fs/promises', …) block (≈36-42) — ADD readdir: vi.fn();
       (2) import line (≈51) — ADD readdir; (3) cast (≈59) — ADD const mockReaddir;
       (4) ADD describe('nextBugfixDir') + describe('generateBugfixHash') blocks.
  why: Locks the helper behavior AND covers every new branch for the 100%-coverage gate.
  pattern: existing mockCreateHash/mockMkdir/mockReadFile chains; per-test
       mockReaddir.mockResolvedValue([...Dirent-like {name, isDirectory: ()=>true}]);
       EACCES via mockReaddir.mockRejectedValue(Object.assign(new Error('denied'),{code:'EACCES'})).
  gotcha: the existing node:fs/promises mock does NOT list readdir — WITHOUT adding it,
       nextBugfixDir's readdir call hits the REAL filesystem (tests non-deterministic /
       wrong). Dirent entries need .name (string) + .isDirectory() (fn returning bool).
       createHash mock must chain update().digest() to a 64-hex string for the slice(0,12)
       assertion. randomBytes mock must return a {toString:()=>'<12hex>'}-like for the
       no-seed branch.

# THE CANONICAL PATTERN TO MIRROR (read-only reference)
- file: src/core/session-manager.ts
  section: SESSION_DIR_PATTERN (line 69); __scanSessionDirectories (1395-1420);
       #getNextSequence (346-353); #getSessionPath (324-327).
  why: This is the EXACT scan-and-increment pattern nextBugfixDir mirrors, applied
       to plan/ instead of bugfix/. Copy its shape (readdir withFileTypes + regex
       match + parseInt + ENOENT→[] + reduce max+1), adapting only the target dir.
  gotcha: session-manager uses the FULL /^(\d{3})_([a-f0-9]{12})$/ regex (NNN +
       12-hex). For the bugfix SCAN we only need the NNN prefix /^(\d{3})_/ to find
       the max sequence (the hash half isn't needed for sequencing). Use the prefix
       regex in the scan; the full hash goes into the NEW dir name we construct.

# CONTRACT INPUTS (read-only)
- file: src/workflows/prp-pipeline.ts
  section: runQACycle bugfix-dir creation (≈1855-1885) + #detectInterruptedBugfix
       (≈1913). READ-ONLY for S1 (S2/S3 edit these).
  why: Confirms the consumer call sites so the helper signature matches what S2/S3
       will need: `const { dir } = await nextBugfixDir(sessionPath, bugReportContent)`.
  gotcha: DO NOT edit prp-pipeline.ts in S1. S2 replaces line 1862
       (`resolve(sessionPath,'bugfix')`) with the nextBugfixDir call; S3 rewrites
       the scan. S1 only PROVIDES the primitive.

- file: vitest.config.ts
  section: coverage.include = ['src/**/*.ts']; thresholds 100/100/100/100.
  why: Confirms the new helper code is coverage-gated — every branch MUST be tested.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  core/
    session-utils.ts          # EDIT — +readdir import, +BUGFIX_DIR_PATTERN, +nextBugfixDir, +generateBugfixHash
    session-manager.ts        # READ-ONLY — SESSION_DIR_PATTERN, __scanSessionDirectories (the mirror source)
  workflows/
    prp-pipeline.ts           # READ-ONLY (S1) — runQACycle (~1855) + #detectInterruptedBugfix (~1913) are S2/S3
tests/
  unit/
    core/
      session-utils.test.ts   # EDIT — +readdir to mock, +describe('nextBugfixDir'), +describe('generateBugfixHash')
vitest.config.ts              # READ-ONLY — 100% coverage thresholds
package.json                  # READ-ONLY — npm run validate gate
PRD.md (bugfix doc)           # READ-ONLY — Issue 4 (h3.3) + §4.4/§5.1
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/core/session-utils.ts             # MODIFIED — pure numbering helper for bugfix/NNN_hash/ dirs
tests/unit/core/session-utils.test.ts # MODIFIED — locks helper behavior + covers all branches (100% coverage)
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (readdir not yet imported): session-utils.ts imports readFile/writeFile/
// mkdir/rename/unlink/stat from node:fs/promises (lines 26-33) but NOT readdir.
// ADD readdir to that import or nextBugfixDir's readdir(...) call is unresolved at
// typecheck AND hits the real FS at runtime.
// CRITICAL (test mock gap): tests/unit/core/session-utils.test.ts:36-42 mocks
// node:fs/promises WITHOUT readdir. ADD `readdir: vi.fn()` to the mock object AND
// to the import at line 51, else the helper's readdir hits the real FS in tests
// (non-deterministic, wrong results). Cast: `const mockReaddir = readdir as any;`.
// CRITICAL (read-only helper): nextBugfixDir MUST NOT call mkdir. It only reads the
// bugfix/ listing and returns {dir, sequence}. S2's runQACycle owns mkdir(dir).
// Creating the dir here would (a) violate the single-responsibility contract and
// (b) make the "ENOENT → first iteration" branch untestable without FS writes.
// CRITICAL (use the regex, not split): the contract's sketch uses
// `parseInt(e.split('_')[0], 10)` — LOOSER than the canonical SESSION_DIR_PATTERN.
// Use /^(\d{3})_/.exec(name) (or .match) so malformed entries (e.g. a stray file
// named 'foo_bar', or 'architecture') don't accidentally parse as sequence numbers.
// parseInt('foo',10) === NaN — the filter(!Number.isNaN) saves you, but the regex
// is the disciplined mirror of SESSION_DIR_PATTERN; prefer it.
// CRITICAL (100% branch coverage): vitest.config.ts enforces 100/100/100/100 on
// src/**/*.ts. Every branch in nextBugfixDir + generateBugfixHash MUST be exercised:
//   nextBugfixDir: ENOENT-branch (seq 1) + success-empty (seq 1) + success-no-match
//     (seq 1) + success-with-match (max+1) + non-ENOENT-throw (rethrow) +
//     hashSeed-hashed (the slice(0,12) line — covered by any non-ENOENT/ENOENT case).
//   generateBugfixHash: seed-defined branch (hashPRDContent) + seed-undefined branch
//     (randomBytes). BOTH need a test or coverage fails npm run validate.
// GOTCHA (Dirent mock shape): readdir({withFileTypes:true}) returns Dirent[]; each
// needs .name (string) + .isDirectory() (function → boolean). Build mock entries as
// { name: '001_aaaaaaaaaaaa', isDirectory: () => true }. For file entries use
// isDirectory: () => false to test the filter(e=>e.isDirectory()) branch.
// GOTCHA (createHash mock chain): the existing tests mock createHash as
// mockCreateHash.mockReturnValue({ update: vi.fn(() => ({ digest: vi.fn(() => '<64hex>') })) }).
// generateBugfixHash(seed) calls hashPRDContent(seed) which calls createHash — so
// seed-branch coverage depends on this chain returning a 64-hex string whose
// slice(0,12) you can assert.
// GOTCHA (randomBytes mock): the existing mock is `randomBytes: vi.fn()` (line 31).
// For the no-seed branch, mockReturnValue({ toString: (enc) => '<12hex>' }) so
// generateBugfixHash() returns the expected 12 chars.
// GOTCHA (file placement): put the helper in session-utils.ts (NOT prp-pipeline.ts).
// session-utils.ts is the pure-utility layer owning createSessionDirectory + hashPRD;
// prp-pipeline.ts is the orchestrator that will IMPORT the helper (S2/S3). Putting
// it in prp-pipeline.ts would force S3's scan to import from the orchestrator (bad
// layering) and couple the pure helper to the workflow class.
// GOTCHA (FixCycleWorkflow check): FixCycleWorkflow validates sessionPath.includes(
// 'bugfix'). The numbered path 'bugfix/001_<hash>/' STILL contains 'bugfix', so the
// check passes unchanged — S1 does NOT touch FixCycleWorkflow (architecture doc
// confirms). Do not "fix" it.
// GOTCHA (scope): do NOT edit prp-pipeline.ts in S1. S2 replaces line ~1862; S3
// rewrites #detectInterruptedBugfix (~1913). S1 only PROVIDES nextBugfixDir +
// generateBugfixHash. Zero file overlap with S2/S3/S4 (they edit prp-pipeline.ts;
// S1 edits session-utils.ts + its test).
```

---

## Implementation Blueprint

### Data models and structure
No ORM/pydantic models (TypeScript project). The only type-level addition is the
return type of `nextBugfixDir`: `Promise<{ dir: string; sequence: number }>`
(declared inline — no new exported interface needed; if desired, a small
`BugfixDirInfo` interface may be exported for S3 reuse, but inline is sufficient
for S1's contract). `generateBugfixHash` returns `string`.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/core/session-utils.ts — imports + pattern const + helpers
  - EDIT the node:fs/promises import (lines 26-33): ADD `readdir` to the list.
    (createHash + randomBytes are already imported from node:crypto at line 25 —
    no crypto change.)
  - ADD a module-level const (near other module consts, OR directly above the helper):
      const BUGFIX_DIR_PATTERN = /^(\d{3})_/;
  - ADD generateBugfixHash(seed?: string): string AFTER createSessionDirectory
    (≈line 755):
      if (seed !== undefined) return hashPRDContent(seed).slice(0, 12);
      return randomBytes(6).toString('hex');
  - ADD nextBugfixDir(sessionPath, hashSeed): Promise<{dir, sequence}> AFTER
    generateBugfixHash. Body per "What" §(a): resolve(sessionPath,'bugfix');
    hash12 = hashPRDContent(hashSeed).slice(0,12); try readdir({withFileTypes:true});
    catch ENOENT → return {dir: …/001_<hash12>, sequence:1}; else rethrow;
    sequences = entries.filter(isDirectory).map(name.match(BUGFIX_DIR_PATTERN)
    → parseInt).filter(!NaN); sequence = sequences.length? max+1 : 1;
    return {dir: resolve(bugfixDir, `${padStart(3,'0')}_${hash12}`), sequence}.
  - ADD full JSDoc to both helpers (Mode A — rides with the work) explaining the
    NNN_hash numbering + archive semantics (see "What" §a/§b for the JSDoc text).
  - PRESERVE: createSessionDirectory, hashPRD, hashPRDContent, all other exports.
  - FOLLOW pattern: SessionManager.__scanSessionDirectories (session-manager.ts:1395)
    + createSessionDirectory's slice(0,12) naming.
  - GOTCHA: do NOT mkdir inside nextBugfixDir. do NOT use split('_') — use the
    regex. do NOT edit prp-pipeline.ts.

Task 2: MODIFY tests/unit/core/session-utils.test.ts — mock readdir + helper tests
  - EDIT the vi.mock('node:fs/promises', …) block (≈36-42): ADD `readdir: vi.fn()`.
  - EDIT the import (≈51): ADD `readdir` to the destructured import.
  - EDIT the casts (≈57-60): ADD `const mockReaddir = readdir as any;`.
  - ADD beforeEach/afterEach reset for mockReaddir if the file has a global reset
    (mirror how mockMkdir/mockReadFile are reset).
  - ADD describe('nextBugfixDir', …) with cases:
      * ENOENT → sequence 1, dir ends with /bugfix/001_<hash12>.
        mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'),{code:'ENOENT'})).
      * empty entries → sequence 1. mockReaddir.mockResolvedValue([]).
      * entries with no NNN_ match (['architecture','README.md' as file]) → seq 1.
      * one match ['001_aaaaaaaaaaaa'] → sequence 2, dir ends /002_<hash12>.
      * two matches ['001_aaaaaaaaaaaa','002_bbbbbbbbbbbb'] → sequence 3.
      * non-directory entries ignored (a file named '001_zzz') → seq 1.
      * non-ENOENT error (EACCES) → await expect(nextBugfixDir(...)).rejects.toThrow().
      * hashSeed hashed: assert mockCreateHash was called with hashSeed AND the
        returned dir contains the 12-char slice of the mocked digest.
      (use a known hashSeed like 'bug-report-content' and mock createHash to return
      a 64-hex digest so slice(0,12) is predictable, e.g. 'a1b2c3d4e5f6...'.)
  - ADD describe('generateBugfixHash', …) with cases:
      * seed provided → returns hashPRDContent(seed).slice(0,12) (assert === the
        mocked 12-char slice; deterministic).
      * seed undefined → returns randomBytes(6).toString('hex') (mock randomBytes
        to return {toString: () => 'deadbeefcafe'}; assert === 'deadbeefcafe').
  - FOLLOW pattern: the existing mockCreateHash/mockMkdir/mockReadFile test style;
    Dirent mocks as { name, isDirectory: vi.fn(() => true|false) }.
  - GOTCHA: MUST exercise BOTH the ENOENT branch AND the non-ENOENT-throw branch,
    AND both generateBugfixHash branches, or 100% coverage fails npm run validate.

Task 3: VERIFY — no regressions
  - RUN npm run typecheck → exit 0 (readdir import resolves; helpers typecheck).
  - RUN npx vitest run tests/unit/core/session-utils.test.ts → ALL green incl. new
    describe blocks.
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (new branches
    in nextBugfixDir + generateBugfixHash are covered).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the two intended files changed: git diff --name-only →
    src/core/session-utils.ts, tests/unit/core/session-utils.test.ts.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the canonical scan (mirror SessionManager.__scanSessionDirectories).
// session-utils.ts — applied to sessionPath/bugfix/ instead of planDir:
const BUGFIX_DIR_PATTERN = /^(\d{3})_/;
export async function nextBugfixDir(sessionPath: string, hashSeed: string) {
  const bugfixDir = resolve(sessionPath, 'bugfix');
  const hash12 = hashPRDContent(hashSeed).slice(0, 12);  // mirror createSessionDirectory
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(bugfixDir, { withFileTypes: true });   // ← readdir (NEW import)
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {                                   // ← ENOENT branch (MUST cover)
      const sequence = 1;
      return { dir: resolve(bugfixDir, `${String(sequence).padStart(3, '0')}_${hash12}`), sequence };
    }
    throw error;                                                    // ← non-ENOENT rethrow (MUST cover)
  }
  const sequences = entries
    .filter((e) => e.isDirectory())
    .map((e) => { const m = e.name.match(BUGFIX_DIR_PATTERN); return m ? parseInt(m[1], 10) : NaN; })
    .filter((n) => !Number.isNaN(n));
  const sequence = sequences.length > 0 ? Math.max(...sequences) + 1 : 1;  // ← match branch + empty branch
  return { dir: resolve(bugfixDir, `${String(sequence).padStart(3, '0')}_${hash12}`), sequence };
}

// PATTERN: decouple hashing from numbering (generateBugfixHash).
export function generateBugfixHash(seed?: string): string {
  if (seed !== undefined) {                       // ← seed branch (MUST cover)
    return hashPRDContent(seed).slice(0, 12);
  }
  return randomBytes(6).toString('hex');           // ← random branch (MUST cover)
}

// PATTERN (test): Dirent mock + createHash chain.
const mockReaddir = readdir as any;
beforeEach(() => { mockReaddir.mockReset(); });
it('returns sequence 2 when one NNN_ child exists', async () => {
  mockReaddir.mockResolvedValue([
    { name: '001_aaaaaaaaaaaa', isDirectory: () => true },
  ]);
  mockCreateHash.mockReturnValue({ update: vi.fn(() => ({ digest: vi.fn(() => 'a1b2c3d4e5f6' + '0'.repeat(52)) })) });
  const { dir, sequence } = await nextBugfixDir('/plan/001_x', 'bug-report');
  expect(sequence).toBe(2);
  expect(dir).toBe('/plan/001_x/bugfix/002_a1b2c3d4e5f6');
});
it('ENOENT → sequence 1', async () => {
  mockReaddir.mockRejectedValue(Object.assign(new Error('noent'), { code: 'ENOENT' }));
  const { sequence } = await nextBugfixDir('/plan/001_x', 'seed');
  expect(sequence).toBe(1);
});
it('non-ENOENT rethrows', async () => {
  mockReaddir.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(nextBugfixDir('/plan/001_x', 'seed')).rejects.toThrow();
});

// CRITICAL: readdir is a NEW import — add it to node:fs/promises (line 26-33).
// CRITICAL: add readdir: vi.fn() to the test's node:fs/promises mock (line 36-42).
// CRITICAL: helper is read-only (NO mkdir). Use the regex, not split('_').
// CRITICAL: cover EVERY branch (ENOENT, throw, empty, match, seed, random).
```

### Integration Points
```yaml
SESSION-UTILS (src/core/session-utils.ts):
  - add import: `readdir` to the node:fs/promises import block (lines 26-33).
  - add const: BUGFIX_DIR_PATTERN = /^(\d{3})_/.
  - add export: generateBugfixHash(seed?: string): string.
  - add export: nextBugfixDir(sessionPath, hashSeed): Promise<{dir, sequence}>.
  - unchanged: createSessionDirectory, hashPRD, hashPRDContent, all other exports.

TESTS (tests/unit/core/session-utils.test.ts):
  - add to mock: `readdir: vi.fn()` in vi.mock('node:fs/promises', …).
  - add to import: `readdir`.
  - add cast: `const mockReaddir = readdir as any;`.
  - add: describe('nextBugfixDir') + describe('generateBugfixHash').

NO PRP-PIPELINE.TS EDIT / NO MKDIR / NO FIXCYCLEWORKFLOW / NO PRD.md / NO tasks.json
  — S1 is a pure read-only numbering primitive + its unit tests.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (readdir import resolves; helpers typecheck)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. The helper is additive + mirrors existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/core/session-utils.test.ts   # incl. new nextBugfixDir + generateBugfixHash blocks
npx vitest run --coverage                              # 100/100/100/100 on src/**/*.ts
npm run test:run                                       # full suite green
# Expected: ALL green. The new helper's ENOENT/throw/empty/match + seed/random
# branches are all exercised (else coverage fails).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Functional smoke (helper behavior via a temp tree — NOT a unit test, just a check):
node --input-type=module -e "
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { nextBugfixDir, generateBugfixHash } from './dist/core/session-utils.js';
const tmp = '/tmp/bugfix-smoke-' + Date.now();
mkdirSync(tmp + '/bugfix/001_aaaaaaaaaaaa', { recursive: true });
const r1 = await nextBugfixDir(tmp, 'report-A');
console.log('after 1 child:', r1.sequence, r1.dir.endsWith('/bugfix/002_'));
const r2 = await nextBugfixDir('/nonexistent-' + Date.now(), 'report-B');
console.log('ENOENT path:', r2.sequence === 1, r2.dir.endsWith('/bugfix/001_'));
console.log('hash deterministic:', generateBugfixHash('x') === generateBugfixHash('x'));
console.log('hash random len:', generateBugfixHash().length === 12);
rmSync(tmp, { recursive: true, force: true });
"
# EXPECT: after 1 child: 2 true ; ENOENT path: true true ;
#         hash deterministic: true ; hash random len: true
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the helper + pattern const exist exactly once:
rg -n "export async function nextBugfixDir" src/core/session-utils.ts   # one match
rg -n "export function generateBugfixHash" src/core/session-utils.ts    # one match
rg -n "BUGFIX_DIR_PATTERN" src/core/session-utils.ts                    # one+ match (const + use)

# Confirm readdir was added to the import + mock:
rg -n "readdir" src/core/session-utils.ts                               # import present
rg -n "readdir: vi.fn" tests/unit/core/session-utils.test.ts            # mock present

# Confirm the NNN_hash naming (3-digit pad + 12-hex slice) is used:
rg -n "padStart\(3, '0'\)" src/core/session-utils.ts                    # ≥2 matches (createSessionDirectory + nextBugfixDir)
rg -n "slice\(0, 12\)" src/core/session-utils.ts                        # ≥3 matches (createSessionDirectory + 2 new helpers)

# Confirm NO mkdir inside nextBugfixDir (read-only):
rg -n "nextBugfixDir" -A 30 src/core/session-utils.ts | rg -n "mkdir"   # EXPECT: no match

# Confirm prp-pipeline.ts was NOT edited (S2/S3 own it):
git diff --name-only
# EXPECT: src/core/session-utils.ts, tests/unit/core/session-utils.test.ts ONLY
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0 (readdir import + helpers compile).
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new branches covered).

### Feature Validation
- [ ] `nextBugfixDir` returns sequence 1 on ENOENT/empty/no-match; max+1 on match.
- [ ] `dir` = `resolve(sessionPath,'bugfix','NNN_<12hex>')` with NNN padStart(3,'0').
- [ ] ENOENT swallowed (→1); non-ENOENT rethrown.
- [ ] `nextBugfixDir` is read-only (no mkdir).
- [ ] `generateBugfixHash(seed)` deterministic; `generateBugfixHash()` random 12-hex.
- [ ] Both helpers have full JSDoc (Mode A) explaining NNN_hash + archive semantics.

### Code Quality Validation
- [ ] Mirrors `SessionManager.__scanSessionDirectories` + `createSessionDirectory` patterns.
- [ ] Uses the regex `/^(\d{3})_/` (not loose `split`).
- [ ] Placed in session-utils.ts (pure-utility layer), NOT prp-pipeline.ts.
- [ ] `readdir` added to both the source import AND the test mock.

### Documentation & Deployment
- [ ] JSDoc on both helpers explains the NNN_hash numbering + that the helper is
      read-only (caller owns mkdir).
- [ ] No prp-pipeline.ts edit (S2/S3 own the wiring).

---

## Anti-Patterns to Avoid
- ❌ Don't **mkdir inside `nextBugfixDir`** — it's read-only (returns a path). S2
  owns creation; making it write would break the ENOENT→first-iteration semantics
  and the unit-testability.
- ❌ Don't use `name.split('_')[0]` to parse the sequence — use the regex
  `/^(\d{3})_/` to mirror `SESSION_DIR_PATTERN` discipline and reject malformed
  entries (stray files like `foo_bar`, or `architecture/`).
- ❌ Don't forget to **add `readdir` to the `node:fs/promises` import** in
  session-utils.ts AND to the `vi.mock('node:fs/promises', …)` block in the test —
  without both, the helper is either uncompilable or hits the real FS in tests.
- ❌ Don't edit `prp-pipeline.ts` — S2 (runQACycle, ~1862) and S3
  (#detectInterruptedBugfix, ~1913) own the wiring. S1 only PROVIDES the primitive.
- ❌ Don't leave ANY branch uncovered (ENOENT, non-ENOENT throw, empty, no-match,
  match, seed-hashed, random-fallback) — `npm run validate` fails on 100% coverage.
- ❌ Don't place the helper in `prp-pipeline.ts` — it's the orchestrator layer;
  the pure numbering primitive belongs in `session-utils.ts` alongside
  `createSessionDirectory`/`hashPRD` (avoids bad layering + S3 import coupling).
- ❌ Don't touch `FixCycleWorkflow` — its `sessionPath.includes('bugfix')` check
  passes unchanged on `bugfix/001_hash/` (architecture doc confirms).
- ❌ Don't mutate `PRD.md`, `tasks.json`, `prd_snapshot.md`, or `vitest.config.ts`.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S1 is a 2-file change (one
pure helper module + its unit tests), every edit site pinned with file:line
anchors, every pattern mirrored from a named canonical exemplar
(`SessionManager.__scanSessionDirectories` for the scan,
`createSessionDirectory` for the `padStart(3,'0')`+`slice(0,12)` naming,
`hashPRDContent` for the hash, `randomBytes` for the uniqueness fallback — all
already present/imported except `readdir`). The correctness rests on eight
pre-proven facts: the `NNN_hash` pattern + `SESSION_DIR_PATTERN` regex, the
canonical scan-and-increment shape (readdir withFileTypes + regex + parseInt +
ENOENT→[]), the `hashPRDContent().slice(0,12)` hash rule, the missing-`readdir`
import gap, the test-mock gap (readdir not in the node:fs/promises mock), the
100%-branch-coverage gate (every branch has a designated test), the read-only
contract (no mkdir), and the file-placement decision (session-utils.ts, not
prp-pipeline.ts). The scope fences are airtight: S1 edits ONLY session-utils.ts +
its test; S2/S3/S4 edit prp-pipeline.ts — zero file overlap. The single notable
risk — the `readdir` mock gap — is explicitly handled (Task 2 step 1 adds it). The
parallel P2.M3.T1.S3 (groundswell test fixtures) edits entirely different test
files (`tests/unit/utils/groundswell-linker.test.ts`, `tests/unit/groundswell/imports.test.ts`)
and NO source — zero overlap with S1.