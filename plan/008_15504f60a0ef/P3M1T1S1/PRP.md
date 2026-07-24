# PRP — P3.M1.T1.S1: Add RESEARCH_DEPTH and PARALLEL_RESEARCH config constants

---

## Goal

**Feature Goal**: Add the **foundational configuration layer** for depth-chained
parallel research — three new constants/helpers in `src/config/constants.ts`
(`DEFAULT_RESEARCH_DEPTH`, `getResearchDepth()`, `PARALLEL_RESEARCH`,
`isParallelResearch()`), change `DEFAULT_RESEARCH_TIMEOUT_SECONDS` from `300` to
`1800` (PRD §4.2/§9.2.2), and expose two new global CLI flags
(`-r/--parallel-research`, `--research-depth <n>`) in `src/cli/index.ts`. This is
**config-only**: it defines and parses the knobs but wires them into NO logic —
that is the job of downstream siblings S2 (supervisor), S3 (docs polish), S4
(bugfix forwarding).

**Deliverable**:
1. **`src/config/constants.ts`** — MODIFY, under the existing
   `// Resilience Tuning (PRD §4.2, §4.5, §9.2.2)` section:
   - **CHANGE** `DEFAULT_RESEARCH_TIMEOUT_SECONDS` from `300` → `1800` AND update
     its JSDoc (`@remarks` 5min→30min; `@example` `// 300` → `// 1800`).
   - **ADD** `DEFAULT_RESEARCH_DEPTH = 2` + `getResearchDepth()` (mirror the
     `ISSUE_RETRY_MAX` int-validation pattern exactly).
   - **ADD** `PARALLEL_RESEARCH` (env-var name string) + `isParallelResearch()`
     boolean helper (default `false`; parse with EXACT `'true'` string match, the
     `execution-guard.ts` `SKIP_BUG_FINDING === 'true'` convention).
2. **`src/cli/index.ts`** — MODIFY:
   - **ADD** two `CLIArgs` interface fields: `parallelResearch?: boolean;` and
     `researchDepth?: number | string;`.
   - **ADD** two `program.option(...)` registrations (global, no-subcommand):
     `-r, --parallel-research` (boolean, default `false`) and
     `--research-depth <n>` (env-backed default `process.env.RESEARCH_DEPTH ?? '2'`).
   - **ADD** a depth-validation/coercion block mirroring the existing
     `--research-concurrency` block (coerce to number, `>= 1`, else
     `logger().error(...) + process.exit(1)`).
3. **`.env.example`** — ADD (Mode A): commented `# PARALLEL_RESEARCH=true` and
   `# RESEARCH_DEPTH=2` and `# RESEARCH_TIMEOUT=1800` lines in a
   `# RESEARCH CONFIGURATION` area near `RESEARCH_QUEUE_CONCURRENCY` (≈line 96).
4. **`docs/CONFIGURATION.md`** — ADD (Mode A): `PARALLEL_RESEARCH` and
   `RESEARCH_DEPTH` rows to the **Resilience Tuning** table; update the existing
   `RESEARCH_TIMEOUT` row's Default `300`→`1800`.
5. **`tests/unit/config/constants.test.ts`** — ADD: tests locking the new
   constants/helpers (name strings, defaults, getter unset-path) — pure &
   deterministic (no env mutation), driving 100% branch coverage on the new code.
6. **`tests/unit/cli/index.test.ts`** — ADD: tests asserting the new flags parse
   (default values when absent; `-r` sets boolean true; `--research-depth 3`
   coerces to number; invalid `--research-depth 0` exits 1) — driving 100% branch
   coverage on the new CLI branches.

**Success Definition**:
- `getResearchDepth()` returns `2` when `RESEARCH_DEPTH` is unset.
- `isParallelResearch()` returns `false` when `PARALLEL_RESEARCH` is unset (and
  when set to anything other than the literal `'true'`).
- `DEFAULT_RESEARCH_TIMEOUT_SECONDS === 1800` and its JSDoc says 30min/1800.
- `parseCLIArgs()` accepts `-r` and `--research-depth <n>`; defaults are `false`
  and `2`; invalid depth (`0`, negative, non-numeric) → `process.exit(1)`.
- `.env.example` and `docs/CONFIGURATION.md` document all three knobs with the
  correct defaults.
- `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## User Persona (if applicable)

**Target User**: Pipeline operator / developer tuning background research.
**Use Case**: Operator wants background (parallel) PRP research that prefetches a
chain of items ahead instead of one, to keep the implementation slot fed. They
set `PARALLEL_RESEARCH=true` and `RESEARCH_DEPTH=3` (or pass `-r
--research-depth 3`) and the pipeline reads these constants.
**User Journey**: Set env vars (or CLI flags) → pipeline reads them via the new
helpers → downstream supervisor (S2) consumes them.
**Pain Points Addressed**: No `RESEARCH_DEPTH` constant exists; `PARALLEL_RESEARCH`
env var has no helper; `RESEARCH_TIMEOUT` default of 300s is too short (PRD §4.2
mandates 30min/1800s) — a genuinely-long research gets abandoned prematurely.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) specifies `RESEARCH_DEPTH` (default 2) and
  `PARALLEL_RESEARCH` (CLI `-r`/`--parallel-research`, default false); §9.2.2
  (h4.1) lists both as Required Environment Variables with `RESEARCH_TIMEOUT`
  default 1800s. §4.4 mandates `PARALLEL_RESEARCH` + `RESEARCH_DEPTH` MUST be
  forwarded to the bugfix sub-pipeline (S4's job; S1 only provides the constants).
- **Foundational**: item 2 INPUT explicitly states "No prior subtask output
  consumed (config constants are foundational)." item 4 OUTPUT: "Consumed by
  P3.M1.T1.S2, P3.M1.T1.S3, P3.M1.T1.S4." S1 is the prerequisite layer.
- **Resilience**: The 300s→1800s change (item 3c) prevents premature abandonment
  of legitimate long research (PRD §4.2 "tolerates legitimately long research").

### Out of scope (hard fences)
- **ResearchQueue / supervisor logic** → S2. S1 defines constants ONLY; it wires
  them into NO behavioral code path.
- **Bugfix sub-pipeline forwarding** → S4.
- **PRD.md / tasks.json / prd_snapshot.md / vitest.config.ts** → READ-ONLY.
- **Any consumer** of these constants (research-queue.ts, task-orchestrator.ts,
  retry.ts, prp-pipeline.ts) → DO NOT touch. S1 is additive config.
- **Other CLI options / subcommands / the return-type union** → UNCHANGED.

---

## What

### User-visible behavior
Two new CLI flags and two new env vars become available and parseable:

```bash
# Enable background parallel research (default false)
prd -r                     # OR:  prd --parallel-research
PARALLEL_RESEARCH=true prd # equivalent via env

