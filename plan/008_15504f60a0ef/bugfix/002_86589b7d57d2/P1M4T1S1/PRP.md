# PRP — P1.M4.T1.S1: Fix `prp-pipeline-shutdown.test.ts` `process._events` spreading (20/20 fail)

> Bugfix 002, **BUG-004 (MAJOR) — Category (c) genuine test bug**, first deterministic cluster to
> stabilize the failure count (architecture `bug-004-test-suite.md` §"Category (c)" prescribes the
> order: fix (c) first). PRD §4.4's `validate.sh` aborts on a non-zero `npm test` exit, but the suite
> is red. This item owns exactly **one** of the genuine test-only bugs:
> `tests/integration/prp-pipeline-shutdown.test.ts` — **20 of 20 tests fail in `beforeEach` setup**
> before any test body runs, so graceful-shutdown (PRD §5.1) is effectively unvalidated. The fix is
> **test-infra only** — NO production code changes (architecture note: "None of these are
> production-runtime defects — the pipeline code is in-spec").
>
> **Parallel-coordination note:** P1.M3.T2.S1 (commit-format wiring) is being implemented
> concurrently. It edits `src/utils/git-commit.ts`, `src/core/task-orchestrator.ts`,
> `tests/unit/utils/git-commit.test.ts`, and `tests/integration/smart-commit.test.ts`. **This item
> edits a fully disjoint file** (`tests/integration/prp-pipeline-shutdown.test.ts`). No conflict,
> either order lands cleanly.

---

## Goal

**Feature Goal**: Make `tests/integration/prp-pipeline-shutdown.test.ts` pass all 20 tests by removing
the `beforeEach` `process._events.SIGINT/SIGTERM is not iterable` throw (Node's single-listener
"f" optimization stores one listener as a bare function, so `[...fn]` throws) and replacing the
destructive `afterEach` `process.removeAllListeners(...)` (which wipes vitest's own signal handlers)
with a precise diff-based restore that preserves everything but the pipeline's test-added listeners.

**Deliverable**: A single edited file — `tests/integration/prp-pipeline-shutdown.test.ts` — whose
`beforeEach` captures signal listeners shape-safely and whose `afterEach` restores them without
`removeAllListeners`. The test bodies (already written) remain unchanged; they finally execute. As a
consistency touch in the same file, two `.length`-on-a-function listener-count reads (lines 607, 639)
are corrected to `process.listenerCount(...)`.

**Success Definition**:
- `npx vitest run tests/integration/prp-pipeline-shutdown.test.ts` → **20 passed | 0 failed** (was 20/20 fail).
- `npx vitest run tests/integration/prp-pipeline-shutdown.test.ts --reporter=dot` exits **0**.
- `npm run typecheck` clean on the edited file (no new TS errors).
- `npm run lint` clean on the edited file.
- `npm run format:check` clean on the edited file.
- After this item, `npx vitest run --reporter=dot` shows **this file green** and the overall failure
  count drops by 20 (other category-a/b files remain red — **out of scope**, owned by P1.M4.T2/T3).
- No production code (`src/**`) is modified. No `removeAllListeners` remains in the file. No raw
  `(process as any)._events` spread remains in the file.

## User Persona (if applicable)

**Target User**: Maintainer / pipeline operator running the test suite and the §4.4 `validate.sh`
abort-on-failure gate. End users are unaffected (test-only fix).

**Use Case**: `npm test` (=`vitest run`) must not abort the §4.4 validation gate on a test-setup bug;
the 20 graceful-shutdown tests must actually run and assert real `PRPPipeline.run()` signal handling.

**Pain Points Addressed**: All 20 shutdown tests fail in `beforeEach` (never reach their bodies), so
the SIGINT/SIGTERM graceful-shutdown contract (PRD §5.1) is silently unvalidated; `removeAllListeners`
in `afterEach` additionally destabilizes vitest's forks-pool worker across suites by nuking its own
signal handlers.

## Why

- **Unblocks the §4.4 validation gate.** With this file red, `npm test` exits 1 and the
  abort-on-failure path can never reach bug-hunt on an otherwise-green build (PRD §4.4 step 1).
- **Deterministic first fix (architecture-prescribed order).** The architecture doc says fix
  Category (c) first so failure counts stabilize before tackling environmental (a) and rot (b).
- **Restores real coverage.** Graceful shutdown — completing the in-flight task, saving backlog
  state, deduplicating signals, and the `--continue` resume path (PRD §5.1) — finally gets exercised.
- **Scope discipline.** Pure test-infra; zero risk to production behavior; disjoint from the
  parallel commit-format work.

## What

Edit **only** `tests/integration/prp-pipeline-shutdown.test.ts`:

1. **`beforeEach` (lines 99-127)** — Replace the fragile `(process as any)._events?.SIGINT ?
   [...(process as any)._events.SIGINT] : []` capture (throws on a single bare-function listener)
   with the shape-safe `process.listeners(signal)` API, for BOTH `SIGINT` and `SIGTERM`.
2. **`afterEach` (lines 130-149)** — Replace the two `process.removeAllListeners('SIGINT'/'SIGTERM')`
   calls + blanket re-add with a diff-based restore: remove only listeners present now that were NOT
   in the captured-before set, via `process.off(signal, listener)`. Re-adding the captured set is
   unnecessary and is what the diff avoids; the goal is "tear down only what the test added".
3. **Listener-count reads (lines 607, 639)** — Replace
   `(process as any)._events?.SIGINT?.length ?? 0` with `process.listenerCount('SIGINT')` (the former
   reads a single listener's **function arity**, not the count — semantically wrong, though currently
   masked by the loose `toBeLessThanOrEqual` assertion). Same intent, now correct.

The test bodies, the mock setup, the `setupMockSessionManager` helper, and the
`originalProcessListeners` type declaration (`Array<() => void>`) are unchanged in spirit.
`process.listeners()` returns `Function[]`, which is assignable to the existing
`Array<() => void>` annotation without edits; if TS objects, widen the annotation to `Function[]`.

### Success Criteria

- [ ] All 20 shutdown tests pass: `npx vitest run tests/integration/prp-pipeline-shutdown.test.ts` (20 | 0).
- [ ] No `removeAllListeners` call remains in the file.
- [ ] No `[...(process as any)._events` spread remains in the file.
- [ ] No `(process as any)._events` reference remains in the file (all replaced by official APIs).
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` clean on the edited file.
- [ ] No file under `src/` is modified.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP names the single file, the exact line ranges, the root cause (Node's documented single-listener
storage optimization), the idiomatic replacement APIs with their authoritative doc URLs, the
before/after code for both defects, the precise validation commands, and the scope boundary (no prod
changes, disjoint from the parallel item). No other codebase knowledge is required.

### Documentation & References

```yaml
# MUST READ — authoritative Node APIs that replace the broken _events internals
- url: https://nodejs.org/api/events.html#emitterlistenerseventname
  why: process.listeners(signal) ALWAYS returns a Function[] copy (even for 0 or 1 listener) —
       eliminates the "bare function not iterable" throw at the source.
  critical: This is the idiomatic, shape-independent replacement for spreading _events. Prefer it.

- url: https://nodejs.org/api/events.html#emitterlistenercounteventname
  why: process.listenerCount(signal) returns the correct count regardless of storage shape;
       replaces the lines-607/639 `.length`-on-a-function misread.

- url: https://nodejs.org/api/events.html#emitteroffeventname-listener
  why: process.off(signal, fn) removes ONE specific listener by reference — enables precise
       diff-based teardown in afterEach WITHOUT removeAllListeners.

- url: https://nodejs.org/api/events.html#emitterremovealllistenerseventname
  why: explains WHY removeAllListeners is destructive (removes ALL incl. vitest's own handlers)
       and must be avoided here.

- url: https://dev.to/captainsafia/node-module-deep-dive-eventemitter-3oeg
  why: plain-English explanation of the single-listener "f" optimization — "if there is only one
       listener for an event then it is set as a function value in the _events object rather than
       an array." Confirms the root cause of the spread throw.

# Project evidence / contract
- file: tests/integration/prp-pipeline-shutdown.test.ts
  why: THE file being edited. Single top-level describe; 20 `it` tests across sub-describes.
  pattern: beforeEach capture (lines 99-127, throw at 117/120); afterEach restore (130-149,
           removeAllListeners at 141-142); count reads at 607 & 639.
  gotcha: The whole file fails in beforeEach, so NO test body currently runs. Do NOT assume the
          bodies are broken — they are pre-written and correct; they simply never executed.

- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-004-test-suite.md
  why: Authoritative BUG-004 breakdown; §"Category (c)" names THIS exact bug and fix.
  section: "Category (c) — Genuine test bugs" + "NOTE on interaction with BUG-001/002/003" +
           "Order: fix (c) first (deterministic)".
  critical: Confirms "None of these are production-runtime defects — the pipeline code is in-spec."
            Scope is test-infra only.

- docfile: plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/P1M4T1S1/research/node-eventemitter-single-listener.md
  why: Condensed root-cause analysis + before/after code + file line evidence (companion to this PRP).
```

### Current Codebase tree (the single file in scope + neighbors)

```bash
tests/
  setup.ts                                  # vitest setupFiles entry (NOT edited)
  integration/
    prp-pipeline-shutdown.test.ts           # ← EDIT THIS (2036 lines, 20 tests)
    coder-agent.test.ts                     # category (b) — NOT in scope (P1.M4.T3.S1)
    pipeline-main-loop.test.ts              # category (b) — NOT in scope (P1.M4.T3.S2)
    smart-commit.test.ts                    # category (a) + parallel P1.M3.T2.S1 — NOT in scope
    core/task-orchestrator-e2e.test.ts      # category (a) — NOT in scope (P1.M4.T2)
src/workflows/prp-pipeline.ts               # production (READ-ONLY — do not touch)
vitest.config.ts                            # pool=forks, setup=./tests/setup.ts — NOT edited
```

### Desired Codebase tree with files to be added/edited

```bash
tests/integration/prp-pipeline-shutdown.test.ts   # EDIT (beforeEach + afterEach + 2 count lines)
# No files added. No files under src/ touched.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — Node EventEmitter "f" optimization:
//   0 listeners  -> _events[signal] === undefined
//   1 listener   -> _events[signal] === <the bare function>     (TRUTHY, NOT iterable!)
//   2+ listeners -> _events[signal] === Array<Function>
// Therefore BOTH of these are WRONG for the 1-listener case:
//   (process as any)._events?.SIGINT ? [...(process as any)._events.SIGINT] : []  // truthy guard FAILS
//   (process as any)._events?.SIGINT?.length ?? 0                                  // reads function ARITY
// USE the shape-independent public API instead:
//   process.listeners('SIGINT')      // -> Function[]  (always array copy)
//   process.listenerCount('SIGINT')  // -> number      (correct count)

// CRITICAL — process.removeAllListeners('SIGINT') removes EVERY SIGINT listener, including
// vitest's own Ctrl-C/abort handler installed by the forks-pool worker. Re-adding only the
// captured-before set does NOT restore listeners vitest registered later. Use process.off(signal, fn)
// to remove ONLY the listeners the test added (diff of current vs. captured-before).

// GOTCHA — the entire file currently fails in beforeEach, so test bodies NEVER ran. Once beforeEach
// is fixed, the pre-written bodies execute for the first time. If a body then fails, that is a
// SEPARATE (likely category-a/b) issue — do NOT expand scope; report it. The contract target is that
// these 20 bodies run; the architecture doc asserts the bodies are valid.

// GOTCHA — vi.clearAllMocks() in afterEach is fine to keep; it does not touch process listeners.
// Keep the two `await new Promise(r => setImmediate(r))` ticks before teardown — they let async
// signal handlers (process.emit inside test bodies) settle before listener diffing.
```

## Implementation Blueprint

### Data models and structure

No data models change. The existing local declaration is reused:

```ts
let originalProcessListeners: {
  SIGINT: Array<() => void>;
  SIGTERM: Array<() => void>;
};
```

`process.listeners()` returns `Function[]`. `Function[]` is assignable to `Array<() => void>` at the
capture site (a `Function` is assignable to the `() => void` slot in practice; if the project's strict
TS config complains, widen the slot type to `Function[]` or `Array<(...args: unknown[]) => void>` —
this is the ONLY type wiggle room and is explicitly permitted).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT tests/integration/prp-pipeline-shutdown.test.ts — beforeEach capture (lines 115-122)
  - REPLACE the four-line ternary-per-signal block:
      SIGINT: (process as any)._events?.SIGINT
        ? [...(process as any)._events.SIGINT]
        : [],
      SIGTERM: (process as any)._events?.SIGTERM
        ? [...(process as any)._events.SIGTERM]
        : [],
    WITH shape-safe capture via the public API:
      SIGINT: process.listeners('SIGINT') as Array<() => void>,
      SIGTERM: process.listeners('SIGTERM') as Array<() => void>,
  - WHY: process.listeners(signal) ALWAYS returns an array copy (0/1/N listeners), so it never
    throws "not iterable". This is the literal, robust realization of the contract's
    "guard with Array.isArray" intent — strictly safer (no _events internals at all).
  - ACCEPTABLE ALTERNATIVE (literal contract): if you prefer to keep _events access, the MINIMAL
    guard is:
      const getListeners = (sig: 'SIGINT'|'SIGTERM') => {
        const v = (process as any)._events?.[sig];
        return Array.isArray(v) ? [...v] : v ? [v] : [];
      };
    ...then SIGINT: getListeners('SIGINT'), SIGTERM: getListeners('SIGTERM').
    (process.listeners() is PREFERRED; this alternative is listed only to match the contract verbatim.)
  - PRESERVE: the rest of beforeEach (mock resets, mkdtempSync temp dir). Capture MUST run before
    `new PRPPipeline(...)` / `pipeline.run()` installs its own handlers.

Task 2: EDIT the same file — afterEach restore (lines 141-148)
  - REPLACE:
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      originalProcessListeners.SIGINT.forEach(listener => process.on('SIGINT', listener));
      originalProcessListeners.SIGTERM.forEach(listener => process.on('SIGTERM', listener));
    WITH diff-based teardown that removes ONLY test-added listeners:
      const beforeSigint = new Set(originalProcessListeners.SIGINT);
      for (const listener of process.listeners('SIGINT')) {
        if (!beforeSigint.has(listener as () => void)) {
          process.off('SIGINT', listener as (...args: unknown[]) => void);
        }
      }
      const beforeSigterm = new Set(originalProcessListeners.SIGTERM);
      for (const listener of process.listeners('SIGTERM')) {
        if (!beforeSigterm.has(listener as () => void)) {
          process.off('SIGTERM', listener as (...args: unknown[]) => void);
        }
      }
  - WHY: removes the pipeline's setupSignalHandlers listeners (added during run()) while leaving
    vitest's own signal handlers intact — satisfies "restore only the captured set, not removeAllListeners".
  - KEEP: the leading `await new Promise(r => setImmediate(r))` x2 (async signal-handler settle),
    `rmSync(tempDir, { recursive: true, force: true })`, and `vi.clearAllMocks()`. Re-order only if
    needed; teardown must come after the settle ticks.
  - OPTIONAL HARDENING (belt-and-suspenders): after the diff, also ensure every captured original
    listener is present (re-add any missing): `for (const l of originalProcessListeners.SIGINT)
    if (!process.listeners('SIGINT').includes(l)) process.on('SIGINT', l);` (likewise SIGTERM). This
    guards against a captured listener having been removed mid-test. Safe, idempotent, not required.

Task 3: EDIT the same file — listener-count reads (lines 607 and 639)
  - REPLACE (both occurrences):  const X = (process as any)._events?.SIGINT?.length ?? 0;
    WITH:                        const X = process.listenerCount('SIGINT');
    (line 607 is `initialSigintCount`, line 639 is `finalSigintCount`; the assertion at ~640
     `expect(finalSigintCount).toBeLessThanOrEqual(initialSigintCount)` stays UNCHANGED.)
  - WHY: with 1 listener, `_events.SIGINT.length` is the handler FUNCTION's arity (its declared
    parameter count), NOT the listener count — silently wrong. listenerCount is always correct.
  - SCOPE: these two lines are in the SAME file; they are a consistency fix, not new behavior.

Task 4: VERIFY (no edit)
  - RUN:  npx vitest run tests/integration/prp-pipeline-shutdown.test.ts
    EXPECT: 20 passed | 0 failed, exit 0.
  - RUN:  npx vitest run tests/integration/prp-pipeline-shutdown.test.ts --reporter=dot
    EXPECT: "Test Files  1 passed (1)" / "Tests  20 passed (20)".
  - RUN:  npm run typecheck && npm run lint && npm run format:check
    EXPECT: all clean (no new errors attributable to the edited file).
  - GREP guards (all must return ZERO matches in the file):
      grep -nE 'removeAllListeners'            tests/integration/prp-pipeline-shutdown.test.ts
      grep -nE '\[\.\.\.\(process as any\)\._events' tests/integration/prp-pipeline-shutdown.test.ts
      grep -nE '\(process as any\)\._events'   tests/integration/prp-pipeline-shutdown.test.ts
```

### Implementation Patterns & Key Details

```ts
// ── beforeEach (AFTER fix): shape-safe capture ────────────────────────────────
originalProcessListeners = {
  // process.listeners() ALWAYS returns an array copy — never throws, even when
  // Node stores a single listener as a bare function (the "f" optimization).
  SIGINT: process.listeners('SIGINT') as Array<() => void>,
  SIGTERM: process.listeners('SIGTERM') as Array<() => void>,
};

// ── afterEach (AFTER fix): diff-based teardown — NO removeAllListeners ────────
// Remove ONLY listeners added during the test (present now but not in the
// captured-before set). Preserves vitest's own SIGINT/SIGTERM handlers.
const restoreSignal = (signal: 'SIGINT' | 'SIGTERM', before: Array<() => void>) => {
  const beforeSet = new Set(before);
  for (const listener of process.listeners(signal)) {
    if (!beforeSet.has(listener as () => void)) {
      process.off(signal, listener as (...args: unknown[]) => void);
    }
  }
};
restoreSignal('SIGINT', originalProcessListeners.SIGINT);
restoreSignal('SIGTERM', originalProcessListeners.SIGTERM);

// ── count reads (AFTER fix): correct count regardless of storage shape ────────
const initialSigintCount = process.listenerCount('SIGINT');   // was _events?.SIGINT?.length ?? 0
const finalSigintCount = process.listenerCount('SIGINT');     // was _events?.SIGINT?.length ?? 0
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# This is a single-file test-infra edit. It interacts with vitest's forks-pool worker signal
# handlers (now preserved) and with PRPPipeline.run()'s internal setupSignalHandlers
# (src/workflows/prp-pipeline.ts — READ ONLY). The pipeline's handlers are added during run()
# and removed by the afterEach diff. No new imports beyond what is shown above.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing the single file:
npx tsc --noEmit -p tsconfig.build.json          # = npm run typecheck ; expect clean
npm run lint                                      # eslint . --ext .ts ; expect clean for the file
npm run format:check                              # prettier --check ; expect clean

# If prettier complains, run:  npx prettier --write tests/integration/prp-pipeline-shutdown.test.ts
# then re-run format:check.
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Unit/Integration Tests (the target file)

```bash
# THE primary gate — was 20/20 fail, must become 20/20 pass:
npx vitest run tests/integration/prp-pipeline-shutdown.test.ts
npx vitest run tests/integration/prp-pipeline-shutdown.test.ts --reporter=dot

# Expected: "Tests  20 passed (20)", "Test Files  1 passed (1)", exit code 0.
# If any of the 20 bodies NOW fails (it never ran before), read the failure:
#   - A "PiHarness not initialized" or research-seam error => category (a), NOT this item's scope;
#     report it but do not fix here (P1.M4.T2 owns harness-init).
#   - A model/expectation mismatch => category (b) rot; report, do not fix here (P1.M4.T3).
#   - A genuine signal-handling logic error in the BODY => fix ONLY if it is clearly a test bug in
#     the body; otherwise treat as a separate item. The contract target: bodies RUN.
```

### Level 3: System Validation (whole-suite delta check)

```bash
# Confirm this file is now green AND the overall count dropped by 20 (other files stay red — owned
# by sibling items; that is expected and NOT a regression of this item):
npx vitest run --reporter=dot 2>&1 | tail -n 20
# Expected: "tests/integration/prp-pipeline-shutdown.test.ts" NO LONGER in the failed-files list;
# overall "Tests failed" reduced by ~20 vs. the pre-fix baseline (~178-179 failed).

# Confirm no production regression by type-checking the whole project (cheap, catches stray edits):
npm run typecheck
# Expected: clean (no new errors).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Targeted grep guards — all must print NOTHING (proves the fragile patterns are gone):
grep -nE 'removeAllListeners'                  tests/integration/prp-pipeline-shutdown.test.ts
grep -nE '\[\.\.\.\(process as any\)\._events' tests/integration/prp-pipeline-shutdown.test.ts
grep -nE '\(process as any\)\._events'         tests/integration/prp-pipeline-shutdown.test.ts
# Expected: empty output for all three.

# Sanity: confirm the new APIs are present:
grep -nE "process\.listeners\('SIG(INT|TERM)'\)|process\.listenerCount\('SIGINT'\)|process\.off\('SIG(INT|TERM)'" \
     tests/integration/prp-pipeline-shutdown.test.ts
# Expected: matches at beforeEach capture, afterEach teardown, and the two count-read lines.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/integration/prp-pipeline-shutdown.test.ts` → 20 passed | 0 failed, exit 0.
- [ ] `npx vitest run --reporter=dot` no longer lists this file as failed (count drops ~20).
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean for the edited file.
- [ ] `npm run format:check` clean for the edited file.
- [ ] All three Level-4 grep guards return empty (no `removeAllListeners`, no `_events` spread, no
      `_events` reference).

### Feature Validation

- [ ] All 20 shutdown test bodies actually execute (they never did before — beforeEach threw).
- [ ] Graceful-shutdown contract (PRD §5.1) is now exercised: in-flight task completion, backlog
      state save, duplicate-SIGINT warning, `--continue` resume path.
- [ ] vitest's own signal handlers survive afterEach (worker stability across the file/suite).
- [ ] Intent preserved: listeners are still captured before and restored after each test.

### Code Quality Validation

- [ ] Follows the file's existing style (2-space indent, single quotes, trailing commas).
- [ ] No production code (`src/**`) modified — `git diff --stat` shows only the one test file.
- [ ] No new dependencies or imports beyond Node's built-in `process` API.
- [ ] Type annotation widened only if `Function[]`→`Array<() => void>` needs it (explicitly allowed).

### Documentation & Deployment

- [ ] No docs change required (test-infra fix; PRD §4.4/§5.1 already document the contract).
- [ ] Commit message follows the project's task-prefix format (owned by P1.M3; if that has landed,
      use `P1.M4.T1.S1: <subject>`; otherwise a clear `test(shutdown): <subject>` is fine). Do NOT
      prepend `[PRP Auto]` (forbidden per PRD §5.1 / BUG-003).

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" the spread by wrapping in `try/catch` that swallows the error — that hides the real
  shape problem and leaves `originalProcessListeners` empty, silently breaking the restore.
- ❌ Don't keep `removeAllListeners` and just re-add the captured set — that STILL wipes vitest's own
  handlers; the contract explicitly forbids `removeAllListeners`. Use the diff + `process.off`.
- ❌ Don't edit `src/workflows/prp-pipeline.ts` or any production file — the pipeline is in-spec; this
  is a test-only bug.
- ❌ Don't expand scope to other red files (coder-agent, pipeline-main-loop, smart-commit, the
  harness-init suites) — those are sibling items (P1.M4.T2/T3, P1.M3.T2.S1).
- ❌ Don't replace `_events?.SIGINT?.length ?? 0` (lines 607/639) with another `_events` access — use
  `process.listenerCount('SIGINT')`; `.length` reads a single listener's function arity, not the count.
- ❌ Don't remove the two `await new Promise(r => setImmediate(r))` settle ticks in afterEach — async
  signal handlers emitted inside test bodies need them to flush before teardown.

---

## Confidence Score

**9/10** — one-pass success likelihood. The defect is fully diagnosed (root cause = Node's documented
single-listener storage shape), the fix is a 1-file edit with exact before/after code, the replacement
APIs are the idiomatic public Node surface (`process.listeners` / `process.listenerCount` /
`process.off`), the validation command is unambiguous (20/20 → green), and the scope is cleanly
bounded with explicit out-of-scope siblings and a disjoint parallel item. The only residual uncertainty
is whether any of the 20 previously-unrun bodies exposes a *separate* category-a/b defect on first
execution — the PRP tells the implementer exactly how to recognize and NOT expand scope in that case.