# PRP — P1.M1.T4.S1: Wire Style Resolution into `generateCommitMessage`

> PRD §5.1 **"Commit Message Style (Learning & Explicit Modes)"** → **"Mode-conditional system
> prompt."** This is the FINAL wiring subtask of the Commit Message Style Layer. It modifies
> `generateCommitMessage(diff)` in `src/utils/git-commit.ts` to resolve the configured
> `PRP_COMMIT_STYLE`, fetch recent-commit examples when in `auto` mode, build the dynamic
> system prompt, and pass it to `createCommitMessageAgent(system)`. Architecture spec:
> `plan/012_7dd502f7feb9/architecture/implementation-status.md §F1.F`.

---

## Goal

**Feature Goal**: Make `generateCommitMessage(diff)` produce **style-aware** descriptive commit
messages. Before creating the stagecoach agent, the function now resolves the style mode
(`getPrpCommitStyle()`), and — when `auto` — fetches the last `N` commit messages
(`getRecentCommitMessages(N)`, N = `getPrpCommitStyleExamples()`) as style examples, degrading to
`plain` when there is insufficient history (≤1 example) or learning is disabled (`EXAMPLES=0`). It
then builds the mode-conditional system prompt (`buildCommitMessageSystemPrompt`) and passes it to
the agent factory (`createCommitMessageAgent(system)`). The rest of the function — `createPrompt`,
the `agent.prompt` call, and the empty/error/sentinel output handling — is UNCHANGED.

**Deliverable**:
1. **`src/utils/git-commit.ts`** — (a) add four imports (`getRecentCommitMessages`,
   `buildCommitMessageSystemPrompt`, `getPrpCommitStyle`, `getPrpCommitStyleExamples`) plus a
   `PrpCommitStyle` type import; (b) insert the style-resolution block into `generateCommitMessage`
   between the empty-diff guard and `createPrompt`, replacing the bare
   `createCommitMessageAgent()` with `createCommitMessageAgent(system)`; (c) update the
   `generateCommitMessage` JSDoc (Mode A) to document the style-resolution flow.
2. **`tests/unit/utils/git-commit.test.ts`** — extend the two module mocks with
   `getRecentCommitMessages` and `buildCommitMessageSystemPrompt`, add a default return value for
   the git-log mock in `beforeEach`, and add a new `describe` block asserting all six
   style-resolution branches (auto + >1 examples / auto + ≤1 / auto + EXAMPLES=0 / plain /
   conventional / gitmoji) plus the custom-examples-count flow. All existing
   `generateCommitMessage` + `smartCommit` tests stay GREEN.

**Success Definition**:
- `PRP_COMMIT_STYLE=auto` (default) in a repo with ≥2 commits → `getRecentCommitMessages(N)` is
  called once, `buildCommitMessageSystemPrompt('auto', examples)` produces the learned-style META
  block, and `createCommitMessageAgent` receives that prompt.
- `PRP_COMMIT_STYLE=auto` in a repo with ≤1 commit (or `EXAMPLES=0`) → degrades to `plain`;
  `getRecentCommitMessages` is NOT called under `EXAMPLES=0`; factory receives the `plain` contract.
- `PRP_COMMIT_STYLE=conventional|gitmoji|plain` → `getRecentCommitMessages` is NEVER called; the
  factory receives the explicit mode's contract.