# Set how many items ahead to prefetch (default 2, must be >= 1)
prd --research-depth 3            # OR:  prd --research-depth=3
RESEARCH_DEPTH=3 prd              # equivalent via env

# Background research deadline (default 1800s / 30min — was 300s)
RESEARCH_TIMEOUT=1800 prd
```

### Technical requirements (exact contract — item 3)

**(a) `DEFAULT_RESEARCH_DEPTH` + `getResearchDepth()` (constants.ts).** Mirror the
`ISSUE_RETRY_MAX` int-validation block EXACTLY (same shape, same JSDoc style):
name constant → default constant → getter that does `Number(env ?? default)` and
falls back on `NaN` or `<= 0`.

```ts
/**
 * Environment variable name: how many items ahead the background research
 * supervisor prefetches as a chain (PRD §4.2, §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via getResearchDepth()) is a
 * positive integer. This constant is the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { RESEARCH_DEPTH } from './config/constants.js';
 *
 * console.log(RESEARCH_DEPTH); // 'RESEARCH_DEPTH'
 * console.log(process.env[RESEARCH_DEPTH]); // e.g. '3'
 * ```
 */
export const RESEARCH_DEPTH = 'RESEARCH_DEPTH';

/**
 * Default prefetch chain depth (PRD §4.2).
 *
 * @remarks
 * When the RESEARCH_DEPTH env var is unset or invalid, this value is used.
 *
 * @example
 * ```ts
 * import { DEFAULT_RESEARCH_DEPTH } from './config/constants.js';
 *
 * console.log(DEFAULT_RESEARCH_DEPTH); // 2
 * ```
 */
export const DEFAULT_RESEARCH_DEPTH = 2;

/**
 * Read & validate the RESEARCH_DEPTH env var (PRD §4.2, §9.2.2).
 *
 * @returns The configured prefetch depth, or DEFAULT_RESEARCH_DEPTH
 *          when unset, non-numeric, or non-positive.
 *
 * @example
 * ```ts
 * import { getResearchDepth } from './config/constants.js';
 *
 * const depth = getResearchDepth(); // 2 (default)
 * ```
 */
export function getResearchDepth(): number {
  const raw = Number(process.env[RESEARCH_DEPTH] ?? DEFAULT_RESEARCH_DEPTH);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_DEPTH;
  }
  return raw;
}
```

**(b) `PARALLEL_RESEARCH` + `isParallelResearch()` (constants.ts).** Boolean env
var, default `false`. There is NO existing boolean env-var helper in
constants.ts; use EXACT `'true'` string match — the convention established by
`execution-guard.ts:68` (`process.env.SKIP_BUG_FINDING === 'true'`).

```ts
/**
 * Environment variable name: enable background (parallel) PRP research (PRD §4.2, §9.2.2).
 *
 * @remarks
 * The VALUE of this variable (read at runtime via isParallelResearch()) is the
 * case-sensitive literal 'true' to enable; any other value (including unset)
 * means disabled. This matches the SKIP_BUG_FINDING convention. This constant is
 * the env-var NAME itself.
 *
 * @example
 * ```ts
 * import { PARALLEL_RESEARCH } from './config/constants.js';
 *
 * console.log(PARALLEL_RESEARCH); // 'PARALLEL_RESEARCH'
 * console.log(process.env[PARALLEL_RESEARCH]); // e.g. 'true'
 * ```
 */
export const PARALLEL_RESEARCH = 'PARALLEL_RESEARCH';

/**
 * Whether background (parallel) PRP research is enabled (PRD §4.2, §9.2.2).
 *
 * @returns true only when PARALLEL_RESEARCH is the literal 'true'; false otherwise.
 *
 * @example
 * ```ts
 * import { isParallelResearch } from './config/constants.js';
 *
 * const enabled = isParallelResearch(); // false (default)
 * ```
 */
