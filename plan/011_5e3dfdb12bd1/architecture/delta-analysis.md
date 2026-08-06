# Session 011 — Delta Analysis (PRD 010 → 011)

## Session type

Session `011_5e3dfdb12bd1` was created from a PRD hash change. It has **no
`delta_from.txt`** (the pipeline recorded it as a fresh/baseline-style
session), but the project is ~95% implemented across sessions 001–010. This
analysis therefore derives the *effective* delta by diffing the previous
baseline snapshot (`plan/010_3032ca2a8723/prd_snapshot.md`, 117 139 B) against
this session's snapshot (`plan/011_5e3dfdb12bd1/prd_snapshot.md`, 130 497 B).

The previous session (010) was a **purely cosmetic delta** (markdown table
column re-alignment in §9.7.3 / §9.7.5 + one trailing blank line — verified
complete, zero implementation work). So the 010 snapshot is a sound baseline.

## What changed in the PRD

`diff plan/010_3032ca2a8723/prd_snapshot.md plan/011_5e3dfdb12bd1/prd_snapshot.md`
yields exactly these semantic additions:

1. **§9.9 Validation Gate Semantics (Monotonicity & Terminal-State
   Re-Execution)** — entirely NEW section (§9.9.1 Problem, §9.9.2 Requirements
   REQ-G1 + REQ-G2, §9.9.3 Acceptance Criteria). **This is the substantive
   delta and the only new functional work for session 011.**
2. **`[cli] prd` config key** — a new row in the §9.7.5 schema table plus its
   mapping-semantics note (`[cli] prd` sets the default `-p/--prd` entry path,
   repo-root-relative). Added to the PRD in the same doc commit.
3. **Cross-references to §9.9** added in §4.2 ("gates … MUST be monotonic"),
   §6.2 (Blueprint "validation-gate monotonicity"), and §6.3 (Builder
   "terminal-state re-execution"). These are PRD prose describing the behavior
   REQ-G1/REQ-G2 implement; no separate code work.

## What is already implemented (reality check — no task created)

- **`[cli] prd`** — **COMPLETE.** Landed in commit `f248867` ("fix: make
  `[cli] prd` functional — add schema key and defer existsSync guard until
  after .hack load"). Verified in code:
  - `src/config/hack-config.ts:430-438` — `cli.prd` schema key (`cliFlag:
    '-p/--prd'`).
  - `src/config/hack-config.ts:669` — `[cli]` section `prd: { type: 'string' }`.
  No further work.
- **§9.3.2 watchdog-killed-gate terminal abort** — **COMPLETE.**
  `PRPExecutor.execute()` already breaks the fix-retry loop when any gate is
  watchdog-killed (`validationResults.some(r => r.timedOut)`), exit 124 is
  mapped to `timedOut`, and there is a passing test
  (`tests/unit/agents/prp-executor.test.ts` "aborts (outcome:fail) without
  fix-retry when a gate is watchdog-killed"). §9.9 builds on this; it does not
  re-implement it.
- **Distributed-PRD split** (`543dd59`) — spec/docs only; no code work.

## What is NOT yet implemented (the work)

**§9.9 Validation Gate Semantics.** A grep for
`monotonic|neutraliz|negative.existence|G2\.1|G1\.1|test ! -f|non-monotonic`
across `src/` and `PROMPTS.md` returns **nothing** in the gate logic or the
Researcher/Coder prompts (the only `monotonic` hits are about task-status
promotion in `src/utils/task-utils.ts`, unrelated). The two requirements are
both unimplemented:

- **REQ-G1 (gate-construction guardrails)** — the Researcher (Blueprint) and
  Coder (Builder) prompts do not yet forbid non-monotonic gates. See
  `implementation-status.md` for the exact insertion points.
- **REQ-G2 (executor hardening)** — `PRPExecutor.#runValidationGates()` has no
  neutralization detector; a cached/legacy `! test -f X` gate still hard-fails
  the item forever.

## Scope decision

Session 011 implements **§9.9 only**. It decomposes cleanly into the two
layers the PRD specifies — the **prompt layer** (REQ-G1: prevent new
non-monotonic gates from being emitted) and the **runtime layer** (REQ-G2:
neutralize any that already exist in the cache) — plus the Mode B
changeset-level doc sync. No work is planned for `[cli] prd`, §9.3.2, or the
§4.2/§6.2/§6.3 prose (all already landed as committed PRD text or code).