- All 13 existing `generateCommitMessage` tests stay GREEN untouched (the default auto → empty-mock
  → degrade-to-plain path is behaviorally identical to today's fixed `plain` contract).
- `npm run typecheck` exit 0; `npm run lint` clean; `npm run format:check` clean.
- `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN.
- **No other source files modified.** `formatCommitMessage`, the retry/fallback structure in
  `smartCommit`, `createCommitMessageAgent` body (T3.S2), `buildCommitMessageSystemPrompt` body
  (T3.S1), and `getRecentCommitMessages` body (T2.S1) are all UNCHANGED.

## User Persona

N/A — internal pipeline function. Indirect "users": (a) `smartCommit`'s `generateMessage` path,
which is the sole caller of `generateCommitMessage`; (b) developers who set `PRP_COMMIT_STYLE` /
`PRP_COMMIT_STYLE_EXAMPLES` to control commit-message tone.

## Why

- **Closes the §5.1 "Mode-conditional system prompt" data path end-to-end.** T1.S1 added the config
  getters + `PrpCommitStyle` type; T2.S1 added `getRecentCommitMessages`; T3.S1 added the
  `buildCommitMessageSystemPrompt` builder; T3.S2 widened `createCommitMessageAgent` to accept a
  dynamic prompt. This task is the one call site that CONSUMES all four and threads them together.
- **Makes the descriptive commit message match the project's voice.** Under `auto`, the agent now
  sees the last N commits and matches their style (Conventional-Commit, gitmoji, or plain prose)
  instead of always emitting the fixed `plain` contract.
- **Strictly additive at the call site.** The new logic is a self-contained block before agent
  creation; every downstream step (prompt, agent call, error/sentinel handling, the
  `formatCommitMessage` wrap, retry, fallback) is byte-for-byte unchanged.

## What

### User-visible behavior
Indirectly (only via `smartCommit({ generateMessage: true })`): the LLM-generated descriptive commit
message now reflects the resolved `PRP_COMMIT_STYLE` — matching recent history under `auto`, or an
explicit Conventional-Commits / gitmoji / plain contract. The position prefix and
`Co-Authored-By` trailer are layered afterward by `formatCommitMessage`, exactly as today.

### Technical requirements (exact contract)

**Logic to insert** in `generateCommitMessage`, BETWEEN the empty-diff guard and the
`const agent = createCommitMessageAgent()` line (which becomes
`createCommitMessageAgent(system)`):

```ts
  // === STYLE RESOLUTION (PRD §5.1 "Commit Message Style" — P1.M1.T4.S1) ===
  const style = getPrpCommitStyle();
  let resolvedStyle: PrpCommitStyle = style;
  let examples: string[] | undefined;
  if (style === 'auto') {
    const n = getPrpCommitStyleExamples();
    if (n > 0) {
      examples = await getRecentCommitMessages(n);
    }
    // ≤1 commit (or EXAMPLES=0 → examples stays undefined) → nothing to learn
    // → degrade to the plain contract (PRD §5.1).
    if (!examples || examples.length <= 1) {
      resolvedStyle = 'plain';
    }
  }
  const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);
  const agent = createCommitMessageAgent(system);
```

- The `if (n > 0)` gate means `getRecentCommitMessages` is called ONLY when auto + a positive
  example count. `EXAMPLES=0` → `examples` stays `undefined` → `!examples` → degrade to plain.
- `getRecentCommitMessages` itself also short-circuits on `count === 0` (returns `[]` with no git
  call), so even a hypothetical `n === 0` that slipped the gate would be a no-op.
- `generateCommitMessage` is ALREADY `async`, so `await getRecentCommitMessages(n)` is valid.
- The empty-diff guard (`if (!diff || !diff.trim()) throw …`) stays FIRST — empty-diff failures never
  reach style resolution (preserves the existing empty-diff test behavior).
- **Everything after `const agent = …` is UNCHANGED**: `createPrompt`, `agent.prompt`, the
  `status === 'error'` throw, the `message === 'skip'` sentinel throw, the `.trim()` + return.

**Imports to add** at the top of `src/utils/git-commit.ts`:
- In the `git-mcp.js` import block (L23–31): add `getRecentCommitMessages`.
- In the `commit-message-agent.js` import (L37): add `buildCommitMessageSystemPrompt`.
- In the `config/constants.js` import (L39–44): add `getPrpCommitStyle`, `getPrpCommitStyleExamples`.
- NEW line: `import type { PrpCommitStyle } from '../config/constants.js';` (follow the file's
  existing `import { …, type Logger } from './logger.js';` convention — a standalone `import type`
  line is cleanest here since the value imports and the type import are conceptually distinct).

**JSDoc (Mode A)** — update the `/** … */` block on `generateCommitMessage` to document:
- The two-layer model reminder (this function resolves the STYLE layer; `formatCommitMessage`
  resolves the POSITION layer afterward — unchanged).
- The resolution flow: `getPrpCommitStyle()` → auto fetches `getRecentCommitMessages(N)` →
  `buildCommitMessageSystemPrompt(resolvedStyle, examples)` → `createCommitMessageAgent(system)`.
- The degradation rules: `auto` + ≤1-commit repo → `plain`; `PRP_COMMIT_STYLE_EXAMPLES=0` disables
  learning → `plain`; explicit modes (`plain`/`conventional`/`gitmoji`) ignore history entirely.
- Keep the existing `@throws`, `@remarks` (transient-API boundary), and `@example` text; refresh
  the `@example` if it implies a fixed style.

### Success Criteria
- [ ] `generateCommitMessage` resolves style via `getPrpCommitStyle()` before agent creation.
- [ ] `auto` + `N>0` calls `getRecentCommitMessages(N)` exactly once; `auto` + `EXAMPLES=0` does NOT.
- [ ] `auto` + ≤1 example degrades `resolvedStyle` to `'plain'`; `buildCommitMessageSystemPrompt`
      receives the resolved style + examples.
- [ ] Explicit modes (`plain`/`conventional`/`gitmoji`) skip the git-log call entirely.
- [ ] `createCommitMessageAgent(system)` receives the built prompt (was `createCommitMessageAgent()`).
- [ ] Four new imports + `PrpCommitStyle` type import added; no import removed.
- [ ] JSDoc (Mode A) documents the style-resolution flow + degradation rules.
- [ ] Empty-diff guard remains FIRST (empty-diff tests never call `getRecentCommitMessages`).
- [ ] All 13 existing `generateCommitMessage` tests stay GREEN with no edits to their bodies.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN; `npm run typecheck` exit 0;
      `npm run lint` + `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The