export function isParallelResearch(): boolean {
  return process.env[PARALLEL_RESEARCH] === 'true';
}
```

**(c) Change `DEFAULT_RESEARCH_TIMEOUT_SECONDS` 300 → 1800 (constants.ts:249).**
Edit the literal AND its JSDoc so the doc stays truthful:
- `@remarks` line ≈237: `Default deadline (300s = 5min) …` →
  `Default deadline (1800s = 30min) …`.
- `@example` line ≈246: `console.log(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300`
  → `// 1800`.
- The literal: `export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;` → `1800;`.
- `getResearchTimeoutSeconds()` body is UNCHANGED (it already references the
  constant by name, so the new default flows through automatically).

**(d) CLI flags (cli/index.ts).** Add to the `CLIArgs` interface (≈lines 62-141):
```ts
  /** Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH) */
  parallelResearch?: boolean;

  /** How many items ahead to prefetch (default: 2, env: RESEARCH_DEPTH) - may be string from commander */
  researchDepth?: number | string;
```
Add two `program.option(...)` registrations in the global-options chain
(≈lines 290-356, near `--research-concurrency` at ≈309):
```ts
    .option(
      '-r, --parallel-research',
      'Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH)',
      false
    )
    .option(
      '--research-depth <n>',
      'How many items ahead the background research supervisor prefetches (default: 2, env: RESEARCH_DEPTH)',
      process.env.RESEARCH_DEPTH ?? '2'
    )
```
Add a depth-validation/coercion block in the validation region (≈lines 760-810,
IMMEDIATELY after the `--research-concurrency` validation block), mirroring it
exactly:
```ts
  // Validate research-depth (must be a positive integer)
  const researchDepthStr =
    typeof options.researchDepth === 'string'
      ? options.researchDepth
      : String(options.researchDepth);
  const researchDepth = parseInt(researchDepthStr, 10);

  if (isNaN(researchDepth) || researchDepth < 1) {
    logger().error('--research-depth must be a positive integer');
    process.exit(1);
  }

  // Store validated number value
  options.researchDepth = researchDepth;
```
The `-r/--parallel-research` boolean needs NO validation block (commander sets it
to `true`/`false` directly).

**(e) Docs [Mode A].** In `.env.example`, add a `# RESEARCH CONFIGURATION` block
near the `# CONCURRENCY CONFIGURATION` section (≈line 88), with commented lines
for all three knobs. In `docs/CONFIGURATION.md`, in the **Resilience Tuning**
table (≈lines 148-153), UPDATE the `RESEARCH_TIMEOUT` row Default `300`→`1800`
and ADD `PARALLEL_RESEARCH` and `RESEARCH_DEPTH` rows. Use PRD §9.2.2 wording.

### Success Criteria
- [ ] `getResearchDepth()` returns `2` (unset env); `5` when `RESEARCH_DEPTH=5`;
      falls back to `2` on `'abc'` / `'0'` / `'-1'`.
- [ ] `isParallelResearch()` returns `false` (unset env, or any non-`'true'`);
      `true` only when `PARALLEL_RESEARCH === 'true'`.
- [ ] `DEFAULT_RESEARCH_TIMEOUT_SECONDS === 1800`; JSDoc updated (30min/1800).
- [ ] `parseCLIArgs()` accepts `-r` (`parallelResearch === true`) and
      `--research-depth <n>` (coerced to number, `>= 1`); defaults `false`/`2`.
- [ ] Invalid `--research-depth 0` (or `-1`, or `abc`) → exits 1 with a clear
      error.
- [ ] `.env.example` has the three commented knobs; `docs/CONFIGURATION.md`
      Resilience Tuning table has all three rows with correct defaults.
- [ ] `npm run validate` GREEN; 100% coverage on `src/**/*.ts` preserved.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** This is a config-layer change across 6 files (2 source, 2 docs, 2 tests).
Its correctness hinges on seven pre-proven facts, all pinned with file:line
anchors below: (1) the **3-part env-var pattern** (name const → default const →
getter) used by `RESEARCH_TIMEOUT` (constants.ts:219-271) and `ISSUE_RETRY_MAX`
(constants.ts:274-326) — the new `RESEARCH_DEPTH` mirrors `ISSUE_RETRY_MAX`
exactly; (2) the **boolean parsing convention** — no boolean env helper exists in
constants.ts, but `execution-guard.ts:68` establishes the EXACT `'true'` string
match (`SKIP_BUG_FINDING === 'true'`); (3) the **300→1800 site** is
`DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300` at constants.ts:249 with JSDoc at
≈237/246 that ALSO mention 300 (both must be updated); (4) the **CLI flag
shapes** — boolean-default-false (`--no-cache`/`--continue-on-error`,
cli/index.ts:290-291) and env-backed-number (`--research-concurrency`,
cli/index.ts:309-313); (5) the **number-coercion validation block** to mirror
(`--research-concurrency` at ≈766-787, which itself mirrors `--parallelism`); (6)
the **CLIArgs/ValidatedCLIArgs** interface shapes (cli/index.ts:62-172) where the
two new fields go; (7) **100% branch coverage** is enforced — every new branch
(constant, getter fallback, CLI validation `exit(1)`) MUST be driven by a test.

### Documentation & References
```yaml
# MUST READ — the PRD spec (already provided in selected_prd_content)
- docfile: PRD.md
  section: "4.2 The Execution Loop (Parallel Research, Deadline & Fallback)" (h3.4)
       + "9.2.2 Required Environment Variables" (h4.1)
  why: §4.2 defines RESEARCH_DEPTH (default 2), PARALLEL_RESEARCH (CLI -r/--parallel-research,
       default false), RESEARCH_TIMEOUT (default 30min/1800s); §9.2.2 enumerates all three as
       Required Environment Variables with exact descriptions.
  critical: RESEARCH_TIMEOUT default is 1800s (30 min), NOT 300s — the current code (300) is
            the bug S1 fixes. PARALLEL_RESEARCH + RESEARCH_DEPTH MUST be forwardable to the
            bugfix child (§4.4) — that wiring is S4, but S1 must NAME them so S4 can reference.

# MUST READ — this subtask's research (proven facts about the working tree)
- docfile: plan/008_15504f60a0ef/P3M1T1S1/research/s1-codebase-analysis.md
  section: §1 (env-var 3-part pattern + mirror exemplars), §2 (300→1800 sites),
       §3 (CLI flag shapes), §4 (CLIArgs/union), §5 (test pattern), §6 (docs seams),
       §7 (scope fences + S3 overlap resolution), §8 (validation commands)
  why: Proves every edit site, the boolean-parse convention, the validation-block
       seam, and the 100%-coverage risk.

# MUST READ — architecture reference (cited by the contract's RESEARCH NOTE)
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "## PHASE 3 — Execution-Loop Resilience & State Integrity"
  why: Confirms DEFAULT_RESEARCH_TIMEOUT_SECONDS currently = 300 and must become 1800;
       confirms no RESEARCH_DEPTH constant exists; confirms ResearchQueue is flat
       (S2's job to convert, NOT S1's).

# THE FILE TO EDIT (constants + helpers)
- file: src/config/constants.ts
  section: "// Resilience Tuning (PRD §4.2, §4.5, §9.2.2)" header (≈line 209).
       Edit sites: (1) DEFAULT_RESEARCH_TIMEOUT_SECONDS literal (line 249) + JSDoc
       (≈237, ≈246); (2) ADD RESEARCH_DEPTH block after the getResearchTimeoutSeconds
       block (≈line 271) and BEFORE the ISSUE_RETRY_MAX block (≈line 274); (3) ADD
       PARALLEL_RESEARCH block (place adjacent to RESEARCH_DEPTH — both are PRD §4.2
       research knobs, logical grouping).
  why: This is the canonical home for all env-var config constants; the existing
       RESEARCH_TIMEOUT + ISSUE_RETRY_MAX blocks are the exact patterns to mirror.
  pattern: name-const (string) → default-const → getter(env ?? default, validate).
  gotcha: For PARALLEL_RESEARCH there is NO existing boolean helper — use EXACT
       'true' string match (execution-guard.ts:68 convention). Do NOT use
       toLowerCase() or truthy coercion — PRD/§9.2.2 implies strict 'true'/'false'.

# THE FILE TO EDIT (CLI flags + validation)
- file: src/cli/index.ts
  section: (1) CLIArgs interface (≈62-141) — add parallelResearch + researchDepth;
       (2) program.option chain (≈290-356) — add -r/--parallel-research and
       --research-depth <n>; (3) validation region (≈760-810) — add depth
       coercion/validation block after --research-concurrency validation.
  why: This is the single CLI entry point (commander.js); global options register
       here and are validated here.
  pattern: --research-concurrency (cli/index.ts:309-313 option + ≈766-787
       validation) is the EXACT mirror for --research-depth; --no-cache/--continue-on-error
       (290-291) are the boolean-default-false mirrors for -r/--parallel-research.
  gotcha: --research-depth uses the env-backed-default form
       (process.env.RESEARCH_DEPTH ?? '2') so env wins over the CLI default-of-2
       when the flag is omitted (matches --research-concurrency). The explicit
       CLI value ALWAYS overrides env (commander semantics). Do NOT add a union
       member (these are global options, not subcommands).

# THE FILES TO EDIT (docs — Mode A, rides with the work)
- file: .env.example
  section: near "# CONCURRENCY CONFIGURATION" (≈line 88) / "# RESEARCH_QUEUE_CONCURRENCY"
       (≈line 96). ADD a "# RESEARCH CONFIGURATION" block with three commented knobs.
  why: PRD/contract item 5 DOCS requires .env.example entries; Mode A rides with work.
  pattern: existing commented `# VAR=value` lines with a `# Description` line above.
  gotcha: Keep values commented (# prefix). Use the NEW defaults (1800/2/false).

- file: docs/CONFIGURATION.md
  section: "### Resilience Tuning" table (≈lines 148-153). UPDATE RESEARCH_TIMEOUT
       Default 300→1800; ADD PARALLEL_RESEARCH and RESEARCH_DEPTH rows.
  why: Canonical env-var reference (per the PRD index, P6.M1.T1.S3 will make this
       file THE canonical reference; S1 keeps it correct in the meantime).
  pattern: 4-column markdown table (Variable | Required | Default | Description).
  gotcha: Use PRD §9.2.2 wording for descriptions. RESEARCH_TIMEOUT default = 1800.

# THE FILES TO EDIT (tests — 100% coverage gate)
- file: tests/unit/config/constants.test.ts
  section: ADD describe blocks for the new constants/helpers.
  why: Locks names/defaults/getters AND covers the new getter fallback branches.
  pattern: pure & deterministic — NO process.env mutation (matches existing
       MODEL_NAMES tests). Assert name-const strings + default values + getter
       unset-path (returns default). For getResearchDepth/isParallelResearch, the
       UNSET path is the deterministic one — test it; the env-set path is covered
       by integration.
  gotcha: vitest.config.ts enforces 100% branches on src/**/*.ts. The getter
       fallback branches (NaN/<=0 for depth; non-'true' for parallel) MUST be
       exercised — but WITHOUT mutating process.env, so test the unset path which
       hits both fallback AND the default-return. To hit the NaN branch
       deterministically you MAY temporarily set env in a test and restore it
       (vi.stubEnv / afterEach cleanup) — see Implementation Tasks Task 5.

- file: tests/unit/cli/index.test.ts
  section: ADD cases asserting the two new flags parse + the depth validation.
  why: Covers the new CLI option branches + the exit(1) validation branch.
  pattern: setArgv([...]) + parseCLIArgs() + assertions, mirroring existing tests.
  gotcha: invalid --research-depth must be tested (expect process.exit(1) thrown,
       like the parallelism-validation tests). -r default-false and -r-set-true
       both need a case.

# CONTRACT INPUTS (read-only)
- file: vitest.config.ts
  why: 100/100/100/100 thresholds on src/**/*.ts — the new code MUST be covered.
- file: package.json
  why: npm run validate = lint + format:check + typecheck + test:run (the green gate).
```

### Current Codebase tree (relevant slice)
```bash
src/
  config/
    constants.ts             # EDIT — +RESEARCH_DEPTH block, +PARALLEL_RESEARCH block, 300→1800 + JSDoc
  cli/
    index.ts                 # EDIT — +2 CLIArgs fields, +2 options, +depth validation block
tests/
  unit/
    config/
      constants.test.ts      # EDIT — +describe blocks (names, defaults, getters, fallbacks)
    cli/
      index.test.ts          # EDIT — +flag-parsing cases + depth-validation case
.env.example                 # EDIT — +RESEARCH CONFIGURATION block (3 commented knobs)
docs/
  CONFIGURATION.md           # EDIT — Resilience Tuning table: 300→1800 + 2 new rows
vitest.config.ts             # READ-ONLY — 100% coverage thresholds
package.json                 # READ-ONLY — npm run validate gate
PRD.md                       # READ-ONLY — §4.2 (h3.4), §9.2.2 (h4.1)
```

### Desired Codebase tree with files to be added and responsibility of file
```bash
src/config/constants.ts     # MODIFIED — foundational config constants + helpers for parallel research
src/cli/index.ts            # MODIFIED — two new global CLI flags + depth validation
tests/unit/config/constants.test.ts  # MODIFIED — locks new constants/helpers (coverage)
tests/unit/cli/index.test.ts         # MODIFIED — locks new flag parsing + validation (coverage)
.env.example                # MODIFIED — documents the three research knobs
docs/CONFIGURATION.md       # MODIFIED — canonical env-var reference updated
# (no NEW files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (boolean parse convention): there is NO boolean env-var helper in
// constants.ts today. The repo's established convention (execution-guard.ts:68)
// is EXACT case-sensitive string match: process.env.SKIP_BUG_FINDING === 'true'.
// Use the SAME for isParallelResearch(): process.env[PARALLEL_RESEARCH] === 'true'.
// Do NOT use Boolean(env), toLowerCase(), or truthy coercion — those would make
// PARALLEL_RESEARCH=false or PARALLEL_RESEARCH=0 enable research (a footgun).

// CRITICAL (300→1800 is a BUG FIX, not a rename): DEFAULT_RESEARCH_TIMEOUT_SECONDS
// currently = 300 (constants.ts:249). PRD §4.2/§9.2.2 mandate 1800 (30 min). The
// JSDoc @remarks (≈237) and @example (≈246) ALSO say 300 — update BOTH or the doc
// lies. getResearchTimeoutSeconds() needs NO change (references the const by name).

// CRITICAL (env-backed CLI default): --research-depth uses
// process.env.RESEARCH_DEPTH ?? '2' as its commander default, exactly like
// --research-concurrency uses process.env.RESEARCH_QUEUE_CONCURRENCY ?? '3'.
// This makes env win when the flag is OMITTED; an explicit --research-depth N
// still overrides (commander semantics). Do NOT hardcode the default as a bare '2'.

// CRITICAL (100% branch coverage): vitest.config.ts enforces 100/100/100/100 on
// src/**/*.ts. Every new branch must be exercised by a test:
//   - getResearchDepth(): NaN-or-<=0 fallback branch + the valid-return branch.
//   - isParallelResearch(): the === 'true' true-branch + the false-branch.
//   - CLI depth validation: the exit(1) branch (invalid input) + the store branch.
//   - CLI -r: the default-false path + the set-true path.
// Missing ANY → npm run validate fails on coverage.

// GOTCHA (no union change): parallelResearch/researchDepth are GLOBAL options on
// the root program, NOT subcommands. The parseCLIArgs return-type union (lines
// 242-248) is UNCHANGED. They ride along in ValidatedCLIArgs like parallelism.

// GOTCHA (scope discipline): S1 defines + parses the constants ONLY. Do NOT wire
// them into research-queue.ts, task-orchestrator.ts, retry.ts, or prp-pipeline.ts
// — that is S2/S4. Leave the getters callable but unused; S2 will call them.

// GOTCHA (S3 overlap): plan_status lists S3 ("Update RESEARCH_TIMEOUT default and
// documentation") as a separate subtask, but S1's OWN item_description (item 3c +
// item 5 DOCS) explicitly includes the 1800 change + .env.example + CONFIGURATION.md.
// Implement the FULL S1 contract here (the change + docs ride with the work, Mode A).
// S3 becomes a verification/polish pass. Do NOT defer the 1800 change to S3 — that
// would violate S1's item 3c.
```

---

## Implementation Blueprint

### Data models and structure
No ORM/pydantic models (this is a TypeScript project). The only type-level
additions are two optional fields on the `CLIArgs` interface
(`parallelResearch?: boolean; researchDepth?: number | string;`). The
`ValidatedCLIArgs` interface automatically inherits them via `Omit`/extension;
after the validation block, `researchDepth` is a `number` on the validated object
(parallel to `parallelism: number` / `researchConcurrency: number`).

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: MODIFY src/config/constants.ts — RESEARCH_DEPTH + PARALLEL_RESEARCH + 1800 change
  - LOCATE the "// Resilience Tuning" header (≈line 209) and the RESEARCH_TIMEOUT
    block (≈219-271) + ISSUE_RETRY_MAX block (≈274-326).
  - EDIT DEFAULT_RESEARCH_TIMEOUT_SECONDS: literal 300→1800 (line 249); JSDoc
    @remarks (≈237) "300s = 5min"→"1800s = 30min"; @example (≈246) "// 300"→"// 1800".
  - ADD the RESEARCH_DEPTH block (name const + DEFAULT_RESEARCH_DEPTH=2 +
    getResearchDepth()) AFTER getResearchTimeoutSeconds() (≈line 271) and BEFORE
    the ISSUE_RETRY_MAX name-const (≈line 274). Mirror ISSUE_RETRY_MAX's int
    validation (NaN/<=0 → default).
  - ADD the PARALLEL_RESEARCH block (name const + isParallelResearch()) adjacent
    to RESEARCH_DEPTH. Boolean: return process.env[PARALLEL_RESEARCH] === 'true'.
  - PRESERVE: getResearchTimeoutSeconds() body (unchanged — references the const
    by name), ISSUE_RETRY_MAX block, all other constants.
  - FOLLOW pattern: the 3-part (name → default → getter) shape of RESEARCH_TIMEOUT
    and ISSUE_RETRY_MAX; the EXACT 'true' string-match boolean of execution-guard.ts.
  - GOTCHA: do NOT coerce booleans loosely. do NOT change getResearchTimeoutSeconds.

Task 2: MODIFY src/cli/index.ts — CLIArgs fields + options + depth validation
  - ADD to CLIArgs interface (≈62-141): parallelResearch?: boolean;
    researchDepth?: number | string;  (with JSDoc one-liners, style of neighbors).
  - ADD two program.option registrations in the global-options chain (near
    --research-concurrency, ≈309-313):
      .option('-r, --parallel-research',
        'Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH)',
        false)
      .option('--research-depth <n>',
        'How many items ahead the background research supervisor prefetches (default: 2, env: RESEARCH_DEPTH)',
        process.env.RESEARCH_DEPTH ?? '2')
  - ADD a depth-validation/coercion block in the validation region (≈760-810),
    IMMEDIATELY after the --research-concurrency validation block, mirroring it:
      const researchDepthStr = typeof options.researchDepth === 'string'
        ? options.researchDepth : String(options.researchDepth);
      const researchDepth = parseInt(researchDepthStr, 10);
      if (isNaN(researchDepth) || researchDepth < 1) {
        logger().error('--research-depth must be a positive integer');
        process.exit(1);
      }
      options.researchDepth = researchDepth;
  - PRESERVE: the parseCLIArgs return-type union (242-248, UNCHANGED), all other
    options, all subcommands, the parallelism/research-concurrency validations.
  - FOLLOW pattern: --research-concurrency (option + validation) is the exact mirror.
  - GOTCHA: no validation block needed for -r (commander handles the boolean).
    Do NOT add a union member (global options, not subcommands).

Task 3: MODIFY .env.example — RESEARCH CONFIGURATION block (Mode A)
  - LOCATE the "# CONCURRENCY CONFIGURATION" section (≈line 88).
  - ADD (before or after it) a "# RESEARCH CONFIGURATION" block:
      # =============================================================================
      # RESEARCH CONFIGURATION (PARALLEL PRP RESEARCH)
      # =============================================================================
      # Enable background (parallel) PRP research (default: false). See PRD §4.2.
      # PARALLEL_RESEARCH=true
      # How many items ahead the supervisor prefetches as a chain (default: 2). See PRD §4.2.
      # RESEARCH_DEPTH=2
      # Deadline in seconds for background research before synchronous fallback (default: 1800 = 30min). See PRD §4.2.
      # RESEARCH_TIMEOUT=1800
  - FOLLOW pattern: existing commented `# VAR=value` blocks with `# Description`.
  - GOTCHA: keep the `#` comment prefix. Use NEW defaults (1800/2/false).

Task 4: MODIFY docs/CONFIGURATION.md — Resilience Tuning table (Mode A)
  - LOCATE "### Resilience Tuning" table (≈lines 148-153).
  - UPDATE the RESEARCH_TIMEOUT row Default: `300` → `1800`.
  - ADD two rows:
      | `PARALLEL_RESEARCH` | No | `false` | Enable background (parallel) PRP research. Set to `true` (literal). Forwarded to the bugfix sub-pipeline. See PRD §4.2, §4.4. |
      | `RESEARCH_DEPTH`    | No | `2`     | How many items ahead the background research supervisor prefetches as a chain. Forwarded to the bugfix sub-pipeline. See PRD §4.2, §4.4. |
  - FOLLOW pattern: the existing 4-column table (Variable | Required | Default | Description).
  - GOTCHA: descriptions per PRD §9.2.2. Mention CLI flag for PARALLEL_RESEARCH
    in a note if natural (e.g. "CLI: -r/--parallel-research").

Task 5: MODIFY tests/unit/config/constants.test.ts — lock new constants/helpers
  - ADD `import` of DEFAULT_RESEARCH_DEPTH, getResearchDepth, DEFAULT_RESEARCH_TIMEOUT_SECONDS,
    PARALLEL_RESEARCH, isParallelResearch from src/config/constants.js.
  - ADD describe('config/constants: RESEARCH_DEPTH', …):
      it('DEFAULT_RESEARCH_DEPTH === 2') → expect(DEFAULT_RESEARCH_DEPTH).toBe(2);
      it('RESEARCH_DEPTH name const === "RESEARCH_DEPTH"') → expect(RESEARCH_DEPTH).toBe('RESEARCH_DEPTH');
      it('getResearchDepth() returns default 2 when unset') → expect(getResearchDepth()).toBe(2);
      it('getResearchDepth() falls back to default on invalid (NaN/<=0)'):
        vi.stubEnv('RESEARCH_DEPTH','abc'); expect(getResearchDepth()).toBe(2);
        vi.stubEnv('RESEARCH_DEPTH','0');   expect(getResearchDepth()).toBe(2);
        vi.stubEnv('RESEARCH_DEPTH','-3');  expect(getResearchDepth()).toBe(2);
        // + a valid case: vi.stubEnv('RESEARCH_DEPTH','5'); expect(...).toBe(5);
      (use afterEach(() => vi.unstubAllEnvs()) to restore).
  - ADD describe('config/constants: PARALLEL_RESEARCH', …):
      it('PARALLEL_RESEARCH name const === "PARALLEL_RESEARCH"');
      it('isParallelResearch() === false when unset');
      it('isParallelResearch() === true only for literal "true"'):
        vi.stubEnv('PARALLEL_RESEARCH','true');  expect(isParallelResearch()).toBe(true);
        vi.stubEnv('PARALLEL_RESEARCH','false'); expect(isParallelResearch()).toBe(false);
        vi.stubEnv('PARALLEL_RESEARCH','1');     expect(isParallelResearch()).toBe(false);
        vi.stubEnv('PARALLEL_RESEARCH','');      expect(isParallelResearch()).toBe(false);
      (afterEach vi.unstubAllEnvs).
  - ADD describe('config/constants: DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)', …):
      it('=== 1800 (PRD §4.2 30min default)') → expect(DEFAULT_RESEARCH_TIMEOUT_SECONDS).toBe(1800);
  - FOLLOW pattern: the existing MODEL_NAMES / PRP_API_BASE_URL describe blocks.
  - GOTCHA: vi.stubEnv/vi.unstubAllEnvs is the SAFE way to mutate env under the
    100%-coverage gate (restores cleanly). Do NOT set process.env.X = '…' manually
    without restoration — leaks across tests.

Task 6: MODIFY tests/unit/cli/index.test.ts — lock flag parsing + validation
  - ADD cases (mirroring the existing setArgv/parseCLIArgs style):
      it('-r/--parallel-research defaults to false') → setArgv(['node','prd']);
        const a = parseCLIArgs(); expect(a.parallelResearch).toBe(false);
      it('-r sets parallelResearch true') → setArgv(['node','prd','-r']);
        expect(parseCLIArgs().parallelResearch).toBe(true);
      it('--research-depth defaults to 2') → expect(parseCLIArgs().researchDepth).toBe(2);
      it('--research-depth 3 coerces to number 3') → setArgv(['node','prd','--research-depth','3']);
        expect(parseCLIArgs().researchDepth).toBe(3);
      it('invalid --research-depth 0 exits 1') → setArgv(['node','prd','--research-depth','0']);
        expect(() => parseCLIArgs()).toThrow('process.exit(1)');
      it('invalid --research-depth abc exits 1') → similar with 'abc'.
  - FOLLOW pattern: existing parallelism/research-concurrency validation tests
    (they assert the process.exit(1) throw).
  - GOTCHA: must drive BOTH the exit(1) branch AND the store branch for coverage.
    -r default-false and -r-set-true both need cases.

Task 7: VERIFY — no regressions
  - RUN npm run typecheck → exit 0.
  - RUN npx vitest run tests/unit/config/constants.test.ts tests/unit/cli/index.test.ts → ALL green.
  - RUN npx vitest run --coverage → 100/100/100/100 on src/**/*.ts (new branches covered).
  - RUN npm run validate → GREEN.
  - RUN npm run build → succeeds.
  - VERIFY only the 6 intended files changed: git diff --name-only → constants.ts,
    cli/index.ts, constants.test.ts, index.test.ts, .env.example, CONFIGURATION.md.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: 3-part env-var config (constants.ts). RESEARCH_DEPTH mirrors ISSUE_RETRY_MAX:
export const RESEARCH_DEPTH = 'RESEARCH_DEPTH';
export const DEFAULT_RESEARCH_DEPTH = 2;
export function getResearchDepth(): number {
  const raw = Number(process.env[RESEARCH_DEPTH] ?? DEFAULT_RESEARCH_DEPTH);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_RESEARCH_DEPTH;   // ← fallback branch (MUST be covered by test)
  }
  return raw;                         // ← valid branch (MUST be covered)
}

// PATTERN: boolean env helper (NEW shape — no prior boolean helper in constants.ts).
// Convention from execution-guard.ts:68 — EXACT 'true' string match.
export const PARALLEL_RESEARCH = 'PARALLEL_RESEARCH';
export function isParallelResearch(): boolean {
  return process.env[PARALLEL_RESEARCH] === 'true';   // true-branch + false-branch both covered
}

// PATTERN: env-backed CLI number option (cli/index.ts, mirrors --research-concurrency):
.option('--research-depth <n>',
  'How many items ahead the background research supervisor prefetches (default: 2, env: RESEARCH_DEPTH)',
  process.env.RESEARCH_DEPTH ?? '2')

// PATTERN: number validation/coercion (cli/index.ts, mirrors --research-concurrency block):
const researchDepthStr =
  typeof options.researchDepth === 'string' ? options.researchDepth : String(options.researchDepth);
const researchDepth = parseInt(researchDepthStr, 10);
if (isNaN(researchDepth) || researchDepth < 1) {        // ← exit branch (MUST be covered)
  logger().error('--research-depth must be a positive integer');
  process.exit(1);
}
options.researchDepth = researchDepth;                  // ← store branch (MUST be covered)

// PATTERN: boolean CLI flag, default false (cli/index.ts, mirrors --no-cache):
.option('-r, --parallel-research',
  'Enable background (parallel) PRP research (default: false, env: PARALLEL_RESEARCH)',
  false)

// PATTERN: env-safe unit test (tests/unit/config/constants.test.ts) under 100%-coverage:
afterEach(() => vi.unstubAllEnvs());
it('getResearchDepth() falls back on invalid', () => {
  vi.stubEnv('RESEARCH_DEPTH', 'abc');
  expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);  // hits NaN fallback branch
  vi.stubEnv('RESEARCH_DEPTH', '0');
  expect(getResearchDepth()).toBe(DEFAULT_RESEARCH_DEPTH);  // hits <=0 fallback branch
});

