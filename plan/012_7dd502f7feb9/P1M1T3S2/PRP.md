# PRP — P1.M1.T3.S2: Refactor `createCommitMessageAgent` to accept a dynamic system prompt

> PRD §5.1 **"Commit Message Style (Learning & Explicit Modes)"** → **"Mode-conditional system
> prompt."** This subtask makes the `stagecoach` agent factory accept an OPTIONAL `systemPrompt`
> argument so the style-conditional prompt built by **P1.M1.T3.S1** can flow into the agent. The
> change is a one-line logic edit (`system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM`) plus a JSDoc
> update and one test case. Architecture spec:
> `plan/012_7dd502f7feb9/architecture/implementation-status.md §F1.E` ("Factory change").

---

## Goal

**Feature Goal**: Change `createCommitMessageAgent()` → `createCommitMessageAgent(systemPrompt?: string)`
so a caller can supply the dynamic, style-resolved system prompt. The factory defaults to the existing
`plain` contract (`COMMIT_MESSAGE_SYSTEM`) when no prompt is passed, preserving byte-for-byte backward
compatibility. All other `baseConfig` overrides (`name: 'CommitMessageAgent'`, `maxTokens: 512`,
`enableReflection: false`, `enableCache: false`, `stateless: true`, plus `model`/`harness`/`env` via
spread) are UNCHANGED.

**Deliverable**:
1. **`src/agents/commit-message-agent.ts`** — (a) factory signature gains optional `systemPrompt?: string`;
   (b) the config object's `system:` field becomes `systemPrompt ?? COMMIT_MESSAGE_SYSTEM`; (c) the
   factory's JSDoc is updated (Mode A) to document the new param, its default, and an `@example`
   showing both the no-arg and custom-prompt forms. **`COMMIT_MESSAGE_SYSTEM` itself is UNCHANGED**;
   every other config field is UNCHANGED.
2. **`tests/unit/agents/commit-message-agent.test.ts`** — add one (or two) `it()` case(s) inside the
   existing `describe('createCommitMessageAgent')` block asserting the prompt passthrough and the
   default. All 10 existing factory tests stay GREEN untouched.

**Success Definition**:
- `createCommitMessageAgent('CUSTOM')` produces an agent whose captured `config.system === 'CUSTOM'`.
- `createCommitMessageAgent()` (no args) still sets `config.system` to the `plain` contract
  (`COMMIT_MESSAGE_SYSTEM`) — identical to today (verified by the existing L129 test staying GREEN,
  which asserts `cfg.system` contains `'imperative'`, `'[PRP Auto]'`, `'Co-Authored-By'`).
- All other config fields (`name`, `model`, `harness`, `env`, `maxTokens`, `enableReflection`,
  `enableCache`, `stateless`) are identical for both call forms.
- `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (new case(s) + 10 existing).
- `npm run typecheck` exit 0; `npm run lint` clean; `npm run format:check` clean.
- **No other files modified.** No `COMMIT_MESSAGE_SYSTEM` edit, no `buildCommitMessageSystemPrompt`
  change (that is T3.S1), no `generateCommitMessage` wiring (that is T4.S1), no docs (P1.M3 milestone).

## User Persona

N/A — internal pipeline factory. Indirect "users" are (a) **P1.M1.T4.S1** (`generateCommitMessage`),
which will call `createCommitMessageAgent(buildCommitMessageSystemPrompt(style, examples))`, and
(b) any existing caller that still invokes the factory with no args (e.g. `src/utils/git-commit.ts:321`
today), which must keep working unchanged.

## Why

- **Closes the §5.1 "Mode-conditional system prompt" data path at the factory.** The four styles
  conflict (`plain` forbids a type prefix; `conventional` requires one; `gitmoji` requires an emoji),
  so the agent's system prompt must be supplied dynamically. T3.S1 built the prompt; this task makes
  the factory *accept* it. T4.S1 wires the two together.
- **Strictly backward compatible.** An OPTIONAL parameter with a `?? COMMIT_MESSAGE_SYSTEM` default
  means every existing no-arg caller (the production call site, the 10 existing tests, the two
  `vi.fn()` module mocks) continues to behave identically.
- **Tiny, low-risk, surgical.** One optional parameter, one `??` default, a JSDoc refresh, one test.
  No new files, no deps, no env reads, no I/O.

## What

### User-visible behavior
None directly. Indirectly (once T4.S1 lands): the `stagecoach` agent generates commit messages whose
descriptive-message style matches the resolved `PRP_COMMIT_STYLE`, because the factory now honors a
caller-supplied prompt instead of always using the hardcoded `plain` contract.

### Technical requirements (exact contract)

**Signature:**
```ts
export function createCommitMessageAgent(systemPrompt?: string): Agent
```

**Body — the ONLY logic change is the `system:` line:**
```ts
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,   // ← was: system: COMMIT_MESSAGE_SYSTEM
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true,
  };