exact current function body, the exact imports, the exact logic to insert, the verified signatures of
every input symbol, the precise test-mock surgery required (which two mocks must grow, what default
return value keeps existing tests green, the env-hygiene pattern to copy), the new test matrix, the
do-not-touch boundaries, and the verified validation commands are all below.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the architecture pin for this exact task
- docfile: plan/012_7dd502f7feb9/architecture/implementation-status.md
  section: "F1.F — Wire into generateCommitMessage (src/utils/git-commit.ts)"
  why: Pins the exact resolution logic (style → examples → builder → factory), the import list, and
        the retry-boundary note (git log inside the retry boundary is acceptable — it's local/fast).
  critical: §F1.F's "Rest of the function unchanged" is authoritative — do NOT restructure smartCommit
        or move the diff-read.

# AUTHORITATIVE SPEC — the style-layer PRD text
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Message Style")
  section: §5.1 "Commit Message Style (Learning & Explicit Modes)" → "Mode-conditional system prompt"
        + "Scope & guarantees"
  why: Defines auto/plain/conventional/gitmoji, the EXAMPLES=0 disable, the ≤1-commit degradation,
        and that style examples affect ONLY the descriptive-message generation request.

# PARALLEL PREDECESSOR (read as a CONTRACT) — the factory change that must land before this
- docfile: plan/012_7dd502f7feb9/P1M1T3S2/PRP.md
  section: "Goal" / "Success Definition" / "Integration Points"
  why: T3.S2 widens createCommitMessageAgent(systemPrompt?: string) with system: systemPrompt ??
        COMMIT_MESSAGE_SYSTEM. This task calls createCommitMessageAgent(system). Assume T3.S2 lands
        exactly as specified — do NOT edit the factory body.
  critical: If T3.S2 has NOT landed yet (status Implementing), the call site
        createCommitMessageAgent(system) will still typecheck because the param is OPTIONAL — but the
        system prompt would be IGNORED until T3.S2 lands. Implement against the T3.S2 contract.

# COMPLETED PREDECESSORS (provide the inputs — do NOT modify them)
- docfile: plan/012_7dd502f7feb9/P1M1T3S1/PRP.md   # (T3.S1 — COMPLETE)
  why: buildCommitMessageSystemPrompt(style, examples?) is the pure builder this task calls. Its
        auto-degradation rule (examples && length > 1 else plain) mirrors this task's resolvedStyle
        gate — but THIS TASK owns setting resolvedStyle='plain' before calling the builder, so the
        builder always receives the already-resolved style.
- symbol: getPrpCommitStyle / getPrpCommitStyleExamples / PrpCommitStyle  (src/config/constants.ts:828,851,919 — T1.S1 COMPLETE)
  why: The env getters + type this task imports. getPrpCommitStyle is case-insensitive, defaults auto;
        getPrpCommitStyleExamples allows 0, defaults 5.
- symbol: getRecentCommitMessages(count, repoPath?)  (src/tools/git-mcp.ts:583 — T2.S1 COMPLETE)
  why: The async helper this task awaits. count===0 → [] (no git call); returns full messages newest-first.

# EDIT TARGET — the file being changed (read it first; locate function by grep)
- file: src/utils/git-commit.ts
  section: imports (L23–44) + generateCommitMessage (~L290–328; the createCommitMessageAgent() call is ~L321)
  why: Insert the style-resolution block between the empty-diff guard (L294–298) and the agent
        creation; widen the factory call; add the four imports + the PrpCommitStyle type import;
        refresh the JSDoc above the function.
  pattern: Mirror the file's existing JSDoc style (@param/@returns/@remarks/@example fences). The
        empty-diff guard STAYS FIRST.
  gotcha: Do NOT touch formatCommitMessage, smartCommit, buildFallbackCommitMessage, or
        restore_critical_files. Do NOT move the diff-read in smartCommit.

# TEST PATTERN — the test file being extended
- file: tests/unit/utils/git-commit.test.ts
  section: vi.mock('…git-mcp.js') (~L16–25), vi.mock('…commit-message-agent.js') (~L27–29),
        real imports (~L83–95), top-level beforeEach (~L118), describe('generateCommitMessage') (~L1050+)
  why: Two module mocks MUST grow (vi.mock replaces the ENTIRE module — omitting a symbol makes its
        import undefined → runtime throw). The default getRecentCommitMessages return in beforeEach
        keeps existing tests green. New describe block goes inside the generateCommitMessage group.
  pattern: Copy the env-hygiene pattern from describe('formatCommitMessage') (~L313–325): nested
        beforeEach(delete process.env.PRP_COMMIT_STYLE) + afterEach(vi.unstubAllEnvs). Use
        vi.stubEnv for per-case env. Use makeFakeAgent + mockCreateCommitMessageAgent.mockReturnValue.
  gotcha: The 13 existing generateCommitMessage tests run with env UNSET (auto) → they now call
        getRecentCommitMessages(5); the beforeEach default ([]) → degrade to plain → identical behavior.
        Do NOT edit existing test bodies.

# RESEARCH NOTE (this task) — copy-ready test cases + exact mock surgery
- docfile: plan/012_7dd502f7feb9/P1M1T4S1/research/wiring-and-tests.md
  section: "6. TEST IMPACT", "7. New test cases to ADD", "4. Exact logic to insert"
  why: The exact mock edits, the beforeEach default, the new-test matrix (6 branches + custom count),
        and the verbatim logic block.
```

### Current Codebase tree (edit surface)

```bash
src/utils/git-commit.ts                          # EDIT: imports + generateCommitMessage body + JSDoc
  ├─ imports (L23–44)                            # ADD getRecentCommitMessages, buildCommitMessageSystemPrompt,
  │                                              #     getPrpCommitStyle, getPrpCommitStyleExamples, + type PrpCommitStyle
  ├─ generateCommitMessage (~L290)               # INSERT style-resolution block; widen factory call; refresh JSDoc
  │    ├─ if (!diff ...) throw AgentError        # UNCHANGED (stays FIRST)
  │    ├─ [NEW] style resolution → system prompt # INSERT
  │    ├─ const agent = createCommitMessageAgent(system)   # was: createCommitMessageAgent()
  │    └─ createPrompt / agent.prompt / throws / return    # UNCHANGED
  ├─ formatCommitMessage                         # UNCHANGED (position layer — orthogonal)
  ├─ smartCommit (retry/fallback)                # UNCHANGED
  ├─ buildFallbackCommitMessage                  # UNCHANGED
  └─ restore_critical_files                      # UNCHANGED

tests/unit/utils/git-commit.test.ts              # EDIT: grow 2 mocks + imports + beforeEach default + new describe block
src/agents/commit-message-agent.ts               # READ-ONLY (T3.S1 builder + T3.S2 factory — assume landed)
src/config/constants.ts                          # READ-ONLY (T1.S1 getters — COMPLETE)
src/tools/git-mcp.ts                             # READ-ONLY (T2.S1 helper — COMPLETE)
```

### Desired Codebase tree with files to be changed
```bash
src/utils/git-commit.ts                          # EDIT — imports + generateCommitMessage + JSDoc
tests/unit/utils/git-commit.test.ts              # EDIT — 2 mocks + imports + beforeEach + new tests
# (no new files; no other source files touched)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (scope): This task changes ONLY: the 5 imports in git-commit.ts, the style-resolution
//   block inside generateCommitMessage, the createCommitMessageAgent() → (system) call, the JSDoc on
//   generateCommitMessage, and the test file (2 mock additions + beforeEach default + new describe).
//   Do NOT touch formatCommitMessage, smartCommit, the factory body, the builder body, the helper
//   body, or any docs file.

// CRITICAL (test mock surgery): vi.mock() REPLACES THE ENTIRE MODULE. Once generateCommitMessage
//   imports getRecentCommitMessages (from git-mcp.js) and buildCommitMessageSystemPrompt (from
//   commit-message-agent.js), BOTH module mocks in tests/unit/utils/git-commit.test.ts MUST export
//   those symbols (as vi.fn()) or the imports are undefined → "X is not a function" at runtime.
//   This is the #1 failure mode if skipped.

// GOTCHA (existing-test greenness): The 13 existing generateCommitMessage tests run with env UNSET
//   → getPrpCommitStyle() returns 'auto' → getPrpCommitStyleExamples() returns 5 → they now call
//   getRecentCommitMessages(5). Set mockGetRecentCommitMessages.mockResolvedValue([]) in the
//   top-level beforeEach so examples=[] → length 0 ≤ 1 → degrade to plain → builder gets 'plain'
//   → identical to today's fixed plain contract. (Even a bare vi.fn() returning undefined works via
//   the !examples guard, but the explicit [] default is deterministic and self-documenting.)

// GOTCHA (empty-diff path): The empty-diff guard is FIRST. generateCommitMessage('') throws BEFORE
//   style resolution, so getRecentCommitMessages is never called on the empty-diff tests — no mock
//   needed there. Do not move the guard.

// GOTCHA (retry boundary): generateCommitMessage is wrapped by retry() inside smartCommit. The new
//   getRecentCommitMessages(n) call now repeats on each retry. This is ACCEPTABLE (architecture
//   §F1.F): git log is a fast local operation, not a transient API call. Do NOT restructure smartCommit
//   or move the call outside the boundary — the diff-read already lives outside the closure and is
//   captured once; only the LLM boundary (now including the cheap git-log) repeats.

// GOTCHA (JSDoc cross-reference): The refreshed JSDoc references buildCommitMessageSystemPrompt,
//   getPrpCommitStyle, getRecentCommitMessages, createCommitMessageAgent, and PrpCommitStyle. Use
//   {@link} so the references resolve (all symbols are imported in-file). Keep the @remarks about
//   the transient-API boundary / retry classification.

// GOTCHA (format): The edited JSDoc + new logic must pass npm run format:check (prettier). If it
//   flags, run npm run format (writes) then re-check.

// GOTCHA (T3.S2 dependency): createCommitMessageAgent(system) typechecks whether or not T3.S2 has
//   landed (optional param). If T3.S2 is still Implementing, the system prompt arg is silently
//   ignored at runtime until T3.S2 lands. Implement against the T3.S2 contract regardless.
```

## Implementation Blueprint

### Data models and structure
N/A — no new data models. This task wires existing pure functions together. The only "structure" is
two local `let` variables (`resolvedStyle: PrpCommitStyle`, `examples: string[] | undefined`) inside
`generateCommitMessage`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/utils/git-commit.ts — add the five imports
  - git-mcp import (L23–31): ADD getRecentCommitMessages to the existing named-import list.
  - commit-message-agent import (L37): ADD buildCommitMessageSystemPrompt alongside
        createCommitMessageAgent → import { createCommitMessageAgent, buildCommitMessageSystemPrompt } from '../agents/commit-message-agent.js';
  - config/constants import (L39–44): ADD getPrpCommitStyle, getPrpCommitStyleExamples to the
        existing named-import list (after getPrpCommitFormat).
  - NEW import type line: import type { PrpCommitStyle } from '../config/constants.js';
        (place near the other config import; standalone import type is cleanest).
  - DO NOT: remove or reorder existing imports; touch any other import.

Task 2: EDIT src/utils/git-commit.ts — insert the style-resolution block + widen the factory call
  - LOCATE: grep for `export async function generateCommitMessage` (~L290) and the
        `const agent = createCommitMessageAgent();` line (~L321).
  - INSERT (between the empty-diff guard's closing `}` and the `const agent` line) the
        style-resolution block from the "Technical requirements" section above:
          const style = getPrpCommitStyle();
          let resolvedStyle: PrpCommitStyle = style;
          let examples: string[] | undefined;
          if (style === 'auto') { const n = getPrpCommitStyleExamples(); if (n > 0) {
            examples = await getRecentCommitMessages(n); } if (!examples || examples.length <= 1) {
            resolvedStyle = 'plain'; } }
          const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);
  - CHANGE: `const agent = createCommitMessageAgent();` → `const agent = createCommitMessageAgent(system);`
  - PRESERVE: the empty-diff guard (stays FIRST), createPrompt, agent.prompt, both AgentError throws,
        the .trim() + return.
  - DO NOT: touch anything else in the file.

Task 3: EDIT src/utils/git-commit.ts — refresh the generateCommitMessage JSDoc (Mode A)
  - LOCATE: the /** … */ block immediately above `export async function generateCommitMessage`.
  - DOCUMENT: the style-resolution flow (getPrpCommitStyle → auto fetches examples → builder →
        factory), the degradation rules (auto + ≤1 commit → plain; EXAMPLES=0 → plain; explicit
        modes ignore history), and the two-layer reminder (style here; position prefix layered
        afterward by formatCommitMessage — unchanged).
  - KEEP: the existing @throws (AgentError on empty diff / agent error / empty-or-sentinel output),
        the @remarks about the transient-API boundary + retry classification, and a working @example.
  - DO NOT: remove @returns or @param diff.

Task 4: EDIT tests/unit/utils/git-commit.test.ts — grow the two module mocks
  - vi.mock('…git-mcp.js'): ADD getRecentCommitMessages: vi.fn(), to the factory object.
  - vi.mock('…commit-message-agent.js'): ADD buildCommitMessageSystemPrompt: vi.fn(), to the
        factory object (alongside the existing createCommitMessageAgent: vi.fn()).
  - real imports: ADD getRecentCommitMessages (git-mcp) and buildCommitMessageSystemPrompt
        (commit-message-agent); ADD const mockGetRecentCommitMessages = vi.mocked(getRecentCommitMessages);
        and const mockBuildCommitMessageSystemPrompt = vi.mocked(buildCommitMessageSystemPrompt);
  - top-level beforeEach: ADD mockGetRecentCommitMessages.mockResolvedValue([]); (default empty →
        auto degrades to plain → existing tests green).
  - DO NOT: edit any existing it() body; change createCommitMessageAgent mock; call mockClear() on
        the new mocks in a way that breaks sibling tests.

Task 5: EDIT tests/unit/utils/git-commit.test.ts — add the style-resolution describe block
  - LOCATE: inside describe('generateCommitMessage', () => { … }), AFTER the last existing it().
  - ADD a nested describe('style resolution (PRP_COMMIT_STYLE)', () => { … }) with a nested
        beforeEach(() => { delete process.env.PRP_COMMIT_STYLE; delete process.env.PRP_COMMIT_STYLE_EXAMPLES; })
        and afterEach(() => { vi.unstubAllEnvs(); }).
  - In EACH case: mockBuildCommitMessageSystemPrompt.mockImplementation((style, _ex) => `MOCK[${style}]`);
        mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent({ status:'success', data:'msg', error:null }));
        then call await generateCommitMessage('diff text') and assert:
        - mockCreateCommitMessageAgent called with the expected 'MOCK[<resolvedStyle>]' string;
        - mockGetRecentCommitMessages called-or-not per the matrix.
  - CASES (see research §7): auto + >1 examples (factory 'MOCK[auto]', git-log called once with 5);
        auto + ≤1 examples (factory 'MOCK[plain]', degraded); auto + EXAMPLES=0 (git-log NOT called,
        factory 'MOCK[plain]'); explicit plain / conventional / gitmoji (git-log NOT called, factory
        'MOCK[<mode>]'); custom EXAMPLES count (stubEnv PRP_COMMIT_STYLE_EXAMPLES=3 → git-log called with 3).
  - FOLLOW pattern: existing makeFakeAgent + mockCreateCommitMessageAgent.mockReturnValue + vi.stubEnv.
  - DO NOT: stub env without the afterEach cleanup; assert on builder PROMPT CONTENT (that is the
        builder's own unit test in commit-message-agent.test.ts — assert the WIRING via the sentinel).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the entire generateCommitMessage body, before → after
// BEFORE (today, ~L290–328):
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError('stagecoach commit-message generation failed: empty staged diff');
  }
  const agent = createCommitMessageAgent();
  const prompt = createPrompt({ user: buildCommitMessageUserPrompt(diff), responseFormat: z.string() });
  const r = await agent.prompt(prompt);
  // … error/sentinel handling + return message; UNCHANGED …
}

// AFTER (this task):
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError('stagecoach commit-message generation failed: empty staged diff');
  }
  // === STYLE RESOLUTION (PRD §5.1 — P1.M1.T4.S1) ===
  const style = getPrpCommitStyle();
  let resolvedStyle: PrpCommitStyle = style;
  let examples: string[] | undefined;
  if (style === 'auto') {
    const n = getPrpCommitStyleExamples();
    if (n > 0) {
      examples = await getRecentCommitMessages(n);
    }
    if (!examples || examples.length <= 1) {
      resolvedStyle = 'plain'; // ≤1 commit / EXAMPLES=0 → nothing to learn (PRD §5.1)
    }
  }
  const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);
  const agent = createCommitMessageAgent(system);
  const prompt = createPrompt({ user: buildCommitMessageUserPrompt(diff), responseFormat: z.string() });
  const r = await agent.prompt(prompt);
  // … error/sentinel handling + return message; UNCHANGED …
}

// PATTERN: new style-resolution test (representative case — explicit conventional)
it('PRP_COMMIT_STYLE=conventional → skips git log, factory receives conventional contract', async () => {
  vi.stubEnv('PRP_COMMIT_STYLE', 'conventional');
  mockBuildCommitMessageSystemPrompt.mockImplementation((s) => `MOCK[${s}]` as string);
  mockCreateCommitMessageAgent.mockReturnValue(
    makeFakeAgent({ status: 'success', data: 'feat: x', error: null })
  );
  await generateCommitMessage('diff text');
  expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
  expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith('MOCK[conventional]');
});

// PATTERN: new style-resolution test (auto + EXAMPLES=0)
it('auto + PRP_COMMIT_STYLE_EXAMPLES=0 → no git log, degrades to plain', async () => {
  vi.stubEnv('PRP_COMMIT_STYLE_EXAMPLES', '0');   // PRP_COMMIT_STYLE unset → auto
  mockBuildCommitMessageSystemPrompt.mockImplementation((s) => `MOCK[${s}]` as string);
  mockCreateCommitMessageAgent.mockReturnValue(
    makeFakeAgent({ status: 'success', data: 'msg', error: null })
  );
  await generateCommitMessage('diff text');
  expect(mockGetRecentCommitMessages).not.toHaveBeenCalled(); // n>0 gate skips it
  expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith('MOCK[plain]');
});

// GOTCHA (above): the beforeEach default mockGetRecentCommitMessages.mockResolvedValue([]) means an
//   explicit-auto case that does NOT override the return value gets [] → degrade to plain. To test
//   auto WITH examples, override: mockGetRecentCommitMessages.mockResolvedValue(['a','b','c']).
```