// CRITICAL: 300→1800 is a literal + JSDoc change (NOT a rename). Update BOTH the
//   const value AND the @remarks/@example comments that mention 300.
// CRITICAL: do NOT wire these constants into any consumer (S2/S4 do that).
// CRITICAL: do NOT add a union member (global options, not subcommands).
```

### Integration Points
```yaml
CONSTANTS (src/config/constants.ts):
  - change: DEFAULT_RESEARCH_TIMEOUT_SECONDS 300 → 1800 (+ JSDoc 5min → 30min).
  - add: RESEARCH_DEPTH name const, DEFAULT_RESEARCH_DEPTH = 2, getResearchDepth().
  - add: PARALLEL_RESEARCH name const, isParallelResearch().

CLI (src/cli/index.ts):
  - add: CLIArgs.parallelResearch?, CLIArgs.researchDepth?.
  - add: program.option('-r, --parallel-research', …, false).
  - add: program.option('--research-depth <n>', …, process.env.RESEARCH_DEPTH ?? '2').
  - add: depth validation/coercion block (mirror --research-concurrency).
  - unchanged: return-type union; all subcommands; parallelism/research-concurrency.

CONFIG (.env.example):
  - add: "# RESEARCH CONFIGURATION" block (PARALLEL_RESEARCH, RESEARCH_DEPTH, RESEARCH_TIMEOUT).

