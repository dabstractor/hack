# P1.M4.T4.S1 — Research Findings: Full-suite green verification gate

> This item is a **verification GATE**, not an implementation task. The deliverable is a green
> `npx vitest run` (exit 0) so the PRD §4.4 `validate.sh` abort-on-failure path can pass on a
> correct build. It catches **stragglers** left by the category-(a)/(b)/(c) fix items
> (P1.M4.T1 / T2 / T3) — it does NOT re-own already-fixed files.

## 1. What this item IS (vs. is not)

- **IS**: the final green proof for BUG-004. Run the whole suite; confirm `0 failed test files,
  0 failed tests, exit 0`; for any REMAINING failure, line-audit → categorize → fix **test-only**;
  STOP+flag any REAL src defect. Re-run until green. Record final counts in the commit message.
- **IS NOT**: a re-implementation of the category fixes. T1/T2/T3 (incl. T3.S3 in-flight) own the
  20 historically-red files. This item only touches a file if it is STILL red after they land, or if
  a NEW regression appears (e.g. a fix in one item broke a previously-green file).
- **NO MOCKING** (verification step per contract). But straggler FIXES may legitimately use the
  shared seam helper shipped by T2.S1 (see §5) — that is test infrastructure, not new mocking of
  production seams.

## 2. The exact commands (verified against package.json + vitest.config.ts)

| Purpose | Command | Source |
|---|---|---|
| **Primary gate** (whole suite, dot summary) | `npx vitest run --reporter=dot` | used by every BUG-004 sibling PRP; `include: ['tests/**/*.{test,spec}.ts']` |
| Whole suite (verbose, for triage) | `npx vitest run --reporter=verbose` | same; use when isolating a straggler |
| Single file re-run | `npx vitest run <path> --reporter=verbose` | per-straggler confirmation |
| **Feasible §4.4-equivalent gate** | `npm run validate` | package.json:45 = `npm run lint && npm run format:check && npm run typecheck && npm run test:run` |
| Static gates (sub-components of validate) | `npm run lint` / `npm run format:check` / `npm run typecheck` | package.json scripts |
| Test only (npm alias) | `npm run test:run` | = `vitest run` |

**`npm run validate` IS feasible** (package.json:45). The contract says "and `npm run validate` if
feasible" — run it as the FINAL gate after vitest is green; it is the closest artifact in-repo to the
PRD §4.4 `validate.sh` (which is agent-generated at runtime and does not exist on disk pre-run).

### Green-state expectation (exit-0 contract)
- `npx vitest run --reporter=dot` tail reads:
  `Test Files  N passed (N)` (0 failed) · `Tests  M passed | K skipped` (0 failed) · **exit 0**.
- `npm run validate` → all 4 sub-commands exit 0.

## 3. Why this gate matters (PRD §4.4 — quoted verbatim)

- §4.4 step 1: "*Validation Scripting:* An agent generates a custom `validate.sh` ... then runs it."
- §4.4 step 1 **Abort-on-failure**: "*If validation does not finish (non-zero exit), the run MUST
  abort _before_ cleanup, commit, and bug-hunt. Proceeding on a half-validated build is forbidden.*"
- §9.3.2: a watchdog-killed validation (exit 124) is a **hard failure, never retried**.
- Therefore: a red `npm test`/`vitest run` aborts the ENTIRE pipeline on a correct build — making
  the validate gate unusable. GREEN here is the precondition for §4.4 to function at all.

## 4. The straggler decision-tree (the core of this item)