### Integration Points
```yaml
IMPORTS (src/utils/git-commit.ts):
  - add to git-mcp.js import:     "getRecentCommitMessages"
  - add to commit-message-agent import: "buildCommitMessageSystemPrompt"
  - add to config/constants import: "getPrpCommitStyle, getPrpCommitStyleExamples"
  - new line: "import type { PrpCommitStyle } from '../config/constants.js';"

CALL SITE (src/utils/git-commit.ts generateCommitMessage):
  - insert: style-resolution block (5 statements + the if)
  - change: "createCommitMessageAgent()" → "createCommitMessageAgent(system)"

TEST MOCKS (tests/unit/utils/git-commit.test.ts):
  - git-mcp mock:          + "getRecentCommitMessages: vi.fn(),"
  - commit-message-agent mock: + "buildCommitMessageSystemPrompt: vi.fn(),"
  - real imports:          + getRecentCommitMessages, buildCommitMessageSystemPrompt (+ vi.mocked consts)
  - top-level beforeEach:  + "mockGetRecentCommitMessages.mockResolvedValue([]);"
  - new nested describe inside generateCommitMessage group: 6-7 style-resolution cases

DOWNSTREAM (NOT this task — reference only):
  - smartCommit's generateMessage path calls generateCommitMessage inside retry() — UNCHANGED.
  - formatCommitMessage layers the position prefix AFTER this function returns — UNCHANGED.

NONE OF: formatCommitMessage, smartCommit body, buildFallbackCommitMessage, restore_critical_files,
         createCommitMessageAgent body (T3.S2), buildCommitMessageSystemPrompt body (T3.S1),
         getRecentCommitMessages body (T2.S1), the constants getters (T1.S1), docs/* (P1.M3),
         PRD.md, spec, tasks.json.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier --check — clean (run `npm run format` if it flags the JSDoc/logic)
# Expected: zero errors. If typecheck flags PrpCommitStyle / getRecentCommitMessages / 
#   buildCommitMessageSystemPrompt as missing, confirm Task 1 imports landed.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/utils/git-commit.test.ts   # new style-resolution cases + ALL existing generateCommitMessage/smartCommit tests GREEN
# Expected: every it() passes. If an EXISTING generateCommitMessage test fails with
#   "getRecentCommitMessages is not a function", the git-mcp mock (Task 4) is missing the symbol.
#   If it fails with "buildCommitMessageSystemPrompt is not a function", the agent mock is missing it.
#   If a new case fails on 'MOCK[plain]' vs 'MOCK[auto]', check the resolvedStyle gate (≤1 → plain).
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # regression — builder + factory UNCHANGED by this task
npx vitest run tests/unit/config/   # regression — getters UNCHANGED (T1.S1 tests)
# Expected: all three suites GREEN.
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the wiring is the ONLY change in the target file (no stray edits to smartCommit etc.)
grep -n 'createCommitMessageAgent\|getRecentCommitMessages\|buildCommitMessageSystemPrompt\|getPrpCommitStyle' src/utils/git-commit.ts
# Expected: imports + exactly one call site inside generateCommitMessage; smartCommit/formatCommitMessage untouched.

# Confirm backward compat: the default path (env unset) degrades to plain (same as pre-style behavior).
# (Covered by the existing generateCommitMessage tests staying GREEN — they run env-unset → auto → [] → plain.)
# Expected: 13 existing generateCommitMessage tests GREEN with no body edits.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual end-to-end sanity (optional — requires a real repo + API key): set an explicit style and
# confirm the committed message shape. Not required for the PRP's validation gates (Level 2 covers it).
PRP_COMMIT_STYLE=conventional npm run dev -- commit   # (if a dev harness exists) — subject should be "type(scope): desc"
# Expected (unit-level, authoritative): the Level 2 style-resolution tests pass, proving each mode
# resolves the correct system prompt. Full LLM round-trip is out of scope for this wiring task.
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–2 pass; `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (new cases + all existing).
- [ ] `npx vitest run tests/unit/agents/commit-message-agent.test.ts` GREEN (regression — builder/factory untouched).