DOCS (docs/CONFIGURATION.md):
  - update: Resilience Tuning table RESEARCH_TIMEOUT default 300 → 1800.
  - add: PARALLEL_RESEARCH row, RESEARCH_DEPTH row.

NO DATABASE / NO ROUTES / NO MODELS / NO CONSUMER WIRING / NO PRD.md / NO tasks.json
  — pure foundational config + CLI parsing + docs.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit → exit 0 (new consts/helpers compile; new CLI fields/options compile)
npm run lint             # eslint . --ext .ts → no new violations
npm run format:check     # prettier --check; run `npm run format` if it complains
# Expected: Zero errors. All edits are additive config + mirror existing patterns.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/config/constants.test.ts   # new constants/helpers incl. fallback branches
npx vitest run tests/unit/cli/index.test.ts          # new flag parsing + depth validation
npx vitest run --coverage                            # 100/100/100/100 on src/**/*.ts
npm run test:run                                     # full suite green
# Expected: ALL green. New getter fallback branches + CLI exit(1) branch are
# exercised (else coverage fails).
```

### Level 3: Integration Testing (System Validation)
```bash
npm run validate      # lint + format:check + typecheck + test:run → GREEN
npm run build         # tsc -p tsconfig.build.json → succeeds

# Manual smoke (flag parsing):
node -e "process.argv=['node','prd','--research-depth','4','-r']; const {parseCLIArgs}=require('./dist/cli/index.js'); console.log(JSON.stringify({depth:parseCLIArgs().researchDepth, parallel:parseCLIArgs().parallelResearch}))"
# EXPECT: {"depth":4,"parallel":true}

