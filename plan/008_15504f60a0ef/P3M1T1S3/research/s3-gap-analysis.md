# S3 Gap Analysis — RESEARCH_TIMEOUT default + docs polish

## Purpose
S1 (`P3M1T1S1`) is marked **Complete** and, per its own item_description (item 3c
+ item 5 DOCS), already implemented the **full** 1800s change: the constant
literal, its JSDoc, `.env.example`, `docs/CONFIGURATION.md`, AND a fresh
`DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)` assertion in
`tests/unit/config/constants.test.ts:243-246`.

S3 is therefore a **verification + polish pass** that closes the gaps S1 left
open. This file enumerates those gaps with exact file:line anchors proven
against the live working tree.

---

## Proven facts (verified against working tree, 2025-07-24)

### FACT 1 — S1 is fully landed for its declared scope
`src/config/constants.ts:249`:
  `export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 1800;`
JSDoc @remarks (≈240) + @example (≈246) both say 1800 / 30min. ✅ done.

`.env.example:99-109` has the `# RESEARCH CONFIGURATION` block with
`# RESEARCH_TIMEOUT=1800`. ✅ done.

`docs/CONFIGURATION.md:151` — Resilience Tuning table row:
  `| RESEARCH_TIMEOUT | No | 1800 | … |` ✅ done.

`tests/unit/config/constants.test.ts:243-246` — fresh describe block:
  `describe('config/constants: DEFAULT_RESEARCH_TIMEOUT_SECONDS (1800)', …)`
  asserts `toBe(1800)`. ✅ done.

### FACT 2 — GAP: pre-existing test file still says "300"
`tests/unit/config/research-timeout.test.ts` (the file that predates S1's
constants.test.ts block) has **6 stale `300` references** that were NOT updated
by S1:
- line 7 (header docstring): `- (a) Returns DEFAULT (300) when env var is unset`
- line 33 (test name):        `(a) returns the default (300) when env var is unset`
- line 40 (inline comment):   `expect(result).toBe(DEFAULT_RESEARCH_TIMEOUT_SECONDS); // 300`
- line 62 (inline comment):   `… // 300`
- line 73 (inline comment):   `… // 300`
- line 84 (inline comment):   `… // 300`

These are **cosmetic** (the assertions compare against the constant, so the
tests pass regardless), but the comments actively LIE about the default and
violate the PRP's "comments stay truthful" principle. **S3 must update them to
1800.** This is the single concrete code change S3 makes beyond docs.

### FACT 3 — GAP: user-facing docs still say "default 300s"
Two prose references to the old default remain in shipped docs (NOT touched by
S1, which only edited `docs/CONFIGURATION.md`'s table cell):

- `docs/WORKFLOWS.md:96`:
  `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2); on expiry the work is abandoned … ``
- `docs/WORKFLOWS.md:403`:
  `` … bounded by `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). If the deadline elapses, … ``
- `README.md:128`:
  `` `RESEARCH_TIMEOUT` (default `300`s; PRD §4.2). If the deadline elapses, the in-flight research … ``

These are the **Mode A "rides with the work"** doc sites S1's PRP scoped to
CONFIGURATION.md only. S3's item 5 (DOCS, Mode A) authorizes touching them to
keep the canonical env-var reference truthful end-to-end. (Note: the table at
WORKFLOWS.md:582-585 and 1227-1242 lists *duration estimates* "300s" — those are
NOT the RESEARCH_TIMEOUT default and must NOT be changed.)

### FACT 4 — the "grace period / heartbeat" is a design property, NOT a subsystem
Contract item 4 says: "Update the grace-period logic: a grace period precedes
the heartbeat so legitimately long research isn't flagged, but the deadline
still fails fast on a genuinely stuck supervisor."

Codebase reality (verified):
- NO `grace`, `heartbeat`, `GRACE`, or `HEARTBEAT` token exists anywhere in
  `src/` (grep returned nothing).
- The deadline is enforced by a HARD timer in two places:
  - `src/core/research-queue.ts:437` `waitForPRP` — `Promise.race([inFlight,
    deadline])` with `deadlineMs = getResearchTimeoutSeconds() * 1000`; on
    expiry → `abandoned.add(taskId)` + `throw ResearchTimeoutError`.
  - `src/utils/retry.ts:662-696` `withAgentDeadline(promise)` — same hard
    `setTimeout` race; on expiry → reject with `AgentError`.
- PRD §4.2's phrase "a heartbeat surfaces only after a grace period" describes
  the *desired user-facing behavior* (don't spam warnings during normal long
  research) — the current hard-deadline implementation already satisfies it:
  there is no intermediate "heartbeat" warning at all; the only signal is the
  final deadline expiry. So "grace period precedes the heartbeat" is vacuously
  true (no heartbeat = nothing to suppress).

**Conclusion:** item 4 does NOT require building a heartbeat/grace subsystem.
S3's contribution re: the grace period is **documentation + verification**: add
a JSDoc note to `getResearchTimeoutSeconds()` and/or `waitForPRP` documenting
that the deadline is a hard bound (fails fast on stuck) and that no
intermediate heartbeat is emitted during the grace window (so legitimate long
research isn't flagged). The test in Task 4 of the PRP *verifies the property*
(deadline fires for a stuck promise; no spurious signal for a slow-but-fine
promise that completes before the deadline).

### FACT 5 — item 4 OUTPUT: "No further subtask consumes this directly"
This confirms S3 is a **terminal polish subtask** — it produces no new
interface for S4. S4 forwards `PARALLEL_RESEARCH` + `RESEARCH_DEPTH` (env vars)
to the bugfix child; it does NOT consume any S3 artifact. So S3 must NOT
introduce new exported symbols that S4 is expected to use.

### FACT 6 — validation gate
`package.json` "validate" = `lint && format:check && typecheck && test:run`.
`vitest.config.ts` enforces 100/100/100/100 coverage on `src/**/*.ts`. S3's
only src touch is a JSDoc-comment edit on `getResearchTimeoutSeconds()` (no
behavior change → no new branches → coverage unaffected). The test-file comment
edits and doc edits are not subject to coverage. The single new test (verifying
the deadline property) lives in an existing test file and covers already-tested
behavior (defensive).

## Scope decision
S3 edits exactly **4 files** (all Mode-A "rides with the work" doc/comment
accuracy fixes):
1. `tests/unit/config/research-timeout.test.ts` — update 6 stale `300` → `1800`
   comments + header docstring + test name. (No assertion-value changes.)
2. `docs/WORKFLOWS.md` — 2 prose `default 300s` → `default 1800s` (lines 96, 403
   ONLY; leave duration-estimate tables untouched).
3. `README.md` — 1 prose `default 300s` → `default 1800s` (line 128 ONLY).
4. `src/config/constants.ts` — add a `@remarks` grace-period note to
   `getResearchTimeoutSeconds()` documenting the hard-deadline / no-heartbeat
   property (and, optionally, a mirrored note on `waitForPRP` in
   research-queue.ts — see PRP Task 1).

Plus **1 verification test** added to the existing
`tests/unit/config/research-timeout.test.ts` describe block asserting the
deadline property holds (defensive; covers the grace-period documentation
claim).

No new source files. No behavior change. No coverage regression risk.