### Feature Validation
- [ ] `auto` + >1 examples → factory receives the auto (learned-style) prompt; git-log called once with N.
- [ ] `auto` + ≤1 example → degrades to plain; factory receives plain contract.
- [ ] `auto` + `EXAMPLES=0` → git-log NOT called; degrades to plain.
- [ ] `plain`/`conventional`/`gitmoji` → git-log NEVER called; factory receives the explicit contract.
- [ ] Empty-diff guard stays FIRST (empty-diff tests never reach style resolution).
- [ ] All 13 existing `generateCommitMessage` tests GREEN with no body edits.

### Code Quality Validation
- [ ] Five imports added (`getRecentCommitMessages`, `buildCommitMessageSystemPrompt`,
      `getPrpCommitStyle`, `getPrpCommitStyleExamples`, `type PrpCommitStyle`); none removed.
- [ ] Style-resolution block is self-contained between the guard and `createPrompt`; rest of function unchanged.
- [ ] `createCommitMessageAgent(system)` (was `createCommitMessageAgent()`).
- [ ] JSDoc (Mode A) documents the resolution flow + degradation rules; `@throws`/`@remarks` preserved.
- [ ] Test mocks grew both symbols; `beforeEach` default keeps existing tests deterministic.
- [ ] New tests use the env-hygiene pattern (`delete process.env` + `vi.unstubAllEnvs`).