# Env-var helper smoke (unset → defaults):
node -e "delete process.env.RESEARCH_DEPTH; delete process.env.PARALLEL_RESEARCH; const {getResearchDepth,isParallelResearch}=require('./dist/config/constants.js'); console.log(JSON.stringify({depth:getResearchDepth(),parallel:isParallelResearch()}))"
# EXPECT: {"depth":2,"parallel":false}

# Invalid depth → exit 1:
node -e "process.argv=['node','prd','--research-depth','0']; require('./dist/cli/index.js').parseCLIArgs()" ; echo "exit=$?"
# EXPECT: error log + exit=1
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Confirm the 300→1800 change and its JSDoc are consistent:
rg -n "DEFAULT_RESEARCH_TIMEOUT_SECONDS\s*=\s*1800" src/config/constants.ts   # EXPECT: one match
rg -n "300" src/config/constants.ts                                            # EXPECT: zero matches referencing the timeout
rg -n "1800s = 30min|// 1800" src/config/constants.ts                          # EXPECT: JSDoc updated

# Confirm the new constants/helpers exist:
rg -n "export const RESEARCH_DEPTH|export function getResearchDepth" src/config/constants.ts   # 2 matches
rg -n "export const PARALLEL_RESEARCH|export function isParallelResearch" src/config/constants.ts # 2 matches