When a file is STILL red after T1/T2/T3 land, classify by the BUG-004 category map
(`architecture/bug-004-test-suite.md`) and apply the matching **test-only** fix. **Never mask a real
src defect** — if line-auditing reveals the production code is wrong, STOP and flag in
`architecture/bug-004-test-suite.md` (do NOT edit src here; that's a rule-5 corrective owned elsewhere).

```
straggler found (file still red)
│
├─ (c) GENUINE TEST BUG — deterministic logic/assertion/process-event error
│     signs: "process._events.X is not iterable", exit-code assertion drift,
│            a test asserting a stale internal ordering, a thrown-but-unguarded
│            rejection the test didn't await.
│     FIX (test-only): guard the iterable (Array.isArray), fix the assertion to
│                       match the real deterministic contract, await the promise.
│     sibling pattern: P1.M4.T1.S1 (shutdown), P1.M4.T1.S2 (progressive-validation,
│                       prp-pipeline-integration, prp-create-prompt).
│
├─ (a) ENVIRONMENTAL — "PiHarness not initialized. Call initialize() first."
│     signs: real Researcher agent runs (research seam unmocked) -> groundswell
│            returns {status:'error', error:'PiHarness not initialized'} -> throws
│            before smartCommit. Affects suites whose subject is NOT research.
│     FIX (test-only): apply tests/helpers/research-seam.ts — top-level vi.mock of
│                       the seam + wireMock* in beforeEach; OR initRealHarness() in
│                       beforeAll for suites that DO test research integration.
│     sibling pattern: P1.M4.T2.S2 (9 files). USE THE HELPER — do not reinvent.
│
├─ (b) TEST-ROT — code evolved, expectation stale
│     signs: model string mismatch (GLM-4.7 vs provider-qualified zai/glm-5.x),
│            prompt-text literal gone (de-escalated to OPTIONAL), mock shape drift
│            (currentSession is a SessionState OBJECT not a path string),
│            constructor->run() wiring drift (PRPPipeline defers init into run()).
│     FIX (test-only): re-point the assertion to the CURRENT verbatim literal/shape.
│                       GREP THE CONSTANT FIRST; confirm the literal is inside the
│                       right constant's line range. NEVER weaken an assertion to
│                       force green — assert the real current contract.
│     sibling pattern: P1.M4.T3.S1/S2/S3. Gotchas in their research/findings.md.
│
└─ REAL SRC DEFECT (line-audit shows production is wrong)
      signs: the test asserts a CORRECT, in-spec contract and production violates it.
      ACTION: **STOP. Do NOT edit src/. Do NOT weaken the test.** Flag in
              architecture/bug-004-test-suite.md (one-line note: file, line, the
              violated contract, why it's not test-rot). Hand off as rule-5
              corrective work to a separate item. This is the one hard STOP in the gate.
```

**Cross-item regression check (critical):** when a straggler is in a file that a PRIOR item edited
(T1/T2/T3 files), the regression is almost certainly caused by a fix in THIS item's siblings or by
mock-state bleed. Re-read the sibling's PRP `research/findings.md` before touching the file — the fix
is usually "re-apply the sibling's pattern", not a new edit.

## 5. Shared test infrastructure available to straggler fixes

`tests/helpers/research-seam.ts` (shipped by P1.M4.T2.S1) — exports (verified via grep):
- `createMockPRPDocument(taskId)` — builds a `PRPDocument` for the mock seam.
- `MOCK_PRP_DOCUMENT`, `MINIMAL_PRP_JSON_STRING` — canned payloads.
- `createSuccessAgentResponse(data?)` — groundswell-shaped success envelope.
- `prpJsonPath(sessionPath, taskId)` — stable PRP json path.
- `wireMockResearcherAgent(opts)` / `wireMockPRPGenerator(opts)` / `wireMockResearchQueue(opts)` —
  mock the research seam (category-(a) fix for unit-style suites).
- `initRealHarness()` — real `ensureHarnessInitialized()` for suites that DO test research integration.

`tests/setup.ts` (global, runs per-test): `vi.clearAllMocks()`, `validateProviderEndpoint()`
(THROWS on Anthropic endpoints — tests MUST use z.ai), unhandled-rejection tracking (a stray
unawaited promise FAILS the test), `delete process.env.SKIP_BUG_FINDING` hermetic-env reset,
`vi.unstubAllEnvs()` in afterEach. → A straggler "unhandled rejection" failure is often a missing
`await`, not an assertion bug.

`vitest.config.ts`: pool `forks` (1–4), 4096 MB mem cap (OOM possible on huge files — a crash/kill
here shows as a failed file, not an assertion failure), `coverage.thresholds.global = 100%` (ONLY
enforced under `--coverage`; the gate runs plain `vitest run`, so coverage is NOT a gate here).

## 6. Commit format (PRD §5.1 / BUG-003 / P1.M3 — LANDED)

- Item id `P1.M4.T4.S1` → `parseItemPosition` → `{phase:1,milestone:4,task:4,subtask:1}` →
  `buildTaskPrefix` → **`1.4.4.1`**. `PRP_COMMIT_FORMAT` default = `task-prefix`.
- Commit subject = **`1.4.4.1: <subject>`**. **NEVER** prepend `[PRP Auto]` (forbidden §5.1; P1.M3
  strips it defense-in-depth). The `Co-Authored-By: Claude <noreply@anthropic.com>` trailer is
  PRESERVED in both modes (formatCommitMessage always appends it).
- Verified: `src/utils/git-commit.ts:formatCommitMessage` lands the prefix only when
  `position && getPrpCommitFormat()==='task-prefix'`; `[PRP Auto]` is stripped via regex.

## 7. Baseline numbers (architecture/bug-004-test-suite.md, run-to-run ±1)

- **Pre-fix baseline:** `179 failed | 874 passed | 14 skipped` across **20 failing files** of 51 in
  `tests/integration`. `npm test`/`vitest run` exits 1.
- **Category budget:** (a) ~9 files / ~81 fails → fixed by T2; (b) ~7 files / ~58 fails → fixed by
  T3; (c) ~4 files / ~39 fails → fixed by T1. (Counts overlap the 20-file / 179-fail totals.)
- **Post-T1/T2/T3 expectation:** ~0 failures. This item's job is to PROVE that and sweep stragglers.
- NOTE: a live baseline run was attempted during planning but T3.S3 was still in-flight, so the
  planning-time number would NOT reflect the post-fix state. **The executor MUST capture the real
  baseline as Task 0** (it is the authoritative pre-gate state for this item) and the real final
  count in the commit message.

## 8. Known cross-cutting gotchas that produce phantom stragglers

- **Ambient `SKIP_BUG_FINDING=true`** in the shell → setup.ts resets it per-test, but a NEW test that
  reads a DIFFERENT gating env var could still bleed. Check `src/config/*` for env-keyed branches.
- **`z.ai` endpoint guard** (setup.ts `validateProviderEndpoint`) THROWS if `.env` points at
  anthropic.com → every test in the file fails identically with an endpoint error. This is NOT a
  straggler-class failure; it's an env-misconfig that fails the WHOLE run. Confirm `.env`/`.envrc`
  first if failures are uniform across unrelated files.
- **Groundswell alias** (`vitest.config.ts` `resolve.alias.groundswell` → sibling repo
  `../groundswell/dist/index.js`) is NOT the problem (architecture doc confirms). Don't chase it.
- **OOM on huge files** (4096 MB cap, forks pool) surfaces as a crashed/failed FILE with no clean
  assertion failure. A genuine OOM straggler is usually a test creating an unbounded structure —
  fix the test, not the config.
- **Run-to-run flakiness** (±1 per architecture doc): if a single test flips pass/fail across two
  `vitest run` invocations, treat it as a real ordering/isolation bug (mock-state bleed, missing
  `vi.clearAllMocks` effect, a process-level listener leak like the shutdown bug). Re-run to confirm
  before "fixing".