```

- `systemPrompt ?? COMMIT_MESSAGE_SYSTEM`: when `systemPrompt` is `undefined` (no arg passed) OR an
  explicit `undefined`, the `plain` contract is used — identical to today. (Note: `??` deliberately
  also falls back on an empty-string argument; this matches "no usable prompt supplied → plain." Do
  not use `||` — there is no behavioral difference here, but `??` is the correct intent: only
  `null`/`undefined` should trigger the default. If you want an empty string to be treated as
  "use plain," that is fine and equivalent here since an agent should never be given an empty system
  prompt; the PRD makes no special case for `""`.)
- **Every other `config` field is UNCHANGED** (name/model/harness/env via `...baseConfig`, plus the
  five explicit overrides). Do not reorder, rename, or re-type them.
- **JSDoc (Mode A):** update the factory's `/** … */` block (immediately above the `export function`):
  - Add `@param systemPrompt — Optional custom system prompt. Defaults to the {@link COMMIT_MESSAGE_SYSTEM}
    plain contract for backward compatibility (existing no-arg callers get identical behavior). When
    provided, it overrides the default — consumed by {@link generateCommitMessage} (P1.M1.T4.S1),
    which passes the style-resolved prompt from {@link buildCommitMessageSystemPrompt}
    (P1.M1.T3.S1).`
  - Refresh `@example` to show BOTH forms:
    ```ts
    // Default (plain contract) — existing behavior:
    const agent = createCommitMessageAgent();
    // Dynamic prompt (style-resolved by buildCommitMessageSystemPrompt):
    const styled = createCommitMessageAgent(buildCommitMessageSystemPrompt('conventional'));
    ```
  - Keep the existing `@remarks` / `@returns` text; only the parameter + example change.

### Success Criteria
- [ ] Factory signature is `createCommitMessageAgent(systemPrompt?: string): Agent`.
- [ ] `system:` field uses `systemPrompt ?? COMMIT_MESSAGE_SYSTEM`; all other fields unchanged.
- [ ] `createCommitMessageAgent('X')` → captured `config.system === 'X'`.
- [ ] `createCommitMessageAgent()` → `config.system` equals the `plain` contract (`COMMIT_MESSAGE_SYSTEM`).
- [ ] JSDoc documents the optional param, its default, and a two-form `@example` (Mode A).
- [ ] All 10 existing `createCommitMessageAgent` tests stay GREEN with NO edits.
- [ ] `COMMIT_MESSAGE_SYSTEM` const UNCHANGED; `buildCommitMessageSystemPrompt` UNCHANGED.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN; `npm run typecheck`
      exit 0; `npm run lint` + `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
current factory (verbatim, with the line that changes), the exact target edit (`??` default), the
JSDoc shape to follow, the test mock setup that makes the new case trivial, the verification that
existing no-arg callers and `vi.fn()` mocks stay green, the scope boundary (do not touch the builder,
the wiring, or the docs), and the verified validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the architecture pin for this exact task
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F1.E — Dynamic system-prompt builder" → the "Factory change" code block at the end of §F1.E
  why: Pins the target signature `createCommitMessageAgent(systemPrompt?: string): Agent` and the exact
        body line `system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM`.
  critical: §F1.E's NEW function `buildCommitMessageSystemPrompt(...)` is T3.S1, NOT this task. This
        task only changes the FACTORY signature + system line + JSDoc.

# AUTHORITATIVE SPEC — the style-layer PRD text
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Message Style")
  section: §5.1 "Commit Message Style (Learning & Explicit Modes)" → "Mode-conditional system prompt"
  why: Justifies WHY the factory must accept a dynamic prompt (the four modes conflict, so the system
        prompt is built dynamically and passed in). Also confirms `COMMIT_MESSAGE_SYSTEM` becomes the
        `plain` contract (still the default here).