### Documentation & Deployment
- [ ] No docs-file changes in this task (P1.M3 owns changeset docs — separate milestone).
- [ ] No env-var additions (T1.S1 already added `PRP_COMMIT_STYLE` / `PRP_COMMIT_STYLE_EXAMPLES`).
- [ ] No new deps, no new files.

---

## Anti-Patterns to Avoid
- ❌ Don't edit `formatCommitMessage`, `smartCommit`, `buildFallbackCommitMessage`,
  `restore_critical_files`, the factory body, the builder body, or the helper body — all out of scope.
- ❌ Don't skip the two module-mock additions in the test file — `vi.mock` replaces the whole module;
  omitting `getRecentCommitMessages` / `buildCommitMessageSystemPrompt` makes their imports `undefined`
  → runtime "not a function" in every existing `generateCommitMessage` test.
- ❌ Don't forget the `beforeEach` default `mockGetRecentCommitMessages.mockResolvedValue([])` —
  without it, existing env-unset tests still pass via the `!examples` guard, but the explicit `[]`
  is the deterministic, self-documenting choice.
- ❌ Don't move the empty-diff guard below the style-resolution block — it must stay FIRST so
  empty-diff failures never trigger a git-log call.
- ❌ Don't restructure `smartCommit`'s retry boundary to avoid re-calling `getRecentCommitMessages`
  on retry — architecture §F1.F explicitly blesses the git-log call inside the retry boundary (local,
  fast, not a transient API call).
- ❌ Don't assert on the builder's PROMPT CONTENT in the new git-commit tests — that is the builder's
  own unit test (commit-message-agent.test.ts). Assert the WIRING via a `MOCK[<style>]` sentinel.
- ❌ Don't stub `PRP_COMMIT_STYLE` without a nested `afterEach(() => vi.unstubAllEnvs())` — env bleed
  flips sibling tests (mirror the `formatCommitMessage` harness).
- ❌ Don't trust line numbers — locate `generateCommitMessage` and the `createCommitMessageAgent()`
  call by grep (T3.S1/S2 may have shifted nearby content).

---

## Confidence Score
**9 / 10** — one-pass success. The contract is pinned verbatim in the item description and
architecture §F1.F; every input symbol is verified present with a known signature; the change is a
self-contained insert + one call-site widening + import additions + JSDoc. The only residual risk is
the test-mock surgery (two `vi.mock` factories must grow the new symbols) — but that is fully
specified in Task 4 + the gotchas, and a missed mock fails loudly with "X is not a function" rather
than silently. The T3.S2 dependency (factory optional param) is non-blocking: the call site
typechecks either way, and the research notes flag the assumption explicitly.