# Confirm no RESEARCH_DEPTH existed before (now exists exactly once):
rg -n "RESEARCH_DEPTH" src/ | wc -l   # EXPECT: > 0 (constants.ts + cli/index.ts + tests)

# Confirm the CLI flags:
rg -n "\-r, --parallel-research" src/cli/index.ts        # one match
rg -n "\-\-research-depth" src/cli/index.ts              # one+ match (option + validation)

# Confirm the docs:
rg -n "PARALLEL_RESEARCH" .env.example docs/CONFIGURATION.md  # both present
rg -n "RESEARCH_DEPTH" .env.example docs/CONFIGURATION.md     # both present
rg -n "1800" .env.example docs/CONFIGURATION.md               # both present

# Confirm only the 6 intended files changed:
git diff --name-only
# EXPECT: src/config/constants.ts, src/cli/index.ts,
#         tests/unit/config/constants.test.ts, tests/unit/cli/index.test.ts,
#         .env.example, docs/CONFIGURATION.md
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` exit 0.
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] `npm run build` succeeds.
- [ ] 100% coverage on `src/**/*.ts` preserved (all new branches covered).

### Feature Validation
- [ ] `getResearchDepth()` returns 2 (unset), 5 (`RESEARCH_DEPTH=5`), 2 (invalid).
- [ ] `isParallelResearch()` returns false (unset/non-`'true'`), true (`'true'`).
- [ ] `DEFAULT_RESEARCH_TIMEOUT_SECONDS === 1800`; JSDoc says 30min/1800.
- [ ] `parseCLIArgs()` parses `-r` (true) and `--research-depth <n>` (number);
      defaults false/2; invalid depth exits 1.
- [ ] `.env.example` has the 3 commented research knobs.
- [ ] `docs/CONFIGURATION.md` Resilience Tuning table: 1800 + 2 new rows.

### Code Quality Validation
- [ ] RESEARCH_DEPTH block mirrors ISSUE_RETRY_MAX exactly (3-part pattern).
- [ ] isParallelResearch uses EXACT `'true'` match (execution-guard convention).
- [ ] CLI flags mirror existing --research-concurrency / --no-cache patterns.
- [ ] Depth validation mirrors the --research-concurrency validation block.
- [ ] No consumer of the new constants is wired (S2/S4 do that).
- [ ] Return-type union unchanged (global options, not subcommands).

### Documentation & Deployment
- [ ] `.env.example` knobs commented with NEW defaults (1800/2/false).
- [ ] `docs/CONFIGURATION.md` descriptions match PRD §9.2.2 wording.
- [ ] No out-of-scope docs edits.

---

## Anti-Patterns to Avoid
- ❌ Don't use loose boolean coercion for `PARALLEL_RESEARCH` (`Boolean(env)`,
  `toLowerCase()`, truthy checks) — `PARALLEL_RESEARCH=false` would then ENABLE
  research. Use EXACT `=== 'true'` (execution-guard.ts convention).
- ❌ Don't change only the `DEFAULT_RESEARCH_TIMEOUT_SECONDS` literal and leave
  its JSDoc saying "300s = 5min" / `// 300` — the doc must stay truthful.