# PARALLEL PREDECESSOR (read as a CONTRACT) — what will exist when this task runs
- docfile: plan/012_7dd502f7feb9/P1M1T3S1/PRP.md
  section: "Goal" / "Success Definition" / "Integration Points → EXPORTS"
  why: T3.S1 adds `export function buildCommitMessageSystemPrompt(style, examples?): string` + NEW
        module-private consts to THIS SAME FILE, placed AFTER `COMMIT_MESSAGE_SYSTEM` and BEFORE
        `createCommitMessageAgent`. It does NOT touch the factory or `COMMIT_MESSAGE_SYSTEM`.
  critical: At execution time the factory may sit a few lines lower in the file than today (L108);
        LOCATE IT BY ITS `export function createCommitMessageAgent` TEXT, not by line number. The
        JSDoc `@example` referencing `buildCommitMessageSystemPrompt` will resolve correctly once
        T3.S1 has landed.

# EDIT TARGET — the file being changed (read it first; locate factory by grep)
- file: src/agents/commit-message-agent.ts
  section: `export function createCommitMessageAgent(): Agent` (~L108) and its preceding JSDoc (~L87–106)
  why: The signature gains `systemPrompt?: string`; the `system: COMMIT_MESSAGE_SYSTEM,` line (~L113)
        becomes `system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,`. JSDoc above gains `@param` + a
        refreshed `@example`.
  pattern: Module-private const `COMMIT_MESSAGE_SYSTEM` is returned verbatim by the default path;
        mirror the file's existing JSDoc style (`@remarks` / `@param` / `@example` fences).
  gotcha: Do NOT touch `COMMIT_MESSAGE_SYSTEM`, the NEW T3.S1 consts, or `buildCommitMessageSystemPrompt`.

# CONSUMER (downstream — reference only; do NOT implement)
- file: src/utils/git-commit.ts
  section: L37 (import), L321 (`const agent = createCommitMessageAgent();`)
  why: The ONLY production call site today. It passes no args → stays valid (optional param). T4.S1
        will change L321 to pass `buildCommitMessageSystemPrompt(style, examples)`; that is NOT this task.
  gotcha: Leave L321 exactly as-is. Editing it is T4.S1's scope.

# TEST PATTERN — the test file being extended
- file: tests/unit/agents/commit-message-agent.test.ts
  section: `describe('createCommitMessageAgent', () => { … })` (10 existing `it()` cases, all no-arg)
  why: Mirror its `expect((mockCreateAgent.mock.calls[N][0] as …).<field>)` assertion shape. The module
        mocks (`agent-factory.js` → fixed baseConfig fixture; `groundswell` → `createAgent: vi.fn(cfg => ({__cfg: cfg}))`)
        already capture the config — the new case just reads `mockCreateAgent.mock.calls.at(-1)[0].system`.
  gotcha: Use `mockCreateAgent.mock.calls.at(-1)` (or `.lastCall`) so the new assertion is order-independent;
        the 10 existing no-arg calls also populate `.mock.calls`. Do NOT edit any existing `it()`.

# BACKWARD-COMPAT VERIFICATION — other tests that mock the factory (stay green, do NOT edit)
- file: tests/unit/utils/git-commit.test.ts
  section: L31/L64/L85 (`vi.mock('…commit-message-agent.js', () => ({ createCommitMessageAgent: vi.fn() }))`)
  why: Confirms an OPTIONAL parameter is backward compatible — these `vi.fn()` mocks and the no-arg
        production call site are unaffected by the signature widening.
- file: tests/unit/protected-files.test.ts
  section: L34 (same module mock pattern)
  why: Same — unaffected by optional-param widening.

# RESEARCH NOTE (this task) — copy-ready test cases + line map
- docfile: plan/012_7dd502f7feb9/P1M1T3S2/research/factory-refactor.md
  section: "5. New test to ADD", "1. The exact current state of the factory", "7. Relationship to parallel T3.S1"
  why: The exact `it()` bodies to paste, the before/after of the factory, and the note to locate the
        factory by text (T3.S1 shifts it down).
```

### Current Codebase tree (edit surface)

```bash
src/agents/commit-message-agent.ts        # EDIT: factory signature + `system:` line + JSDoc only
  ├─ const COMMIT_MESSAGE_SYSTEM (~L64)   # UNCHANGED (the plain contract; default of the `??`)
  ├─ [T3.S1 additions: buildCommitMessageSystemPrompt + new consts]  # UNCHANGED (parallel task, may already exist)
  └─ function createCommitMessageAgent (~L108, shifted if T3.S1 landed)  ← EDIT signature + system line + JSDoc
       └─ system: COMMIT_MESSAGE_SYSTEM   →   system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM

