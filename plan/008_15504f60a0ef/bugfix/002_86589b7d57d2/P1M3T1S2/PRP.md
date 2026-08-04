# PRP — P1.M3.T1.S2: Task-prefix builder + rework `formatCommitMessage` (remove `[PRP Auto]`)

> Bugfix 002, **BUG-003 (MAJOR) — S2 (pure builder + formatter rework)**. PRD §5.1 mandates the
> standardized `<phase>.<milestone>.<task>.<subtask>:` task-prefix with trailing-level elision and a
> `PRP_COMMIT_FORMAT` toggle, and FORBIDS the legacy `[PRP Auto]` banner. Today
> `formatCommitMessage` (`src/utils/git-commit.ts:108-110`) UNCONDITIONALLY returns
> `` `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>` `` — prepending the
> exact banner the PRD forbids. **S1 (P1.M3.T1.S1, COMPLETE)** already shipped the
> `getPrpCommitFormat()` config getter + `PrpCommitFormat` union in `src/config/constants.ts`
> (verified: symbols at lines 705/723/730/760). This item (S2) is the PURE, UNIT-TESTED middle
> slice: it adds `ItemPosition` + `parseItemPosition` + `buildTaskPrefix` and REWORKS
> `formatCommitMessage` to drop `[PRP Auto]`, layer the task-prefix when a position is supplied and
> the format is `task-prefix`, and PRESERVE the `Co-Authored-By` trailer in both modes. The
> architecture contract (`architecture/bug-003-commit-format.md` §"Fix design → S2") prescribes the
> exact exports + semantics; this PRP fuses that spec with the codebase's **`SubtaskSchema` id regex**
> (`src/core/models.ts:~382`), the **`getCommitRetryMax` getter-import style**, and the
> **`vitest` env-stub harness** (`tests/unit/config/*.test.ts`). **S3 (P1.M3.T2.S1)** then threads
> `position` through `smartCommit` + the call sites; **S4 (P1.M3.T1.S3)** relaxes the stagecoach
> agent prompt. Mode A docs: rewrite the `formatCommitMessage` JSDoc (the only doc surface in this
> slice — `CONFIGURATION.md` was S1's).

---

## Goal

**Feature Goal**: In `src/utils/git-commit.ts`, ADD + EXPORT the `ItemPosition` interface, the pure
`parseItemPosition(id)` parser, and the pure `buildTaskPrefix(pos)` builder; and REWORK
`formatCommitMessage` so it (a) NEVER emits the `[PRP Auto]` banner (defense-in-depth strips any
stray `[PRP Auto] ` the caller/LLM may have included), (b) layers the `<phase>.<milestone>.<task>[.<subtask>]:`
task-prefix onto the subject WHEN a `position` is supplied AND `getPrpCommitFormat()==='task-prefix'`,
(c) emits a plain subject otherwise (position absent/null, OR format `==='plain'`), and (d) PRESERVES
the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer (after a blank line) in BOTH modes per
the architecture decision (PRD §5.1 is silent on the trailer; only `[PRP Auto]` is forbidden). The
optional `position?: ItemPosition | null` 2nd param keeps all 3 existing single-arg internal call
sites (`git-commit.ts:508/520/525`) compiling unchanged (backward compatible → they emit plain until
S3 threads a position).

**Deliverable**:
1. **`src/utils/git-commit.ts`** — ADD `export interface ItemPosition { phase; milestone; task; subtask? }`,
   `export function parseItemPosition(id: string): ItemPosition | null`, and
   `export function buildTaskPrefix(pos: ItemPosition): string`; REWORK
   `export function formatCommitMessage(message: string, position?: ItemPosition | null): string`
   (drop `[PRP Auto]`, branch on `getPrpCommitFormat()`, preserve trailer); REWRITE the JSDoc block
   at lines 92–106 (and fix the stale `[PRP Auto]` prose at line 237); IMPORT `getPrpCommitFormat`
   from `'../config/constants.js'`.
2. **`tests/unit/utils/git-commit.test.ts`** — REWRITE the `describe('formatCommitMessage')` block
   (5 old `[PRP Auto]` tests) to the new task-prefix/plain/no-banner contract; ADD
   `describe('parseItemPosition')` and `describe('buildTaskPrefix')` blocks (pure literals); UPDATE
   the ~6 `smartCommit`-level assertions that hardcode `[PRP Auto]` in the expected committed message
   to the new plain output (mechanical in-file fix; these break directly from S2's rework).

**Success Definition**:
- `parseItemPosition('P1.M2.T1.S1')` → `{phase:1,milestone:2,task:1,subtask:1}`;
  `parseItemPosition('P1.M2.T1')` → `{phase:1,milestone:2,task:1}` (no `subtask`);
  `parseItemPosition('garbage'|'P1.M2'|''|'p1.m2.t1.s1')` → `null`.
- `buildTaskPrefix({phase:1,milestone:2,task:1,subtask:1})` → `'1.2.1.1'`;
  `buildTaskPrefix({phase:1,milestone:2,task:1})` → `'1.2.1'` (trailing-level elision).
- `formatCommitMessage('add utility', {phase:1,milestone:2,task:1,subtask:1})` (env unset →
  `task-prefix`) → `'1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'`.
- `formatCommitMessage('add utility', {phase:1,milestone:2,task:1})` with `PRP_COMMIT_FORMAT=plain`
  → `'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'` (plain, position ignored).
- `formatCommitMessage('msg')` (no position) → `'msg\n\nCo-Authored-By: Claude <noreply@anthropic.com>'`
  (plain, no `[PRP Auto]`).
- `formatCommitMessage('[PRP Auto] msg', pos)` → NEVER contains `[PRP Auto]` (defense-in-depth strip).
- The trailer `Co-Authored-By: Claude <noreply@anthropic.com>` is present in EVERY output (both modes).
- Every branch of the 3 new/changed functions is covered (100% global coverage gate).
- `npm run typecheck && npm run lint && npm run format:check` clean; the updated
  `tests/unit/utils/git-commit.test.ts` is GREEN; the S1 sibling
  `tests/unit/config/prp-commit-format.test.ts` stays GREEN (regression).

---

## User Persona (if applicable)

**Target User**: Maintainer / pipeline operator reading the git history (and the coder-agent that
calls `smartCommit`). End users are unaffected (this is an internal commit-message layer).

**Use Case**: Each committed subtask should carry a machine-parseable `<n.n.n[.n]>:` position prefix
(by default) instead of the noisy `[PRP Auto]` banner; operators may opt into a clean hand-curated
history via `PRP_COMMIT_FORMAT=plain`.

**Pain Points Addressed**: The git log is polluted with `[PRP Auto] …` noise PRD §5.1 explicitly tried
to eliminate; there is no machine-parseable task position; there is no opt-out for a clean history.

---

## Why

- **BUG-003 S2: the banner is still unconditionally prepended.** `formatCommitMessage`
  (`git-commit.ts:108-110`) returns `` `[PRP Auto] ${message}…` `` for EVERY commit — the exact banner
  PRD §5.1 forbids. Every `smartCommit` path routes through it (`:508/520/525`). This item removes it
  and installs the §5.1 task-prefix + plain toggle. It is the non-negotiable middle slice between S1
  (config getter — DONE) and S3 (wire `position` through `smartCommit` + call sites).
- **S1 is the input; S3 is the consumer.** S2 consumes `getPrpCommitFormat()` (the SINGLE typed,
  defaulted `process.env` read site) and delivers a pure, fully-tested
  `formatCommitMessage(message, position?)` + the two pure helpers that S3 will call as
  `parseItemPosition(subtask.id)`. Pure functions first = the boundary is trivially unit-testable with
  mocked env + literals, decoupled from `smartCommit`/git/LLM.
- **Co-Authored-By is PRESERVED by design.** PRD §5.1's forbidden-banner statement names `[PRP Auto]`
  and Conventional-Commit SCOPE but is SILENT on the trailer; the §5.1 format spec concerns the SUBJECT
  line, and a trailer is a separate body/footer. Removing the trailer is a separate product concern —
  so BOTH modes keep `Co-Authored-By: Claude <noreply@anthropic.com>` (after a blank line). Only
  `[PRP Auto]` is removed. (Architecture doc + S1 PRP agree.)
- **Defense-in-depth.** The stagecoach agent is instructed (S4 will relax the type/scope rule, but the
  "no `[PRP Auto]`/no trailer" hard rule stays) NOT to emit `[PRP Auto]`. S2 additionally strips a
  leading `[PRP Auto] ` from `message` at format time so a stray banner from any caller/LLM can never
  reach the history. This is belt-and-suspenders, not the primary mechanism.
- **Scope discipline.** This slice touches ONLY `src/utils/git-commit.ts` + its unit test file. It does
  NOT touch `smartCommit`'s signature, the call sites (`task-orchestrator.ts`, `bug-hunt-workflow.ts`),
  `commit-message-agent.ts`, `smart-commit.test.ts`, or `constants.ts`. Disjoint from the parallel
  P1.M2 items and from S3/S4.

---

## What

### User-visible behavior
None directly at runtime yet — `smartCommit` still calls `formatCommitMessage(message)` with ONE arg
(position omitted → plain). So after S2, every auto-commit's subject drops `[PRP Auto]` and becomes the
bare message + trailer (plain mode), until S3 threads a real `position`. The task-prefix subject is
exercised now ONLY at the unit level (`formatCommitMessage(msg, pos)`); it lights up in real commits
once S3 passes `position: parseItemPosition(subtask.id)`.

### Technical requirements (exact contract — VERBATIM from architecture/bug-003-commit-format.md §S2)

In `src/utils/git-commit.ts`:

**(a) Import** `getPrpCommitFormat` (add to the existing `../config/constants.js` import that already
pulls `getCommitRetryMax`/`getCommitRetryDelayMs`/`getCommitRetryDelayCapMs`):

```ts
import {
  getCommitRetryMax,
  getCommitRetryDelayMs,
  getCommitRetryDelayCapMs,
  getPrpCommitFormat,
} from '../config/constants.js';
```

**(b) Add + export** the interface, parser, and builder (place them immediately ABOVE
`formatCommitMessage`, replacing the old `[PRP Auto]`-documenting JSDoc + one-liner):

```ts
/**
 * The 1-indexed hierarchical position of a backlog item, parsed from its id
 * (PRD §5.1 "Commit Message Format (Standardized Task-Prefix)").
 *
 * @remarks
 * `subtask` is OPTIONAL: a Task-level item has no subtask, so its prefix elides
 * the trailing level (`1.2.1`, never `1.2.1.0`). Produced by
 * {@link parseItemPosition}; consumed by {@link buildTaskPrefix} and
 * {@link formatCommitMessage}.
 */
export interface ItemPosition {
  phase: number;
  milestone: number;
  task: number;
  subtask?: number;
}

/**
 * Regex matching a backlog-item id `P{phase}.M{milestone}.T{task}[.S{subtask}]`
 * (PRD §5.1). The `.S{subtask}` segment is OPTIONAL so a Task-level item id
 * (`P1.M2.T1`) parses to a 3-level position (trailing-level elision). Mirrors —
 * and generalizes — the STRICT 4-level {@link SubtaskSchema} id regex
 * (`src/core/models.ts:~382`, `^P\d+\.M\d+\.T\d+\.S\d+$`): runtime Subtask ids
 * are always 4-level, but the prefix builder must also render 3-level positions.
 */
const ITEM_ID_PATTERN = /^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/;

/**
 * Parse a backlog-item id into an {@link ItemPosition} (PRD §5.1).
 *
 * @param id - The item id, e.g. `'P1.M2.T1.S1'` (Subtask) or `'P1.M2.T1'`
 *            (Task-level, no subtask).
 * @returns The parsed position (`subtask` present iff the id had an `.S{n}`
 *          segment), or `null` when `id` does not match
 *          {@link ITEM_ID_PATTERN} (malformed, wrong case, extra segments, …).
 *
 * @example
 * ```ts
 * parseItemPosition('P1.M2.T1.S1'); // { phase:1, milestone:2, task:1, subtask:1 }
 * parseItemPosition('P1.M2.T1');    // { phase:1, milestone:2, task:1 }
 * parseItemPosition('garbage');     // null
 * ```
 */
export function parseItemPosition(id: string): ItemPosition | null {
  const m = ITEM_ID_PATTERN.exec(id);
  if (!m) return null;
  const pos: ItemPosition = {
    phase: Number(m[1]),
    milestone: Number(m[2]),
    task: Number(m[3]),
  };
  if (m[4] !== undefined) {
    pos.subtask = Number(m[4]);
  }
  return pos;
}

/**
 * Render an {@link ItemPosition} as the standardized task-prefix
 * `<phase>.<milestone>.<task>[.<subtask>]` (PRD §5.1).
 *
 * @param pos - The item position.
 * @returns The dotted prefix with trailing unused levels ELIDED:
 *          `{1,2,1,1}` → `'1.2.1.1'`; `{1,2,1}` → `'1.2.1'` (never `'1.2.1.0'`).
 *
 * @example
 * ```ts
 * buildTaskPrefix({ phase:1, milestone:2, task:1, subtask:1 }); // '1.2.1.1'
 * buildTaskPrefix({ phase:1, milestone:2, task:1 });            // '1.2.1'
 * ```
 */
export function buildTaskPrefix(pos: ItemPosition): string {
  const base = `${pos.phase}.${pos.milestone}.${pos.task}`;
  return pos.subtask === undefined ? base : `${base}.${pos.subtask}`;
}
```

**(c) Rework + re-document `formatCommitMessage`** (replaces the lines 92–110 block verbatim):

```ts
/**
 * Format a commit message per PRD §5.1 "Commit Message Format (Standardized
 * Task-Prefix)".
 *
 * @param message - The descriptive commit message (subject). May be a bare
 *                  hand-written message, an LLM-generated summary, or a fallback
 *                  placeholder; any leading `[PRP Auto] ` banner is STRIPPED
 *                  (defense-in-depth).
 * @param position - Optional {@link ItemPosition} for the implementing backlog
 *                   item. When supplied AND {@link getPrpCommitFormat} returns
 *                   `'task-prefix'` (the DEFAULT), the standardized
 *                   `<phase>.<milestone>.<task>[.<subtask>]:` prefix is layered
 *                   onto the subject. When absent/`null`, OR when the format is
 *                   `'plain'`, the subject is emitted verbatim (no prefix).
 * @returns The formatted commit message: `<prefix?><subject>\n\nCo-Authored-By:
 *          Claude <noreply@anthropic.com>`. The `Co-Authored-By` trailer is
 *          PRESERVED in BOTH modes (PRD §5.1 is silent on the trailer; only the
 *          `[PRP Auto]` banner is forbidden).
 *
 * @remarks
 * - NEVER emits the legacy `[PRP Auto]` banner (PRD §5.1 forbids it). A stray
 *   `[PRP Auto] ` the caller/LLM may have included in `message` is stripped as
 *   defense-in-depth.
 * - Non-backlog commits (initial, fallback, scaffolding, cleanup) pass NO
 *   `position` → plain subject (PRD §5.1: "When task-prefix selected but commit
 *   is not a backlog item → degrade to plain").
 * - The trailer is appended after a blank line in both modes (architecture
 *   decision: removing it is a separate product concern).
 *
 * @example
 * ```ts
 * // task-prefix mode (DEFAULT — PRP_COMMIT_FORMAT unset):
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => '1.2.1.1: add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 *
 * // plain mode (PRP_COMMIT_FORMAT=plain) — position ignored:
 * formatCommitMessage('add utility', { phase:1, milestone:2, task:1, subtask:1 });
 * // => 'add utility\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 *
 * // no position (non-backlog) → always plain:
 * formatCommitMessage('cleanup: doc reorganization');
 * // => 'cleanup: doc reorganization\n\nCo-Authored-By: Claude <noreply@anthropic.com>'
 * ```
 */
export function formatCommitMessage(
  message: string,
  position?: ItemPosition | null
): string {
  // Defense-in-depth: strip any stray [PRP Auto] banner the caller/LLM may have
  // included. PRD §5.1 forbids the banner; the stagecoach agent is also told
  // not to emit it, but this guarantees it can never reach the history.
  const subject = message.replace(/^\[PRP Auto\]\s*/, '');
  const withPrefix =
    position && getPrpCommitFormat() === 'task-prefix'
      ? `${buildTaskPrefix(position)}: ${subject}`
      : subject;
  return `${withPrefix}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
}
```

**(d) Fix the stale `[PRP Auto]` prose at `git-commit.ts:237`** (a JSDoc `{@link} formatCommitMessage`
comment that still says "adds `[PRP Auto]` prefix + `Co-Authored-By`"). Reword to "wraps the message
via `formatCommitMessage` (task-prefix or plain per PRP §5.1 + `Co-Authored-By` trailer)" so the file's
own comments stay consistent. (Comment-only; no behavior change.)

### Success Criteria
- [ ] `ItemPosition`, `parseItemPosition`, `buildTaskPrefix` are `export`ed from `src/utils/git-commit.ts`.
- [ ] `formatCommitMessage(message, position?)` signature is live; `position` is OPTIONAL (existing
      single-arg call sites at `:508/520/525` compile unchanged).
- [ ] `formatCommitMessage` NEVER returns a string containing `[PRP Auto]` (verified by an exhaustive
      test across all branches incl. a `[PRP Auto] `-prefixed input).
- [ ] task-prefix branch: `position` present + `getPrpCommitFormat()==='task-prefix'` → subject is
      `<prefix>: <message>`; trailer appended.
- [ ] plain branch: `position` absent/null OR format `==='plain'` → subject is the (stripped) message;
      trailer appended.
- [ ] `Co-Authored-By: Claude <noreply@anthropic.com>` present in EVERY output.
- [ ] `parseItemPosition`: 4-level → `{…,subtask}`; 3-level → `{…}` (no subtask); non-match → `null`.
- [ ] `buildTaskPrefix`: subtask present → `p.m.t.s`; absent → `p.m.t` (elision).
- [ ] `getPrpCommitFormat` imported from `'../config/constants.js'`; NO `process.env` read in
      `git-commit.ts` (single-read-site convention).
- [ ] JSDoc at 92–106 rewritten; stale `[PRP Auto]` prose at `:237` fixed.
- [ ] 100% branch coverage on the 3 functions (global coverage gate).
- [ ] `tests/unit/utils/git-commit.test.ts` GREEN; `tests/unit/config/prp-commit-format.test.ts` GREEN
      (regression); typecheck/lint/format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim source blocks (interface + 2 helpers + reworked fn + JSDoc), the exact line sites (92–110 to
replace; 237 prose to fix; import to extend), the input contract (`getPrpCommitFormat` from S1,
verified present), the exact `[PRP Auto]` test assertions to update (enumerated), the env-stub harness
to copy, the npm scripts, the coverage gate, and the scope boundary (what NOT to touch). See
`research/01-codebase-facts.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative architecture spec (S2 block is verbatim-prescribed)
- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md
  section: "Fix design → S2 — task-prefix builder + formatCommitMessage rework (pure, unit-tested)"
  why: Prescribes the EXACT ItemPosition shape, parseItemPosition regex + null semantics, buildTaskPrefix
       trailing-elision, and the formatCommitMessage task-prefix/plain/non-backlog branching + the
       Co-Authored-By PRESERVE decision.
  critical: The block is specified verbatim — implement it as-is. PRESERVE the trailer in BOTH modes
            (PRD §5.1 silent on it; only [PRP Auto] is forbidden).

# MUST READ — PRD §5.1 (the contract this realizes)
- file: PRD.md
  section: "5.1 Commit Message Format (Standardized Task-Prefix)"
  why: "Format: <phase>.<milestone>.<task>.<subtask>: <message>." "Elide trailing unused levels."
       "[PRP Auto] banner and Conventional-Commit scope MUST NOT be prepended." "Non-task commits
       carry no prefix → degrade to plain." "PRP_COMMIT_FORMAT=task-prefix (DEFAULT) | plain (opt-out)."
  critical: default task-prefix; plain is the opt-out; non-backlog → plain; elide trailing levels.

# THE FILE TO EDIT (source) — replace the 92–110 block + fix :237 prose + extend the constants import
- file: src/utils/git-commit.ts
  why: EDIT — add ItemPosition/parseItemPosition/buildTaskPrefix; rework formatCommitMessage; rewrite JSDoc.
  pattern_import: "the existing `import { getCommitRetryMax, getCommitRetryDelayMs, getCommitRetryDelayCapMs } from '../config/constants.js';` — ADD getPrpCommitFormat to this same import (single import site)."
  pattern_getter: "getCommitRetryMax() (constants.ts:760-area style) — getPrpCommitFormat() is the analog string-getter; call it with NO arg."
  critical: formatCommitMessage's 2nd param MUST be optional (position?: ItemPosition | null) so the 3
            single-arg call sites at :508/:520/:525 compile unchanged. Do NOT add position to SmartCommitOptions
            or thread it through smartCommit — that is S3 (P1.M3.T2.S1).

# THE INPUT CONTRACT (S1 — COMPLETE; verified present) — symbols S2 imports
- file: src/config/constants.ts
  why: READ-ONLY here. getPrpCommitFormat() (line 760) returns PrpCommitFormat ('task-prefix' default |
       'plain' opt-out; case-SENSITIVE; unknown/empty → default). The PrpCommitFormat union (~730) is the
       exhaustive switch surface.
  critical: getPrpCommitFormat() is the SINGLE process.env read site for PRP_COMMIT_FORMAT. S2 calls the
            getter; it NEVER reads process.env directly (single-read-site convention).

# THE id FORMAT parseItemPosition generalizes
- file: src/core/models.ts
  section: "SubtaskSchema id regex" (~line 382: `z.string().regex(/^P\d+\.M\d+\.T\d+\.S\d+$/, …)`)
  why: Runtime Subtask ids are ALWAYS 4-level (P1.M2.T1.S1). parseItemPosition MUST ALSO accept 3-level
       (P1.M2.T1) so a Task-level item renders a 3-level prefix (trailing elision). Hence the optional
       (?:\.S(\d+))? segment.
  critical: Do NOT validate against the strict SubtaskSchema regex — accept the 3-level form too.

# THE TEST FILE TO EDIT — rewrite formatCommitMessage block + add 2 blocks + update smartCommit assertions
- file: tests/unit/utils/git-commit.test.ts
  why: EDIT — S2 owns this file. Rewrite `describe('formatCommitMessage')` to the new contract; ADD
       `describe('parseItemPosition')` + `describe('buildTaskPrefix')`; UPDATE the ~6 smartCommit-level
       assertions that hardcode `[PRP Auto]` in the expected committed message (drop the `[PRP Auto] `
       prefix from each expected string).
  pattern_harness: "copy `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })` + `afterEach(() => { vi.unstubAllEnvs(); })` from tests/unit/config/prp-commit-format.test.ts into the formatCommitMessage describe block (env-branch tests need it; parseItemPosition/buildTaskPrefix tests are pure literals — no env)."
  critical: There are 11 `[PRP Auto]` occurrences in this file. 5 are in the formatCommitMessage block
            (rewrite wholesale); ~6 are smartCommit message assertions (mechanically drop `[PRP Auto] `
            from the expected string). Run the file after editing — every remaining failure is a missed
            `[PRP Auto]` assertion.

# THE SIBLING CONFIG TEST (regression — proves S2's import of getPrpCommitFormat didn't disturb S1)
- file: tests/unit/config/prp-commit-format.test.ts
  why: READ-ONLY regression. Run it GREEN after S2 to prove the getPrpCommitFormat import + S1's getter still work.

# CONSUMER CONTRACT (S3 — P1.M3.T2.S1, do NOT implement; just guarantee the symbols are exported)
- file: src/utils/git-commit.ts (smartCommit) + src/core/task-orchestrator.ts + src/workflows/bug-hunt-workflow.ts
  why: READ-ONLY here. S3 will: extend SmartCommitOptions with `position?: ItemPosition | null`; call
       `formatCommitMessage(msg, position)` at the 3 wrap sites; pass `position: parseItemPosition(subtask.id)`
       from the 2 subtask call sites; omit position at the 2 non-backlog sites. This PRP guarantees the
       exported symbols + signature exist. Do NOT edit smartCommit/call sites here.

# OUT OF SCOPE (hard boundary — DO NOT TOUCH in S2)
- file: src/agents/commit-message-agent.ts                      # S4 (P1.M3.T1.S3) — relax type/scope rule
- file: tests/unit/agents/commit-message-agent.test.ts          # S4 — verifies the AGENT never emits [PRP Auto] (still true)
- file: tests/integration/smart-commit.test.ts                  # S3 (P1.M3.T2.S1) — wires position through smartCommit
- file: src/config/constants.ts                                  # S1 (DONE) — getPrpCommitFormat lives here
- file: docs/CONFIGURATION.md                                    # S1 (DONE) — PRP_COMMIT_FORMAT row already shipped
```

### Current Codebase tree (relevant slice)
```bash
src/config/constants.ts                # READ-ONLY (S1 DONE): getPrpCommitFormat/PrpCommitFormat exported (705/723/730/760)
src/utils/git-commit.ts                # EDIT: +ItemPosition +parseItemPosition +buildTaskPrefix; rework formatCommitMessage; rewrite JSDoc (92-110); fix prose (:237); extend constants import
src/core/models.ts                     # READ-ONLY: SubtaskSchema id regex (~382) — the 4-level form parseItemPosition generalizes
tests/unit/utils/git-commit.test.ts    # EDIT: rewrite formatCommitMessage block; +parseItemPosition/buildTaskPrefix blocks; update ~6 smartCommit [PRP Auto] assertions
tests/unit/config/prp-commit-format.test.ts  # READ-ONLY regression (S1's test)
```

### Desired Codebase tree with files to be added/edited
```bash
src/utils/git-commit.ts                # MODIFIED (interface + 2 helpers + reworked fn + JSDoc + prose fix + import)
tests/unit/utils/git-commit.test.ts    # MODIFIED (rewritten formatCommitMessage block; 2 new blocks; ~6 assertion fixes)
# (no new files; no new deps)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — formatCommitMessage's 2nd param MUST be optional: `position?: ItemPosition | null`.
//   The 3 internal call sites (git-commit.ts:508/520/525) call it with ONE arg. A REQUIRED 2nd param
//   would break compilation. Optional → they compile unchanged and emit PLAIN (position absent → plain)
//   until S3 threads a position. This is the backward-compat hinge.

// CRITICAL — PRESERVE the Co-Authored-By trailer in BOTH modes. PRD §5.1 forbids only [PRP Auto] +
//   Conventional-Commit SCOPE; it is SILENT on the trailer (the §5.1 format spec is the SUBJECT line;
//   a trailer is a body/footer). Architecture decision: keep `Co-Authored-By: Claude <noreply@anthropic.com>`
//   (after a blank line) in task-prefix AND plain. Removing it is a SEPARATE product concern — out of scope.

// CRITICAL — NEVER emit '[PRP Auto]'. (1) Don't prepend it (obviously). (2) STRIP a leading
//   `[PRP Auto] ` from `message` at format time (defense-in-depth: the stagecoach agent is told not to
//   emit it, but a stray banner from any caller/LLM must never reach the history). Use
//   `message.replace(/^\[PRP Auto\]\s*/, '')`. Test this branch explicitly (100% coverage gate).

// CRITICAL — Single-read-site convention: call getPrpCommitFormat() (the getter). Do NOT read
//   process.env.PRP_COMMIT_FORMAT in git-commit.ts. The getter is the ONLY sanctioned read site (S1).

// CRITICAL — 100% GLOBAL coverage (vitest.config.ts). Every branch must be exercised:
//   parseItemPosition: non-match→null / 3-level match / 4-level match.
//   buildTaskPrefix: subtask present / absent.
//   formatCommitMessage: position absent(undef) / position null / position+task-prefix / position+plain /
//                        defense-in-depth [PRP Auto] strip.
//   A missed branch → coverage drop → gate failure.

// GOTCHA — parseItemPosition MUST accept the 3-level form (P1.M2.T1), not just the strict 4-level
//   SubtaskSchema form. The optional `(?:\.S(\d+))?` segment is REQUIRED for trailing-level elision
//   (a Task-level item → 1.2.1, never 1.2.1.0). Runtime Subtask ids are always 4-level, but the prefix
//   builder must also render 3-level. Test both forms.

// GOTCHA — Env-bleed across formatCommitMessage tests. The env-branch cases (task-prefix vs plain) MUST
//   use `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })` + `afterEach(() => { vi.unstubAllEnvs(); })`
//   (copy verbatim from tests/unit/config/prp-commit-format.test.ts). A leftover `vi.stubEnv(PRP_COMMIT_FORMAT,'plain')`
//   from a prior test would flip the NEXT test's task-prefix case to plain. parseItemPosition/buildTaskPrefix
//   are pure literals → no env stubbing.

// GOTCHA — The formatCommitMessage tests share the FILE-WIDE beforeEach in git-commit.test.ts (which does
//   vi.clearAllMocks() + spies process.cwd). Adding a NESTED beforeEach(delete env) + afterEach(unstub)
//   inside the formatCommitMessage describe block is safe (nested hooks run AFTER the outer beforeEach).

// GOTCHA — bugfix BUG-004: the FULL `npm run test:run` is PRE-EXISTING-RED (178 failures — P1.M4 scope).
//   Do NOT use it as the gate. Gate = typecheck + lint + format:check + tests/unit/utils/git-commit.test.ts
//   + the S1 sibling tests/unit/config/prp-commit-format.test.ts (regression).

// GOTCHA — prettier is ERROR-enforced (format:check). The multi-line JSDoc + the new test blocks may
//   reflow; run `npm run fix` (lint:fix + prettier --write) BEFORE format:check. Let the formatter own alignment.

// CRITICAL — DO NOT touch smartCommit's signature, SmartCommitOptions, the call sites
//   (task-orchestrator.ts, bug-hunt-workflow.ts), commit-message-agent.ts, smart-commit.test.ts, or
//   commit-message-agent.test.ts. Those are S3/S4. S2 ships ONLY the pure formatter + builder + parser
//   + this file's tests. The ~6 smartCommit [PRP Auto] assertion fixes in THIS file are the ONLY test
//   edits outside the formatCommitMessage/parseItemPosition/buildTaskPrefix blocks (they break directly
//   from S2's rework and MUST be fixed in-file to keep the gate green).
```

---

## Implementation Blueprint

### Data models and structure
The only "data model" is the `ItemPosition` interface (exported) — the parsed hierarchical position.
`parseItemPosition` produces it; `buildTaskPrefix` + `formatCommitMessage` consume it. No ORM/pydantic
(this is TS). `PrpCommitFormat` (the format union) is imported from S1's `constants.ts`.

### Implementation Tasks (ordered to keep the gate GREEN at each checkpoint)
```yaml
Task 1: EDIT src/utils/git-commit.ts — ADD the pure helpers (NO behavior change yet)
  - EXTEND the existing `../config/constants.js` import: add `getPrpCommitFormat` alongside
    getCommitRetryMax/getCommitRetryDelayMs/getCommitRetryDelayCapMs.
  - INSERT (immediately ABOVE the current formatCommitMessage JSDoc, i.e. above line 92) the new
    `export interface ItemPosition`, the `const ITEM_ID_PATTERN = /^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/;`,
    `export function parseItemPosition`, and `export function buildTaskPrefix` — EXACTLY as specified
    in "Technical requirements (b)" above, each with its full JSDoc.
  - DO NOT yet touch formatCommitMessage. After Task 1 the new symbols exist but are unused; existing
    tests stay GREEN (no behavior change).
  - VERIFY: `npm run typecheck` clean (unused-export warnings are fine — they're consumed in Task 2).

Task 2: EDIT src/utils/git-commit.ts — REWORK formatCommitMessage + rewrite JSDoc (the behavior flip)
  - REPLACE the lines 92–110 block (the old `[PRP Auto]`-documenting JSDoc + the one-liner fn) with the
    reworked `formatCommitMessage(message, position?)` + its new JSDoc — EXACTLY as specified in
    "Technical requirements (c)". Keep the function in the SAME location (above the STAGECOACH header).
  - FIX the stale `[PRP Auto]` prose at line 237 (the `{@link formatCommitMessage}` JSDoc that says
    "adds `[PRP Auto]` prefix + `Co-Authored-By`") → reword to "wraps the message via formatCommitMessage
    (task-prefix or plain per PRD §5.1 + `Co-Authored-By` trailer)".
  - AFTER Task 2: existing formatCommitMessage + smartCommit tests that assert `[PRP Auto]` are now RED
    (EXPECTED — Task 3 fixes them). This is the controlled red window.
  - VERIFY: `npm run typecheck` clean (the 3 single-arg call sites at :508/520/525 still compile —
    position is optional).

Task 3: EDIT tests/unit/utils/git-commit.test.ts — rewrite + add + fix assertions (back to GREEN)
  - STEP 3a — REWRITE `describe('formatCommitMessage')` (currently 5 `[PRP Auto]` tests). Add a NESTED
    `beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; })` + `afterEach(() => { vi.unstubAllEnvs(); })`
    (copy from tests/unit/config/prp-commit-format.test.ts). Cases:
      • no position → plain: formatCommitMessage('msg') === 'msg\n\nCo-Authored-By: Claude <noreply@anthropic.com>'.
      • null position → plain (same expected).
      • position + env UNSET (task-prefix) → `${buildTaskPrefix(pos)}: msg\n\n…trailer`.
        Use a 4-level pos → '1.2.1.1: msg…' AND a 3-level pos → '1.2.1: msg…' (elision).
      • position + vi.stubEnv(PRP_COMMIT_FORMAT,'plain') → plain (position IGNORED).
      • position + vi.stubEnv(PRP_COMMIT_FORMAT,'task-prefix') → task-prefix (explicit default honored).
      • DEFENSE-IN-DEPTH: formatCommitMessage('[PRP Auto] msg', pos) → result must NOT contain '[PRP Auto]'.
      • TRAILER preserved: every result .toContain('Co-Authored-By: Claude <noreply@anthropic.com>').
      • NO [PRP Auto] EVER: across all cases, expect(result).not.toContain('[PRP Auto]').
  - STEP 3b — ADD `describe('parseItemPosition')` (pure literals, NO env):
      • 'P1.M2.T1.S1' → { phase:1, milestone:2, task:1, subtask:1 }.
      • 'P3.M1.T2.S4' → { phase:3, milestone:1, task:2, subtask:4 } (multi-digit).
      • 'P1.M2.T1'    → { phase:1, milestone:2, task:1 } (NO subtask key → toEqual exact, or
        expect(parsed.subtask).toBeUndefined()).
      • 'garbage' | 'P1.M2' | 'P1.M2.T1.S1.X' | '' | 'p1.m2.t1.s1' (lowercase) → null.
  - STEP 3c — ADD `describe('buildTaskPrefix')` (pure literals, NO env):
      • {1,2,1,1} → '1.2.1.1'; {3,1,2,4} → '3.1.2.4'.
      • {1,2,1} (no subtask) → '1.2.1' (ELISION — assert NOT '1.2.1.0').
  - STEP 3d — UPDATE the ~6 smartCommit-level `[PRP Auto]` message assertions (mechanical in-file fix;
    these break from Task 2). Add `parseItemPosition`/`buildTaskPrefix`/re-exported `ItemPosition` to the
    existing import from `../../../src/utils/git-commit.js` if not already present. For each, drop the
    `[PRP Auto] ` prefix from the EXPECTED committed-message string/regex:
      • smartCommit › "should return commit hash on success": gitCommit message → 'Test commit\n\n…trailer'.
      • generateMessage › "happy path": → 'feat(api): add endpoint\n\n…trailer'.
      • generateMessage › "throws after retries → FALLBACK": regex → drop '\[PRP Auto\] ' (keep the
        chore: commit-gen failed… + trailer portions).
      • generateMessage › "BACKWARD COMPAT: no options": → 'Pre-formatted message\n\n…trailer'.
      • generateMessage › "retry: succeeds on 3rd attempt": → 'feat: retry works\n\n…trailer'.
      • generateMessage › "retry: exhausted → FALLBACK": regex already lacks '[PRP Auto]' — leave.
    (Run `grep -n '\[PRP Auto\]' tests/unit/utils/git-commit.test.ts` after editing → expect ZERO hits.)
  - VERIFY: `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (100% coverage on the 3 functions).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix  → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts                                  # the edited file → GREEN.
  - RUN: npx vitest run tests/unit/config/prp-commit-format.test.ts tests/unit/config/commit-retry.test.ts  # S1 + sibling regression → GREEN.
  - DO NOT run the full `npm run test:run` (pre-existing red — BUG-004, P1.M4 scope).
  - EXPECTED: typecheck/lint/format clean; edited file GREEN (new + updated cases); S1 sibling GREEN.
    If typecheck fails → the constants import is malformed or position param is not optional.
    If a formatCommitMessage case fails → check the env stub (case-sensitivity) + that the nested
    beforeEach deleted PRP_COMMIT_FORMAT (bleed from a prior case).
    If coverage drops → a branch (parseItemPosition non-match/3-level/4-level; buildTaskPrefix
    subtask present/absent; formatCommitMessage position absent/null/task-prefix/plain/strip) lacks a test.
```

### Implementation Patterns & Key Details
```ts
// ---- src/utils/git-commit.ts: extend the constants import (Task 1) ----
import {
  getCommitRetryMax,
  getCommitRetryDelayMs,
  getCommitRetryDelayCapMs,
  getPrpCommitFormat, // ← ADD (S1's getter; the SINGLE process.env read site)
} from '../config/constants.js';

// ---- the three pure functions in isolation (the contract) ----
const ITEM_ID_PATTERN = /^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$/;

export function parseItemPosition(id: string): ItemPosition | null {
  const m = ITEM_ID_PATTERN.exec(id);
  if (!m) return null;                       // branch A: non-match → null
  const pos: ItemPosition = {
    phase: Number(m[1]),
    milestone: Number(m[2]),
    task: Number(m[3]),
  };
  if (m[4] !== undefined) pos.subtask = Number(m[4]); // branch B/C: 4-level vs 3-level
  return pos;
}

export function buildTaskPrefix(pos: ItemPosition): string {
  const base = `${pos.phase}.${pos.milestone}.${pos.task}`;
  return pos.subtask === undefined ? base : `${base}.${pos.subtask}`; // elision branch
}

export function formatCommitMessage(
  message: string,
  position?: ItemPosition | null
): string {
  const subject = message.replace(/^\[PRP Auto\]\s*/, ''); // defense-in-depth strip
  const withPrefix =
    position && getPrpCommitFormat() === 'task-prefix'      // branch: task-prefix vs plain
      ? `${buildTaskPrefix(position)}: ${subject}`
      : subject;
  return `${withPrefix}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`; // trailer ALWAYS
}

// ---- tests/unit/utils/git-commit.test.ts: the env-stub harness for formatCommitMessage ----
describe('formatCommitMessage', () => {
  beforeEach(() => { delete process.env.PRP_COMMIT_FORMAT; }); // nested hook (runs after outer beforeEach)
  afterEach(() => { vi.unstubAllEnvs(); });
  // …cases per Task 3a…
});
// parseItemPosition / buildTaskPrefix describes: pure literals, NO beforeEach/afterEach env hooks.

// ---- the smartCommit assertion fix (Task 3d) — before → after ----
// BEFORE: expect(mockGitCommit).toHaveBeenCalledWith({
//   path: '/project', message: '[PRP Auto] Test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
// });
// AFTER:  expect(mockGitCommit).toHaveBeenCalledWith({
//   path: '/project', message: 'Test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
// });
```

### Integration Points
```yaml
GIT-COMMIT.TS (src/utils/git-commit.ts):
  - +export ItemPosition; +export parseItemPosition; +export buildTaskPrefix.
  - REWORK formatCommitMessage(message, position?: ItemPosition | null) — drop [PRP Auto], branch on
    getPrpCommitFormat(), preserve trailer, defense-in-depth strip.
  - +import getPrpCommitFormat (extend the existing ../config/constants.js import).
  - REWRITE JSDoc 92–106; FIX stale [PRP Auto] prose at :237.
  - PRESERVE: the 3 internal call sites (:508/520/525) UNCHANGED (single-arg → plain until S3); all other
    functions (smartCommit, generateCommitMessage, buildFallbackCommitMessage, restore_critical_files,
    filterProtectedFiles) UNTOUCHED.

CONSTANTS.TS (src/config/constants.ts):
  - NO CHANGE (S1 DONE). getPrpCommitFormat/PrpCommitFormat/PRP_COMMIT_FORMAT/DEFAULT_PRP_COMMIT_FORMAT
    are consumed read-only.

TESTS (tests/unit/utils/git-commit.test.ts):
  - REWRITE describe('formatCommitMessage') (+ nested env hooks); ADD describe('parseItemPosition') +
    describe('buildTaskPrefix'); UPDATE ~6 smartCommit [PRP Auto] message assertions.
  - PRESERVE: all non-[PRP Auto] tests (filterProtectedFiles, restore_critical_files, generateCommitMessage,
    buildFallbackCommitMessage, smartCommit error/edge/logging tests) UNTOUCHED.

DOWNSTREAM (S3 — P1.M3.T2.S1, NOT this item):
  - smartCommit will gain `position?: ItemPosition | null` in SmartCommitOptions; the 3 wrap sites will
    call formatCommitMessage(msg, position); call sites pass parseItemPosition(subtask.id) or omit.
  - This PRP guarantees the exported symbols + the optional-position signature exist.

OUT OF SCOPE (hard boundary):
  - smartCommit signature / SmartCommitOptions / call sites (S3), commit-message-agent.ts (S4),
    smart-commit.test.ts (S3), commit-message-agent.test.ts (S4), constants.ts (S1), CONFIGURATION.md (S1).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the JSDoc + test blocks may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failures:
#   - typecheck error if the constants import is malformed, or position is NOT optional (breaks :508/520/525),
#     or ItemPosition is referenced before export.
#   - lint error if an unused import/param slips in.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The EDITED file — MUST be GREEN (rewritten formatCommitMessage block + 2 new blocks + ~6 assertion fixes):
npx vitest run tests/unit/utils/git-commit.test.ts
# S1 + sibling regression (proves importing getPrpCommitFormat didn't disturb constants.ts):
npx vitest run tests/unit/config/prp-commit-format.test.ts tests/unit/config/commit-retry.test.ts
# Expected: all green, 100% coverage on src/utils/git-commit.ts (the global gate covers the 3 new/changed fns).
#   If the edited file fails → (a) a [PRP Auto] assertion was missed (grep should now be 0 in this file);
#   (b) an env-branch case flipped by bleed (add/confirm the nested beforeEach delete + afterEach unstub);
#   (c) coverage drop → a branch lacks a test (see Known Gotchas for the exhaustive branch list).
# Do NOT run the full `npm run test:run` — pre-existing red (BUG-004, P1.M4 scope).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the 3 new exports + the reworked signature landed:
grep -n "export interface ItemPosition" src/utils/git-commit.ts          # 1 hit
grep -n "export function parseItemPosition" src/utils/git-commit.ts      # 1 hit
grep -n "export function buildTaskPrefix" src/utils/git-commit.ts        # 1 hit
grep -n "export function formatCommitMessage" src/utils/git-commit.ts    # 1 hit (signature has position?)
grep -n "getPrpCommitFormat" src/utils/git-commit.ts                     # import + 1 call site (the branch)
# Confirm NO [PRP Auto] is EMITTED (defense-in-depth) and NO stray banner literal remains in the fn:
grep -n "\[PRP Auto\]" src/utils/git-commit.ts | grep -v "replace(/\^\[PRP Auto\]"   # only the strip regex may mention it
# Confirm the single-arg call sites STILL compile (position optional) + are unchanged:
grep -n "formatCommitMessage(" src/utils/git-commit.ts                   # 4 hits: 1 def + 3 calls (all single-arg)
# Confirm the test file no longer asserts [PRP Auto] (all 11 updated):
grep -c "\[PRP Auto\]" tests/unit/utils/git-commit.test.ts               # expect 0 (the defense-in-depth INPUT may
#   still mention it as a test input string — if so, that's fine: it's an INPUT, not an expected output)
# Confirm NO process.env read leaked into git-commit.ts (single-read-site convention):
grep -n "process.env" src/utils/git-commit.ts | grep -i "PRP_COMMIT"     # expect ZERO (getPrpCommitFormat owns it)
# Build emits dist/ cleanly (proves the exports + types compile):
npx tsc -p tsconfig.build.json
# Expected: all greps return the expected hit counts; build clean; no stray [PRP Auto] output; no env leak.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP/LLM (pure string functions). Domain checks (record in commit message):
#   1. [PRP Auto] is GONE from every output path — verified by the "no [PRP Auto] EVER" assertion across
#      all formatCommitMessage branches + the defense-in-depth strip test (input starts with [PRP Auto] →
#      output has none).
#   2. task-prefix is the DEFAULT (env unset → getPrpCommitFormat()==='task-prefix'); plain is the opt-out
#      (PRP_COMMIT_FORMAT=plain). Non-backlog (no position) → always plain (PRD §5.1 degrade-to-plain).
#   3. Trailing-level ELISION works: 4-level → 'p.m.t.s'; 3-level → 'p.m.t' (never 'p.m.t.0').
#   4. Co-Authored-By trailer PRESERVED in BOTH modes (architecture decision; PRD §5.1 silent on trailer).
#   5. Backward compat: the 3 single-arg smartCommit call sites compile + emit plain (no [PRP Auto]) until
#      S3 threads a position — no caller breakage.
#   6. Single-read-site convention preserved: getPrpCommitFormat() is the only PRP_COMMIT_FORMAT read.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (100% coverage on the 3 fns).
- [ ] `npx vitest run tests/unit/config/prp-commit-format.test.ts tests/unit/config/commit-retry.test.ts` GREEN (regression).

### Feature Validation
- [ ] `ItemPosition`, `parseItemPosition`, `buildTaskPrefix` exported from `src/utils/git-commit.ts`.
- [ ] `formatCommitMessage(message, position?)` live; `position` OPTIONAL.
- [ ] task-prefix branch: position + `task-prefix` → `<prefix>: <msg>` + trailer.
- [ ] plain branch: no/null position OR `plain` → bare msg + trailer.
- [ ] `[PRP Auto]` NEVER in output (incl. defense-in-depth strip of a `[PRP Auto] `-prefixed input).
- [ ] `Co-Authored-By: Claude <noreply@anthropic.com>` present in EVERY output.
- [ ] `parseItemPosition`: 4-level / 3-level / non-match(null) all covered.
- [ ] `buildTaskPrefix`: subtask present (`p.m.t.s`) / absent (`p.m.t` elision) both covered.
- [ ] JSDoc 92–106 rewritten; stale `[PRP Auto]` prose at `:237` fixed.

### Code Quality Validation
- [ ] JSDoc on ItemPosition / parseItemPosition / buildTaskPrefix / formatCommitMessage (summary +
      `@remarks` citing §5.1 + `@example`; parser/builder add `@returns`; formatter documents both modes).
- [ ] `position` param is OPTIONAL (`position?: ItemPosition | null`) — 3 single-arg call sites unchanged.
- [ ] `getPrpCommitFormat()` called (no direct `process.env` read in git-commit.ts).
- [ ] Only `src/utils/git-commit.ts` + `tests/unit/utils/git-commit.test.ts` touched.
- [ ] Existing non-`[PRP Auto]` tests UNTOUCHED; S1 sibling config tests stay GREEN.
- [ ] Test file mirrors the codebase env-stub harness (`beforeEach(delete) + afterEach(unstub)`) for env branches.

### Documentation & Deployment
- [ ] Mode A: the `formatCommitMessage` JSDoc rewrite is the doc artifact (rides with the work).
- [ ] The `@remarks` documents the PRESERVE-trailer decision + the defense-in-depth strip + the
      degrade-to-plain-for-non-backlog rule.
- [ ] Commit message records: BUG-003 S2; the verbatim block source (architecture/bug-003 §S2); the
      SubtaskSchema-id generalization (3-level + 4-level); the Co-Authored-By PRESERVE decision; the
      defense-in-depth strip; the optional-position backward-compat hinge; the S3 consumer contract
      (smartCommit will thread position); the in-file `[PRP Auto]` test-assertion fixes.

---

## Anti-Patterns to Avoid

- ❌ Don't make `position` REQUIRED. The 3 internal call sites (`:508/520/525`) call `formatCommitMessage`
      with ONE arg; a required 2nd param breaks compilation. Optional (`position?: ItemPosition | null`)
      is the backward-compat hinge — they compile unchanged and emit plain until S3.
- ❌ Don't drop the `Co-Authored-By` trailer. PRD §5.1 forbids only `[PRP Auto]` + Conventional-Commit
      SCOPE; it is SILENT on the trailer. Architecture decision: PRESERVE it in BOTH modes. Removing it
      is a separate product concern — out of scope.
- ❌ Don't emit `[PRP Auto]` — and don't forget the DEFENSE-IN-DEPTH strip. The stagecoach agent is told
      not to emit the banner, but a stray `[PRP Auto] ` from any caller/LLM must never reach the history.
      `message.replace(/^\[PRP Auto\]\s*/, '')`. Test the branch (coverage gate).
- ❌ Don't read `process.env.PRP_COMMIT_FORMAT` in git-commit.ts. Call `getPrpCommitFormat()` (S1's getter,
      the SINGLE read site). Direct env reads violate the single-read-site convention.
- ❌ Don't use the STRICT `SubtaskSchema` id regex (`^P\d+\.M\d+\.T\d+\.S\d+$`) in `parseItemPosition`.
      It rejects the 3-level Task-level form (`P1.M2.T1`), breaking trailing-level elision. Use the
      GENERALIZED `^P(\d+)\.M(\d+)\.T(\d+)(?:\.S(\d+))?$` (optional `.S` segment).
- ❌ Don't emit `'1.2.1.0'` for a 3-level position. `buildTaskPrefix` ELIDES the absent trailing level:
      `{1,2,1}` → `'1.2.1'`. Guard with `pos.subtask === undefined`.
- ❌ Don't forget the nested `beforeEach(delete process.env.PRP_COMMIT_FORMAT)` + `afterEach(vi.unstubAllEnvs())`
      in the `formatCommitMessage` describe block. A leftover `vi.stubEnv(PRP_COMMIT_FORMAT,'plain')` would
      bleed into the next case and flip a task-prefix assertion to plain. Copy the harness from
      `tests/unit/config/prp-commit-format.test.ts`.
- ❌ Don't miss a `[PRP Auto]` test assertion. There are ~11 in `git-commit.test.ts`; ~6 are smartCommit
      message assertions that break mechanically from the rework. After editing, run
      `grep -n '\[PRP Auto\]' tests/unit/utils/git-commit.test.ts` — only the defense-in-depth INPUT string
      may remain (it's an input, not an expected output). Every remaining test failure is a missed assertion.
- ❌ Don't run the full `npm run test:run` as the gate — it's pre-existing red (BUG-004, 178 failures,
      P1.M4 scope). Gate = typecheck + lint + format:check + the edited file + the S1 sibling config tests.
- ❌ Don't touch `smartCommit`'s signature / `SmartCommitOptions`, the call sites
      (`task-orchestrator.ts`, `bug-hunt-workflow.ts`), `commit-message-agent.ts`, `smart-commit.test.ts`,
      `commit-message-agent.test.ts`, `constants.ts`, or `CONFIGURATION.md`. Those are S3/S4/S1. S2 ships
      ONLY the pure formatter + builder + parser + THIS file's tests.
- ❌ Don't add the stagecoach-prompt relaxation. S4 (P1.M3.T1.S3) changes `commit-message-agent.ts` to
      emit a plain descriptive imperative summary (no Conventional-Commit type/scope). S2 only changes
      `formatCommitMessage` — the agent still returns a bare message that S2 wraps.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, PURE slice. The three functions are prescribed **verbatim**
by the architecture doc (`architecture/bug-003-commit-format.md` §S2); the input contract (`getPrpCommitFormat`
from S1) is **already merged and verified present** in `constants.ts` (lines 705/723/730/760); the
`SubtaskSchema` id regex (`models.ts:~382`) is read and the generalization to 3-level is explained; the
exact edit sites (replace 92–110; fix prose at 237; extend the constants import) are verified against the
working tree; the 11 `[PRP Auto]` test occurrences are enumerated with per-assertion update instructions;
and the env-stub harness is copied verbatim from a sibling config test. The non-obvious risks are all
enumerated and mitigated: (a) `position` MUST be optional (else the 3 single-arg call sites break — a
deterministic typecheck failure caught at Level 1); (b) PRESERVE the trailer in both modes (architecture
decision; PRD §5.1 silent); (c) the defense-in-depth `[PRP Auto] ` strip (tested branch); (d) the 3-level
elision (generalized regex, not the strict SubtaskSchema one); (e) env-bleed across formatCommitMessage
cases (nested beforeEach/afterEach harness); (f) 100% coverage gate (exhaustive branch list provided);
(g) the pre-existing-red full suite (gated to the targeted files). No runtime/network/LLM/git unknowns —
three pure synchronous string functions + JSDoc + test edits. Residual risks: a prettier reflow of the
JSDoc/test blocks (auto-fixed via `npm run fix`) and ensuring every `[PRP Auto]` assertion is updated (the
Level-3 grep confirms 0 remaining expected-output occurrences). The S3 consumer contract is locked: this
item guarantees exported, typed `ItemPosition`/`parseItemPosition`/`buildTaskPrefix` + an optional-position
`formatCommitMessage` that S3 threads through `smartCommit`.