- ❌ Don't change `getResearchTimeoutSeconds()` body — it references the constant
  by name; updating the constant is enough.
- ❌ Don't wire these constants into any consumer (research-queue.ts,
  task-orchestrator.ts, retry.ts, prp-pipeline.ts) — that's S2/S4. S1 is
  foundational config ONLY.
- ❌ Don't hardcode `--research-depth`'s default as a bare `'2'` — use
  `process.env.RESEARCH_DEPTH ?? '2'` so env wins when the flag is omitted
  (matches --research-concurrency).
- ❌ Don't add a union member to `parseCLIArgs`'s return type — these are global
  options, not subcommands.
- ❌ Don't forget to cover EVERY new branch (getter fallbacks, CLI exit(1),
  `-r` true/false) or `npm run validate` fails on 100% coverage.
- ❌ Don't mutate `process.env.X` in tests without restoration — use
  `vi.stubEnv`/`vi.unstubAllEnvs` (the existing tests are pure; env leaks break
  the 100%-coverage gate's determinism).
- ❌ Don't touch PRD.md, tasks.json, prd_snapshot.md, or vitest.config.ts.

---

## Confidence Score

**9/10** — One-pass success likelihood is very high. S1 is a config-layer change
across 6 files, every edit site pinned with file:line anchors, every pattern
mirrored from a named exemplar (`ISSUE_RETRY_MAX` for the int getter,
`execution-guard.ts:68` for the boolean parse, `--research-concurrency` for the
CLI option + validation, `--no-cache` for the boolean flag). The correctness
rests on seven pre-proven facts: the 3-part env-var pattern, the boolean-parse
convention, the exact 300→1800 site (literal + two JSDoc lines), the CLI flag
shapes, the number-coercion validation seam, the CLIArgs/ValidatedCLIArgs
interface, and the 100%-branch-coverage gate (every new branch has a designated
test). The scope fences are airtight (no consumer wiring, no union change, no
other subcommands). The single notable risk — covering the getter fallback
branches without flaky env mutation — is handled by `vi.stubEnv`/
`vi.unstubAllEnvs`. The S3/S1 overlap is resolved by implementing S1's full
item_description (the 1800 change + docs ride with the work per Mode A); S3
becomes a verification pass. Zero file overlap with the parallel P2.M3.T1.S2
(that PRP edits `src/cli/index.ts` only for the `status` command/branch — S1
edits the global-options chain + validation region + CLIArgs interface, a
different region; coordinate the single shared file via the orchestrator if both
land simultaneously, but the regions are disjoint).