src/utils/git-commit.ts                   # READ-ONLY (L321 calls factory with no args) — T4.S1 owns wiring
tests/unit/utils/git-commit.test.ts       # READ-ONLY (module mock; unaffected by optional param)
tests/unit/protected-files.test.ts        # READ-ONLY (module mock; unaffected)

tests/unit/agents/commit-message-agent.test.ts   # EDIT: add 1–2 it() cases inside existing describe
```

### Desired Codebase tree with files to be changed
```bash
src/agents/commit-message-agent.ts        # EDIT — factory signature + system line + JSDoc
tests/unit/agents/commit-message-agent.test.ts  # EDIT — add passthrough + default it() cases
# (no new files; no other files touched)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (scope): This task changes ONLY the factory signature, the single `system:` line, the
//   factory JSDoc, and the one new test. Do NOT touch COMMIT_MESSAGE_SYSTEM, the T3.S1 builder/
//   consts, generateCommitMessage, or any docs file.

// CRITICAL (backward compat): The parameter MUST be optional (`systemPrompt?: string`) and the
//   default MUST be `?? COMMIT_MESSAGE_SYSTEM`. Existing no-arg callers (production L321, the 10
//   existing tests, the two vi.fn() module mocks) must behave byte-for-byte identically.

// GOTCHA (locate by text, not line number): T3.S1 (parallel) inserts new consts + the builder ABOVE
//   the factory, so `createCommitMessageAgent` will sit a few lines lower than today's ~L108. Grep
//   for `export function createCommitMessageAgent` to find it. Do not trust hardcoded line numbers.

// GOTCHA (test ordering): The existing describe block has 10 no-arg calls that all append to
//   `mockCreateAgent.mock.calls`. Read the LATEST call in the new assertion via
//   `mockCreateAgent.mock.calls.at(-1)![0]` (or `mockCreateAgent.mock.lastCall`) — do not use a
//   fixed index, and do not call `mockCreateAgent.mockClear()` (would interfere with sibling tests).

// GOTCHA (JSDoc @example cross-reference): The refreshed @example references
//   `buildCommitMessageSystemPrompt` (T3.S1's export). That symbol will exist in-file once T3.S1 has
//   landed, so the `{@link}`/example resolves. Do NOT add a runtime import of it in the factory —
//   the factory only takes a STRING; wiring the builder into the call site is T4.S1's job.

// GOTCHA (format): The edited JSDoc must pass `npm run format:check` (prettier). If it flags, run
//   `npm run format` (writes) then re-check. Emoji-free edit, so this is the only likely nit.
```

## Implementation Blueprint

### Data models and structure
N/A — no data models. The factory still returns a `Groundswell Agent`. The only new "structure" is the
optional `string` parameter. `PrpCommitStyle` / the prompt builder live in T3.S1; this factory just
receives a resolved `string`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/commit-message-agent.ts — widen the factory signature + system default + JSDoc
  - LOCATE: grep for `export function createCommitMessageAgent` (may be ~L108, shifted by T3.S1).
  - (a) SIGNATURE: `export function createCommitMessageAgent(): Agent {`
            → `export function createCommitMessageAgent(systemPrompt?: string): Agent {`
  - (b) SYSTEM LINE: `    system: COMMIT_MESSAGE_SYSTEM,`
            → `    system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,`
        (the ONLY logic change; every other config field — name, maxTokens, enableReflection,
         enableCache, stateless, and the spread model/harness/env — stays byte-identical).
  - (c) JSDOC (Mode A): in the `/** … */` block immediately above the `export function`:
        * ADD `@param systemPrompt` documenting the optional prompt, its default (the plain contract
          COMMIT_MESSAGE_SYSTEM, for backward compat), and that it is consumed by generateCommitMessage
          (P1.M1.T4.S1) which passes the style-resolved prompt from buildCommitMessageSystemPrompt
          (P1.M1.T3.S1).
        * REFRESH `@example` to show BOTH the no-arg (default) and custom-prompt forms (see research
          note §3 for copy-ready text).
        * KEEP existing @remarks/@returns; only param + example change.
  - DO NOT: touch COMMIT_MESSAGE_SYSTEM, buildCommitMessageSystemPrompt, any T3.S1 const, or the
        logger()/return lines.

Task 2: EDIT tests/unit/agents/commit-message-agent.test.ts — add passthrough + default cases
  - LOCATE: the existing `describe('createCommitMessageAgent', () => { … })` block (10 it() cases).
  - ADD one (or two) it() cases INSIDE that describe (AFTER the last existing case), using
        `mockCreateAgent.mock.calls.at(-1)![0]` (or `.lastCall`) to read the captured config:
        * it('should use a supplied systemPrompt when provided (dynamic prompt passthrough)', …):
            createCommitMessageAgent('CUSTOM PLAIN CONTRACT TEXT');
            expect((mockCreateAgent.mock.calls.at(-1)![0] as { system: string }).system)
              .toBe('CUSTOM PLAIN CONTRACT TEXT');
        * it('should default to the plain COMMIT_MESSAGE_SYSTEM when no prompt is supplied', …):
            createCommitMessageAgent();
            const sys = (mockCreateAgent.mock.calls.at(-1)![0] as { system: string }).system;
            expect(sys).toContain('imperative');
            expect(sys).toContain('HARD RULES');   // robust substring of COMMIT_MESSAGE_SYSTEM
  - FOLLOW pattern: the file's existing `expect((mockCreateAgent.mock.calls[N][0] as …).<field>)`
        shape; use `.at(-1)` / `.lastCall` rather than a fixed index (10 prior no-arg calls populate
        `.mock.calls`).
  - DO NOT: edit any of the 10 existing it() cases, change the module mocks, or call mockClear().
  - PRESERVE: all existing tests stay GREEN untouched (backward compatibility is the whole point).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the entire edit, before → after
// BEFORE (today):
export function createCommitMessageAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true,
  };
  logger().debug({ persona: 'researcher', model: config.model }, 'Creating commit-message agent');
  return createAgent(config);
}

// AFTER (this task):
export function createCommitMessageAgent(systemPrompt?: string): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true,
  };
  logger().debug({ persona: 'researcher', model: config.model }, 'Creating commit-message agent');
  return createAgent(config);
}

// PATTERN: new test assertion reads the LATEST captured config (order-independent)
it('should use a supplied systemPrompt when provided (dynamic prompt passthrough)', () => {
  createCommitMessageAgent('CUSTOM PLAIN CONTRACT TEXT');
  const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { system: string };
  expect(cfg.system).toBe('CUSTOM PLAIN CONTRACT TEXT');
});

// GOTCHA (above): every other config field is identical for both call forms — the 10 existing tests
//   already assert name/maxTokens/enableReflection/enableCache/stateless and stay GREEN because the
//   default path (no arg) yields the same config object as before.
// GOTCHA (above): do NOT import buildCommitMessageSystemPrompt into the factory — it only takes a
//   string. Wiring builder→factory is T4.S1.
```

### Integration Points
```yaml
SIGNATURE (src/agents/commit-message-agent.ts):
  - change: "export function createCommitMessageAgent(systemPrompt?: string): Agent"
  - default: "system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM"

JSDOC (src/agents/commit-message-agent.ts):
  - add: "@param systemPrompt …"  (Mode A docs)
  - refresh: "@example" (two forms: no-arg default + custom prompt)

DOWNSTREAM CONSUMERS (NOT this task — reference only):
  - T4.S1 (src/utils/git-commit.ts L321): will call createCommitMessageAgent(buildCommitMessageSystemPrompt(style, examples)).
  - All current no-arg callers (production L321 today; the 10 tests; the 2 vi.fn() module mocks) are
    unaffected by the optional-parameter widening.

NONE OF: COMMIT_MESSAGE_SYSTEM (unchanged), buildCommitMessageSystemPrompt/T3.S1 consts (unchanged),
         src/utils/git-commit.ts body (T4.S1), docs/* (P1.M3), PRD.md, spec, tasks.json.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check **/*.{ts,js,json,md,yml,yaml} — clean (run `npm run format` if it flags the JSDoc)
# Expected: zero errors. The edit is emoji-free, so the only likely nit is JSDoc indentation → fixed by `npm run format`.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # new case(s) + ALL 10 existing createCommitMessageAgent tests GREEN
# Expected: every it() passes. If the passthrough test fails, confirm the `system:` line reads
#   `systemPrompt ?? COMMIT_MESSAGE_SYSTEM` and the test reads `.calls.at(-1)` (not a fixed index).
#   If the default test fails, confirm no-arg callers still hit the `?? COMMIT_MESSAGE_SYSTEM` branch.
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm backward compatibility — the no-arg call site + sibling tests are untouched & green.
grep -n 'createCommitMessageAgent' src/utils/git-commit.ts   # L321 STILL reads createCommitMessageAgent() (no args) — T4.S1 changes it, NOT this task
npx vitest run tests/unit/utils/git-commit.test.ts tests/unit/protected-files.test.ts   # the vi.fn() module mocks still compile & pass
npm run typecheck   # consumer + sibling test files still typecheck against the widened (optional-param) signature
# Expected: L321 unchanged; sibling suites GREEN; typecheck green. No behavior change for any no-arg caller.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual sanity: prove both call forms produce the expected system prompt (no agent call needed).
npx tsx -e "import { createCommitMessageAgent } from './src/agents/commit-message-agent.js'; import { createAgent } from 'groundswell'; const calls: any[] = []; (createAgent as unknown) = ((c:any)=>{calls.push(c);return {__cfg:c};}); const g = require('groundswell'); const orig = g.createAgent; g.createAgent = (c:any)=>{calls.push(c);return {__cfg:c};}; createCommitMessageAgent(); createCommitMessageAgent('CUSTOM'); console.log('default starts with:', JSON.stringify(calls[0].system.slice(0,40))); console.log('custom is:', JSON.stringify(calls[1].system));"
# Simpler alternative if the one-liner above is awkward (mock-free, just confirms the type compiles + default string flows):
npx tsx -e "import { createCommitMessageAgent } from './src/agents/commit-message-agent.js'; console.log(typeof createCommitMessageAgent);"
# Expected: 'function'. (Full passthrough is already proven by the Level 2 unit test; this is a smoke check.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–3 pass; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (new case(s) + 10 existing).
- [ ] `COMMIT_MESSAGE_SYSTEM` const byte-for-byte UNCHANGED; `buildCommitMessageSystemPrompt` UNCHANGED.

### Feature Validation
- [ ] `createCommitMessageAgent('X')` → captured `config.system === 'X'` (proven by the new passthrough test).
- [ ] `createCommitMessageAgent()` → `config.system` equals the plain contract (existing L129 test stays GREEN + new default test).
- [ ] All other config fields identical for both call forms (existing name/maxTokens/reflection/cache/stateless tests cover the no-arg path).

### Code Quality Validation
- [ ] Optional parameter (`systemPrompt?`), not required — preserves backward compatibility.
- [ ] `?? COMMIT_MESSAGE_SYSTEM` default (correct nullish intent, not `||`).
- [ ] JSDoc (Mode A) documents the param, its default, and a two-form `@example`.
- [ ] Factory located by `export function` text (not stale line number) in case T3.S1 shifted it.
- [ ] New test reads `mockCreateAgent.mock.calls.at(-1)` (order-independent); no `mockClear()`.

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M3 owns changeset docs — separate milestone).
- [ ] No env-var additions, no new deps, no new files.

---

## Anti-Patterns to Avoid
- ❌ Don't make `systemPrompt` a REQUIRED parameter — it must be optional (`?`) so every existing no-arg caller stays green.
- ❌ Don't change anything other than the signature, the `system:` line, the factory JSDoc, and the one new test. `COMMIT_MESSAGE_SYSTEM`, the T3.S1 builder/consts, `generateCommitMessage`, and docs are all out of scope.
- ❌ Don't wire the builder into the factory or the call site — that is T4.S1. The factory only takes a resolved `string`.
- ❌ Don't use a fixed `mock.calls[N]` index in the new test — 10 prior no-arg calls populate the array; use `.at(-1)` / `.lastCall`.
- ❌ Don't trust line numbers — locate `createCommitMessageAgent` by its `export function` text (T3.S1 inserts content above it).
- ❌ Don't import `buildCommitMessageSystemPrompt` into the factory just to make the JSDoc `{@link}`/example "work" — the symbol is in-file after T3.S1; the factory needs no runtime import of it.
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted test file (Level 2) for the component under change.

---

## Confidence Score
**9.5 / 10** — one-pass success. The edit is a single optional-parameter widening with a `??` default
that is provably backward compatible (existing no-arg callers and `vi.fn()` mocks are unaffected by
construction), plus a JSDoc refresh and one order-independent assertion. The only residual risk is a
prettier nit on the edited JSDoc, trivially resolved by `npm run format`. The contract is pinned in
architecture §F1.E and the predecessor T3.S1 PRP.