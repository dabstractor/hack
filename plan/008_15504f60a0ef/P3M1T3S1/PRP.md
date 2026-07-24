# PRP — P3.M1.T3.S1: Add stagecoach LLM commit-message generation to smartCommit

---

## Goal

**Feature Goal**: Add an **optional, backward-compatible** stagecoach
commit-message-generation path to `smartCommit`: when invoked with a new
`{ generateMessage: true }` option, `smartCommit` delegates commit-message
generation to a lightweight LLM agent that reads the **staged diff** and emits a
descriptive conventional-commit message. Per PRD §5.1 *"Smart Commit
Resilience"*: *"Smart Commit delegates commit-message generation to an LLM tool
(`stagecoach`). That call is one-shot and transient-API-sensitive — a generation
timeout here is LLM-API slowness, not a stuck subprocess … so it should be
retried."* This task ships the **generation boundary** (the LLM call + the
opt-in wiring in `smartCommit`); the **retry/backoff** (P3.M1.T4.S1) and
**fallback placeholder** (P3.M1.T4.S2) are explicitly **out of scope** and
consume this boundary.

**Deliverable** (1 new agent module + 1 modified utility + 1 new unit-test file + mock patch to existing unit tests):
1. **`src/agents/commit-message-agent.ts`** — CREATE: a thin factory
   `createCommitMessageAgent()` that reuses `createBaseConfig` (existing persona
   `researcher` + role `research` — NO expansion of the `AgentPersona` union)
   and overrides `name`/`system`/`maxTokens`/`enableReflection`/`enableCache`.
   The agent carries NO MCP tools (it reads the diff from the prompt text).
2. **`src/utils/git-commit.ts`** — MODIFY: (a) export a new pure async boundary
   `generateCommitMessage(diff: string): Promise<string>` that instantiates the
   agent, builds a `createPrompt({ user, responseFormat: z.string() })`,
   calls `agent.prompt(prompt)`, and **throws `AgentError`** on any failure
   (agent error, empty diff, empty/whitespace-only output) — this is the
   transient-API-sensitive boundary P3.M1.T4.S1 wraps with retry. (b) Add an
   optional 3rd param `options?: SmartCommitOptions` to `smartCommit`; when
   `options.generateMessage === true`, after `gitAdd` it calls
   `gitDiff({ path: repoRoot, staged: true })`, feeds the diff to
   `generateCommitMessage`, wraps the result in `formatCommitMessage`, and
   commits. The default path (option absent / false) is **byte-for-byte
   unchanged** — existing callers and tests are untouched. (c) JSDoc on
   `smartCommit` documenting both paths + the two-phase commit support (Mode A
   doc rides with the work per contract item 5).
3. **`tests/unit/utils/git-commit.test.ts`** — MODIFY: add a one-line mock for
   `'../../../src/agents/commit-message-agent.js'` (passthrough
   `createCommitMessageAgent: vi.fn()`) so the default-path tests never
   instantiate a real agent; add a new `describe` block covering the
   `generateMessage: true` path (happy path → generated message wrapped in
   `[PRP Auto]`; empty diff → throws `AgentError`; agent `status:'error'` →
   throws `AgentError`; whitespace-only output → throws `AgentError`;
   `gitDiff` failure → smartCommit returns `null` and never calls the agent).
4. **`tests/unit/agents/commit-message-agent.test.ts`** — CREATE: a focused
   unit test asserting the factory returns an `Agent` with the expected
   `name`/`maxTokens` (512)/`enableReflection`(false)/`enableCache`(false) and
   that it reuses the balanced-tier model (mock `createBaseConfig`).

**Scope note (critical):** This task is **ONLY the generation boundary + opt-in
wiring**. It does NOT add `COMMIT_RETRY_MAX` / `COMMIT_RETRY_DELAY`
(P3.M1.T4.S1), the fallback placeholder commit (P3.M1.T4.S2), the two-phase
pre/post-cleanup call sites in `executeSubtask` (P3.M1.T3.S2), or the cleanup
agent persona (P3.M1.T3.S3). It does NOT change `PROTECTED_FILES` (critical-file
deletion protection is P3.M2.T4.S2). The single existing production caller
(`task-orchestrator.ts:1004`) is **unchanged** — it keeps using the
pre-formatted message; the stagecoach path is exercised only by P3.M1.T3.S2
onward.

**Success Definition**:
- `smartCommit(sessionPath, message)` (no options) behaves EXACTLY as today:
  `gitStatus → filter → gitAdd → gitCommit(formatCommitMessage(message))`.
  Existing unit + integration tests pass **unchanged**.
- `smartCommit(sessionPath, fallbackMsg, { generateMessage: true })` stages
  files, reads the staged diff, generates a commit message via the LLM agent,
  wraps it in `[PRP Auto] …\n\nCo-Authored-By: …`, and commits.
- `generateCommitMessage(diff)` throws `AgentError` on every failure mode
  (agent error, empty diff, empty output) — classified transient by
  `isTransientError` (AgentError hardcodes `PIPELINE_AGENT_LLM_FAILED`), so
  P3.M1.T4.S1 can wrap it in `retryAgentPrompt`.
- `smartCommit` never throws — generation failure inside the
  `generateMessage` path is caught by its existing outer try/catch, logged,
  and surfaced as a `null` return (so the orchestrator's never-fail-on-commit
  contract holds). The retry layer wraps the INNER `generateCommitMessage`,
  not `smartCommit`.
- `npm run validate` GREEN; `package.json` `dependencies` unchanged (reuses
  `groundswell` + `zod`, already present).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). The immediate
consumer is P3.M1.T3.S2 (pre-cleanup survival commit + post-cleanup commit),
which needs descriptive commit messages that reflect the *actual staged work*
rather than a fixed `"${subtask.id}: ${subtask.title}"` template. The
long-term consumer is the cleanup agent's two commits (P3.M1.T3.S3).
**Use Case**: After a subtask's substance is committed, the cleanup agent
reorganizes docs (`plan/.../research/*` → `docs/`, removes temp artifacts).
That second commit's diff is *unpredictable* — a templated message would be
meaningless. The stagecoach agent reads the staged diff and writes a message
that actually describes the reorganization.
**User Journey**: orchestrator → `smartCommit(path, fallback, { generateMessage: true })`
→ `gitAdd` → `gitDiff({staged:true})` → `generateCommitMessage(diff)` (LLM
agent) → `formatCommitMessage(msg)` → `gitCommit` → commit hash returned.
**Pain Points Addressed**: PRD §5.1 — every `[PRP Auto]` commit today carries
the identical `"P3.M1.T3.S1: <title>"` template regardless of what changed,
making history unreadable and the two-phase cleanup commits indistinguishable
from substance commits. The LLM path produces a diff-accurate message.

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) mandates: *"Smart Commit delegates
  commit-message generation to an LLM tool (`stagecoach`)."* and §4.2 (h3.4)
  step 4 names the two-phase commits as `stagecoach` calls. This task ships the
  `stagecoach` generation capability; the call sites (P3.M1.T3.S2) and
  resilience (P3.M1.T4) are siblings that consume it.
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"Add a stagecoach commit-message generation path to smartCommit: when
    invoked with a flag/option to generate the message, it delegates
    commit-message generation to an LLM tool call."* → new
    `SmartCommitOptions.generateMessage` + `generateCommitMessage` boundary.
  - (b) *"The LLM generates a descriptive commit message from the staged
    diff."* → `gitDiff({ staged: true })` fed to the agent after `gitAdd`.
  - (c) *"smartCommit gains an optional parameter or config to enable
    stagecoach generation vs. using a pre-formatted message (backward
    compatible)."* → optional 3rd arg; default path byte-identical.
  - (d) *"The generation call is transient-API-sensitive — a timeout is
    LLM-API slowness, not a stuck subprocess (relevant for P3.M1.T4 retry
    logic)."* → the boundary throws `AgentError` (hardcoded
    `PIPELINE_AGENT_LLM_FAILED` → transient per `isTransientError`), so the
    P3.M1.T4 retry logic can distinguish it from an exit-124 subprocess hang
    (which MUST NOT be retried).
- **Architectural reality**: `smartCommit` (git-commit.ts:131) is single-phase
  today and takes a pre-formatted message; no stagecoach code exists
  (`architecture/phase_findings.md` §smartCommit confirms). `gitDiff` with
  `staged:true` exists (`git-mcp.ts:367`) but is unused by `smartCommit`.
  `createBaseConfig` (`agent-factory.ts:239`) lets us build a lightweight agent
  WITHOUT expanding the `AgentPersona` union (zero blast radius).

---

## What

One new agent module, one modified utility (opt-in 3rd param + new exported
boundary), one new unit-test file, a mock patch to the existing unit tests.

### Success Criteria

- [ ] **Backward compatibility**: `smartCommit(sessionPath, message)` with no
      options is byte-identical in behavior to today (existing unit + integration
      tests pass unchanged; `git diff` of the default-path branch shows only the
      JSDoc addition).
- [ ] **Opt-in generation**: `smartCommit(sessionPath, fallback, { generateMessage: true })`
      calls `gitDiff({ staged:true })` after `gitAdd`, feeds the diff to
      `generateCommitMessage`, wraps the result in `formatCommitMessage`, commits.
- [ ] **Generation boundary contract**: `generateCommitMessage(diff)` throws
      `AgentError` on (a) empty/whitespace-only `diff`, (b) agent
      `status:'error'`, (c) empty/whitespace-only LLM output. On success returns
      the trimmed message string. The thrown `AgentError` is classified
      **transient** by `isTransientError` (verified by a test asserting
      `isTransientError(thrown) === true`).
- [ ] **smartCommit never throws**: generation failure inside the
      `generateMessage` path is caught by smartCommit's outer try/catch, logged
      at `error`, and the function returns `null` (orchestrator never-fail-on-
      commit contract preserved).
- [ ] **Message formatting**: the LLM message goes THROUGH
      `formatCommitMessage` (keeps `[PRP Auto]` prefix + Co-Authored-By trailer).
      The agent's system prompt forbids the agent from emitting prefix/trailer.
- [ ] **No new config**: `src/config/constants.ts` is unchanged (no
      `COMMIT_RETRY_*` — that is P3.M1.T4.S1).
- [ ] **No persona expansion**: `AgentPersona` union and `PERSONA_TOKEN_LIMITS`
      unchanged; the new agent reuses `createBaseConfig('researcher','research')`.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact files,
exact factory to reuse, exact agent boundary shape, exact `gitDiff` export, the
exact mock structure that keeps existing tests green, and the exact reasons the
naive approaches fail (expand persona / add retry here / let smartCommit throw).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://www.conventionalcommits.org/en/v1.0.0/
  why: The stagecoach agent's system prompt must instruct it to emit
       conventional-commit-style messages (imperative subject ≤72 chars,
       optional body). This is the canonical spec to mirror.
  critical: The agent must output ONLY the message (no fences, no preamble,
            no Co-Authored-By, no [PRP Auto]) — the caller wraps via
            formatCommitMessage. A verbose agent output corrupts the commit.

- file: src/utils/git-commit.ts
  why: THE PRIMARY EDIT. smartCommit (line 131) today does gitStatus→filter→
       gitAdd→gitCommit. Add an optional 3rd param options?: SmartCommitOptions;
       in the generateMessage branch (after gitAdd succeeds), call
       gitDiff({path:repoRoot, staged:true}) then generateCommitMessage(diff),
       wrap via formatCommitMessage, commit. Export generateCommitMessage as a
       new module-level async fn.
  pattern: read smartCommit (131-220), formatCommitMessage (107), filterProtectedFiles (90).
           The outer try/catch (returns null on ANY error) MUST stay — generation
           failure is caught here, logged, returns null (never throws to caller).
  gotcha: (1) the default branch (options absent/false) must be byte-identical.
          (2) gitDiff must run AFTER gitAdd so it reflects the filtered staged
          set, not the raw working tree. (3) formatCommitMessage wraps the LLM
          output (do NOT double-wrap or skip it). (4) An empty diff after
          staging (e.g. only whitespace) must throw AgentError from
          generateCommitMessage — smartCommit then returns null.

- file: src/agents/commit-message-agent.ts   # NEW
  why: THE NEW FACTORY. Reuses createBaseConfig('researcher','research') and
       overrides name='CommitMessageAgent', system=COMMIT_MESSAGE_SYSTEM,
       maxTokens=512, enableReflection=false, enableCache=false, NO mcps.
       Returns createAgent(config). NO edit to AgentPersona union.
  pattern: mirror createResearcherAgent (agent-factory.ts:328) but WITHOUT
           mcps (the agent reads the diff from the prompt, no tools needed) and
           with the overrides above.
  gotcha: enableReflection=false — single-shot generation, no reflection loop.
          enableCache=false — every diff is unique, caching wastes a round-trip.
          maxTokens=512 — a commit message is tiny; keeps the call cheap+fast.

- file: src/agents/agent-factory.ts
  why: READ createBaseConfig (line 239) + createResearcherAgent (328) +
       ROLE_CONFIG (209) + AgentConfig interface (162). DO NOT MODIFY this file
       for the agent itself — only import createBaseConfig from it. The balanced
       tier (research role) is the right budget for a summarization task.
  pattern: createBaseConfig returns a fully-wired AgentConfig (model, harness,
           env keys via resolveApiKeyForProvider, lazy logger). Spread + override
           is the established pattern (all 4 factories do it).
  gotcha: AgentPersona is a closed union used by PERSONA_TOKEN_LIMITS; reusing
          'researcher' (4096 limit, overridden to 512) avoids touching it.

- file: src/tools/git-mcp.ts
  why: gitDiff (line 367) — `async function gitDiff(input: {path; staged?}):
       Promise<{success; diff?; error?}>`. When staged:true runs
       `git.diff(['--cached'])`. Exported at line ~666.
  pattern: add `gitDiff` to the existing import in git-commit.ts:
           `import { gitStatus, gitAdd, gitCommit, gitDiff } from '../tools/git-mcp.js';`
  gotcha: gitDiff returns {success:false, error} on failure — smartCommit must
          treat a failed gitDiff like a failed gitAdd (log + return null), NOT
          feed an undefined diff to the agent.

- file: src/agents/prp-generator.ts
  why: THE AgentResponse-handling pattern to mirror. Lines 718-731: `const r =
       await agent.prompt(prompt); if (r.status === 'error') throw new
       AgentError('... failed: ' + (r.error?.message ?? 'unknown'))`. r.data is
       the typed payload (string when responseFormat=z.string()).
  pattern: copy this exact status-check + throw-AgentError idiom into
           generateCommitMessage.
  gotcha: existing code lets 'partial' fall through and use r.data — for commit
          messages that's fine (partial still carries text). But add an explicit
          empty-output guard: if (!r.data?.trim()) throw AgentError.

- file: src/agents/prp-executor.ts
  why: THE createPrompt usage (line 26 import, line 303 usage):
       `import { createPrompt } from 'groundswell';` +
       `createPrompt({ user: '...', responseFormat: z.unknown() })`. For commit
       messages use `responseFormat: z.string()`.
  pattern: import { createPrompt } from 'groundswell'; import { z } from 'zod';
           const prompt = createPrompt({ user: buildUser(diff), responseFormat: z.string() });

- file: src/utils/errors.ts
  why: AgentError export (line 422). `import { AgentError } from './errors.js'`
       (note: git-commit.ts is in src/utils/, so the import is './errors.js').
       AgentError hardcodes code=PIPELINE_AGENT_LLM_FAILED (per retry.ts:340
       comment) → isTransientError classifies it transient. This is WHY the
       boundary throws AgentError specifically (not a generic Error).
  pattern: `throw new AgentError('stagecoach commit-message generation failed: <reason>');`
  gotcha: confirm AgentError's constructor signature (read errors.ts:422) before
          use — it may take (message) or (message, code, cause). Use whichever
          the existing call sites (prp-generator.ts:18 import) use.

- file: src/utils/retry.ts
  why: isTransientError (line 325) + retryAgentPrompt (line 651). DO NOT MODIFY
       — this task does NOT add retry. But generateCommitMessage's thrown
       AgentError MUST be classified transient by isTransientError so P3.M1.T4.S1
       can wrap the boundary with retryAgentPrompt.
  pattern: read isTransientError (325-348) — confirms AgentError(hardcoded
           PIPELINE_AGENT_LLM_FAILED) is transient. Add a test asserting
           isTransientError(thrownFromGenerateCommitMessage) === true.
  gotcha: do NOT wrap generateCommitMessage in retry here — that is P3.M1.T4.S1.
          Keep the boundary a single un-wrapped throw-on-failure call.

- file: tests/unit/utils/git-commit.test.ts
  why: THE existing 100%-coverage suite to keep green + extend. Mocks git-mcp
       fns + logger. Add a mock for commit-message-agent.js (passthrough
       createCommitMessageAgent: vi.fn()) so default-path tests never instantiate
       a real agent. Add a new describe block for generateMessage:true.
  pattern: read the file's vi.mock structure + vi.hoisted logger mock + how
           mockGitStatus/mockGitAdd/mockGitCommit are reset in beforeEach. Mirror
           it for mockCreateCommitMessageAgent + the new test block.
  gotcha: default-path tests MUST stay green unchanged — the agent mock must
          never be invoked when options is absent. Wire the mocked agent's
          .prompt() to resolve {status:'success', data:'feat: ...', error:null}.

- docfile: plan/008_15504f60a0ef/P3M1T3S1/research/agent-integration.md
  why: the exact factory/Prompt/AgentResponse/gitDiff wiring with code snippets.
  section: "1. Minimal new agent" + "2. Prompt construction" + "3. AgentResponse".

- docfile: plan/008_15504f60a0ef/P3M1T3S1/research/test-conventions.md
  why: the exact mock structure + backward-compat surface + message-formatting
       contract. Confirms the orchestrator call site is UNCHANGED and the
       integration test (which mocks smartCommit wholesale) is unaffected.
  section: "1." (mock structure) + "3." (orchestrator unchanged) + "6." (options shape).
```

### Current Codebase tree (relevant slice)

```bash
src/
  agents/
    agent-factory.ts          # createBaseConfig + 4 factories — IMPORT createBaseConfig, DO NOT EDIT
    commit-message-agent.ts   # CREATE — thin factory reusing createBaseConfig
    prompts.ts                # existing prompt constants — UNCHANGED
  tools/
    git-mcp.ts                # gitDiff(staged:true) export — IMPORT gitDiff, DO NOT EDIT
  utils/
    git-commit.ts             # MODIFY — smartCommit 3rd param + generateCommitMessage + JSDoc
    errors.ts                 # AgentError export — IMPORT, DO NOT EDIT
    retry.ts                  # isTransientError/retryAgentPrompt — DO NOT EDIT (consumed by P3.M1.T4.S1)
    logger.ts                 # getLogger — already imported by git-commit.ts
tests/
  unit/
    agents/
      commit-message-agent.test.ts  # CREATE — factory assertions
    utils/
      git-commit.test.ts            # MODIFY — agent mock + new generateMessage:true describe block
  integration/
    smart-commit.test.ts            # UNCHANGED (mocks smartCommit wholesale)
```

### Desired Codebase tree with files to be added/modified

```bash
src/agents/commit-message-agent.ts            # CREATE (Task 1)
src/utils/git-commit.ts                       # MODIFY (Task 2)
tests/unit/utils/git-commit.test.ts           # MODIFY (Task 3)
tests/unit/agents/commit-message-agent.test.ts # CREATE (Task 4)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: smartCommit MUST NEVER throw. It has an outer try/catch that returns
// null on ANY error so the orchestrator's never-fail-on-commit contract holds.
// generateCommitMessage (the boundary) DOES throw AgentError — but smartCommit's
// outer catch converts that throw to a null return + error log. P3.M1.T4.S1's
// retry wraps generateCommitMessage (the boundary), NOT smartCommit.

// CRITICAL: the default path (options absent/false) must be byte-identical to
// today. Do NOT instantiate the agent, do NOT call gitDiff, do NOT import the
// agent module at the top of the generate branch eagerly in a way that runs for
// default callers. The agent instantiation lives INSIDE generateCommitMessage
// (lazy), which is only called from the generateMessage branch.

// CRITICAL: do NOT expand the AgentPersona union. Reusing createBaseConfig
// ('researcher','research') gives balanced tier + harness/env wiring for free.
// A new persona would force edits to PERSONA_TOKEN_LIMITS and ripple.

// CRITICAL: the thrown error from generateCommitMessage MUST be AgentError
// (not generic Error). AgentError hardcodes code=PIPELINE_AGENT_LLM_FAILED,
// which isTransientError classifies as TRANSIENT. A generic Error or
// ValidationError would NOT be retried by P3.M1.T4.S1. This is the contract
// that lets P3.M1.T4 distinguish "LLM-API slowness (retry)" from "exit-124
// subprocess hang (never retry)".

// CRITICAL: gitDiff must run AFTER gitAdd (so it reflects the filtered staged
// set, not the raw working tree) and BEFORE gitCommit. Feed diff to the agent.
// On gitDiff {success:false} → log + return null (do NOT feed undefined to agent).

// GOTCHA: createPrompt responseFormat=z.string() makes r.data typed string on
// success. But the LLM may emit leading/trailing whitespace or markdown fences
// despite the system prompt — ALWAYS .trim() and guard for empty. If the
// trimmed output is empty → throw AgentError (do not commit an empty message).

// GOTCHA: formatCommitMessage wraps the LLM output. Do NOT let the agent emit
// the [PRP Auto] prefix or Co-Authored-By trailer — the system prompt forbids
// it AND formatCommitMessage adds them. Double-wrapping would produce
// "[PRP Auto] [PRP Auto] ...".

// GOTCHA: this task adds NO retry and NO config constants. COMMIT_RETRY_MAX /
// COMMIT_RETRY_DELAY are P3.M1.T4.S1. Wrapping generateCommitMessage in retry
// here would duplicate P3.M1.T4.S1 and violate scope. Keep it a single unwrapped
// throw-on-failure boundary.

// GOTCHA: enableReflection=false + enableCache=false on the commit-message
// agent. Reflection would add a second LLM round-trip for a trivial task; cache
// would never hit (diffs are unique). maxTokens=512 keeps it cheap.
```

---

## Implementation Blueprint

### Implementation Decisions

**D1 — Reuse `createBaseConfig`, do NOT expand `AgentPersona`.** The new
`createCommitMessageAgent()` calls `createBaseConfig('researcher', 'research')`
(balanced tier, normal budget, full harness/env wiring) and overrides
`name`/`system`/`maxTokens`/`enableReflection`/`enableCache`, then returns
`createAgent(config)`. Lives in a NEW module `src/agents/commit-message-agent.ts`
so `agent-factory.ts` is untouched (zero blast radius). Rationale: expanding
`AgentPersona` ripples into `PERSONA_TOKEN_LIMITS` and every consumer; a thin
override module is the established pattern (all 4 factories spread+override).

**D2 — Single clean boundary: `generateCommitMessage(diff)`.** A new exported
async fn in `src/utils/git-commit.ts` that (a) guards empty/whitespace diff →
throws `AgentError`; (b) builds `createPrompt({ user, responseFormat:
z.string() })`; (c) `agent.prompt(prompt)`; (d) on `status:'error'` throws
`AgentError`; (e) trims output, throws `AgentError` if empty; (f) returns the
string. **This is the boundary P3.M1.T4.S1 wraps with `retryAgentPrompt`.**
Rationale: P3.M1.T4.S1 needs a single function to retry; burying the LLM call
inside smartCommit (which never throws) would make retry impossible. The
boundary throws; smartCommit catches and returns null.

**D3 — smartCommit never throws; generation failure → null return.** smartCommit
keeps its outer try/catch that returns `null` on any error. In the
`generateMessage` path, if `generateCommitMessage` throws (or `gitDiff` fails),
the outer catch logs + returns `null`. This preserves the orchestrator's
never-fail-on-commit contract TODAY; P3.M1.T4.S1/S2 will add retry around the
INNER boundary and a fallback placeholder so the `null` (no-commit) case becomes
vanishingly rare. Rationale: introducing a throw from smartCommit now would
break the orchestrator's existing try/catch assumption (`task-orchestrator.ts`
already wraps the call, but the contract documented in git-commit.ts JSDoc is
"returns null on any failure to allow pipeline to continue").

**D4 — `gitDiff` after `gitAdd`, before `gitCommit`.** The diff fed to the agent
MUST reflect the filtered staged set (post-`PROTECTED_FILES` filtering). Calling
`gitDiff` before `gitAdd` would include unstaged changes the commit won't
contain → misleading message. Rationale: the message must describe what is
actually committed.

**D5 — Message formatting preserved.** The LLM output goes THROUGH
`formatCommitMessage` (keeps `[PRP Auto]` prefix + Co-Authored-By trailer). The
agent's system prompt forbids emitting prefix/trailer. Rationale: every commit
keeps a consistent provenance marker; the agent's job is only the descriptive
subject+body.

### Data models and structure

No ORM/pydantic. Two small additions:

```typescript
// 1. src/utils/git-commit.ts — new options interface + boundary signature.
export interface SmartCommitOptions {
  /** When true, delegate commit-message generation to the stagecoach LLM agent,
   *  which reads the staged diff. Default (omitted/false): use the caller-provided
   *  `message` verbatim (backward compatible). On generation failure smartCommit
   *  logs and returns null (never throws); the retry layer (P3.M1.T4.S1) wraps
   *  the inner `generateCommitMessage` boundary. */
  readonly generateMessage?: boolean;
}

// The boundary P3.M1.T4.S1 wraps with retryAgentPrompt:
export async function generateCommitMessage(diff: string): Promise<string>;
//   throws AgentError on: empty/whitespace diff; agent status:'error'; empty output.

// smartCommit signature (3rd param OPTIONAL → backward compatible):
export async function smartCommit(
  sessionPath: string,
  message: string,                       // KEPT — fallback / pre-formatted message
  options?: SmartCommitOptions,          // NEW optional 3rd arg
): Promise<string | null>;               // unchanged return contract

// 2. src/agents/commit-message-agent.ts — new factory (no type additions).
export function createCommitMessageAgent(): Agent; // reuses createBaseConfig, overrides
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/agents/commit-message-agent.ts — thin factory (D1)
  - IMPORT: `import { createAgent } from 'groundswell';` and
    `import { createBaseConfig } from './agent-factory.js';`.
  - DEFINE a module-level `const COMMIT_MESSAGE_SYSTEM = \`...\`;` constant with
    the system prompt (see Implementation Patterns below). It MUST instruct:
    conventional-commit style; imperative subject ≤72 chars; optional body;
    reference any work-item id visible in diff paths; output ONLY the message;
    NO fences, NO preamble, NO Co-Authored-By, NO [PRP Auto].
  - IMPLEMENT: `export function createCommitMessageAgent(): Agent { const base =
    createBaseConfig('researcher', 'research'); return createAgent({ ...base,
    name: 'CommitMessageAgent', system: COMMIT_MESSAGE_SYSTEM, maxTokens: 512,
    enableReflection: false, enableCache: false }); }` — NO mcps field (agent
    reads diff from prompt, no tools).
  - FOLLOW pattern: createResearcherAgent (agent-factory.ts:328) for the spread+
    override shape, minus mcps and with the overrides above.
  - GOTCHA: do NOT add a logger call unless createResearcherAgent does (it does
    a debug log — mirror it for consistency, optional).
  - VALIDATE: tsc --noEmit passes; the factory returns an Agent instance.

Task 2: MODIFY src/utils/git-commit.ts — generateCommitMessage boundary + smartCommit option (D2/D3/D4/D5)
  - ADD imports at top:
      `import { gitStatus, gitAdd, gitCommit, gitDiff } from '../tools/git-mcp.js';`
      (add gitDiff to the existing git-mcp import line);
      `import { AgentError } from './errors.js';`
      `import { createPrompt } from 'groundswell';`
      `import { z } from 'zod';`
      `import { createCommitMessageAgent } from '../agents/commit-message-agent.js';`
  - ADD the SmartCommitOptions interface (see Data models #1) near the other
    exports (after formatCommitMessage, before smartCommit).
  - ADD the generateCommitMessage boundary function (D2). Implementation:
        export async function generateCommitMessage(diff: string): Promise<string> {
          if (!diff || !diff.trim()) {
            throw new AgentError(
              'stagecoach commit-message generation failed: empty staged diff'
            );
          }
          const agent = createCommitMessageAgent();
          const prompt = createPrompt({
            user: buildCommitMessageUserPrompt(diff),
            responseFormat: z.string(),
          });
          const r = await agent.prompt(prompt);
          if (r.status === 'error') {
            throw new AgentError(
              `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
            );
          }
          const message = (r.data ?? '').trim();
          if (!message) {
            throw new AgentError(
              'stagecoach commit-message generation failed: empty agent output'
            );
          }
          return message;
        }
    (Add a small private `buildCommitMessageUserPrompt(diff)` helper — see
    Implementation Patterns. It injects the diff + restates the formatting rules
    so the agent is reminded at the user-turn level too.)
  - MODIFY smartCommit signature: add `options?: SmartCommitOptions` as an
    OPTIONAL 3rd parameter. The existing validation block (sessionPath/message
    non-empty) stays. KEEP the `message` parameter REQUIRED (it is the fallback
    for the generate path AND the sole input for the default path).
  - MODIFY the commit-message resolution inside smartCommit, AFTER the
    successful `gitAdd` and BEFORE `gitCommit`:
        let commitMessage: string;
        if (options?.generateMessage) {
          const diffResult = await gitDiff({ path: repoRoot, staged: true });
          if (!diffResult.success) {
            logger().error(`Git diff (staged) failed: ${diffResult.error}`);
            return null; // mirrors the gitAdd-failure path; do NOT feed undefined to agent
          }
          // generateCommitMessage throws AgentError on failure → caught by outer try/catch → null return
          const generated = await generateCommitMessage(diffResult.diff ?? '');
          commitMessage = formatCommitMessage(generated);
        } else {
          commitMessage = formatCommitMessage(message); // DEFAULT PATH — byte-identical to today
        }
        const commitResult = await gitCommit({ path: repoRoot, message: commitMessage });
    NOTE: the default branch must produce the EXACT same formatted string as the
    current `formatCommitMessage(message)` call it replaces. Confirm by diffing
    the test output.
  - UPDATE the smartCommit JSDoc (Mode A — rides with the work per contract
    item 5): document (a) the default pre-formatted-message path, (b) the
    generateMessage:true stagecoach path, (c) that generation failure → null
    return + error log (never throws), (d) that the boundary
    generateCommitMessage throws AgentError (transient) for P3.M1.T4 retry, (e)
    mention two-phase commit support (pre-cleanup survival + post-cleanup) as
    the intended consumer (P3.M1.T3.S2).
  - GOTCHA: do NOT remove or alter the existing outer try/catch. It must still
    catch the AgentError thrown by generateCommitMessage and return null.
  - GOTCHA: do NOT add retry here. generateCommitMessage is a single unwrapped
    call. P3.M1.T4.S1 wraps it.
  - GOTCHA: confirm AgentError's constructor (read src/utils/errors.ts:422) —
    it likely takes (message) or (message, opts). Match existing usage
    (prp-generator.ts uses `new AgentError('...')`).

Task 3: MODIFY tests/unit/utils/git-commit.test.ts — agent mock + generateMessage:true tests
  - ADD a vi.mock for the agent module, near the existing git-mcp/logger mocks:
        vi.mock('../../../src/agents/commit-message-agent.js', () => ({
          createCommitMessageAgent: vi.fn(),
        }));
    AND a mock for groundswell's createPrompt (since the test imports
    generateCommitMessage which calls createPrompt):
        vi.mock('groundswell', () => ({ createPrompt: vi.fn((opts) => opts) }));
    (Adjust to whatever keeps the default-path tests green — the key invariant
    is the default path never instantiates the agent.)
  - IMPORT the new exports: `generateCommitMessage`, and `vi.mocked` the agent
    factory + createPrompt.
  - ADD a new `describe('generateCommitMessage', ...)` block:
      * happy path: mock createCommitMessageAgent → returns a fake agent whose
        .prompt resolves {status:'success', data:'feat(api): add endpoint',
        error:null}; assert generateCommitMessage('diff text') returns the
        trimmed string.
      * empty diff → throws AgentError (assert message includes 'empty staged diff').
      * whitespace-only diff → throws AgentError.
      * agent status:'error' → throws AgentError (assert message includes
        r.error.message).
      * empty/whitespace agent output → throws AgentError ('empty agent output').
      * transient classification: assert `isTransientError(thrown)` is true for
        the agent-error case (import isTransientError from retry.ts) — proves the
        P3.M1.T4 retry contract.
  - ADD a new `describe('smartCommit generateMessage option', ...)` block:
      * generateMessage:true happy path: mock gitStatus→modified files,
        gitAdd→success, gitDiff→{success:true, diff:'...'}, mocked agent→success,
        gitCommit→{success:true, commitHash:'abc'}; assert smartCommit returns
        'abc' AND gitCommit was called with `formatCommitMessage(generated)`
        (i.e. the [PRP Auto] prefix + trailer are present).
      * generateMessage:true + gitDiff failure → smartCommit returns null, agent
        .prompt NEVER called, error logged.
      * generateMessage:true + generateCommitMessage throws → smartCommit returns
        null (outer catch), error logged, gitCommit NEVER called.
      * BACKWARD COMPAT: smartCommit(path, msg) with NO options → gitDiff NEVER
        called, agent NEVER instantiated, gitCommit called with
        formatCommitMessage(msg). (This is the regression guard.)
  - KEEP every existing test unchanged. Run the full file — 100% coverage must hold.

Task 4: CREATE tests/unit/agents/commit-message-agent.test.ts — factory assertions
  - IMPORT: `import { createCommitMessageAgent } from '../../../src/agents/commit-message-agent.js';`
  - MOCK createBaseConfig (from agent-factory.js) to return a known fixture, so
    the test does not require real harness/env resolution:
        vi.mock('../../../src/agents/agent-factory.js', () => ({
          createBaseConfig: vi.fn(() => ({ name:'x', model:'zai/glm-5.2',
            harness:'pi', enableCache:true, enableReflection:true, maxTokens:4096,
            env:{ANTHROPIC_API_KEY:'',ANTHROPIC_BASE_URL:''} })),
        }));
    AND mock createAgent to capture the config:
        vi.mock('groundswell', () => ({ createAgent: vi.fn((cfg) => ({ __cfg: cfg })) }));
  - ASSERT: createCommitMessageAgent() produces a config with name=
    'CommitMessageAgent', maxTokens=512, enableReflection=false,
    enableCache=false, NO mcps key, and system containing 'conventional' /
    'imperative'. This locks the D1 overrides.
  - PLACEMENT: tests/unit/agents/commit-message-agent.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// ── Pattern: COMMIT_MESSAGE_SYSTEM prompt (Task 1) ──
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Follow Conventional Commits (https://www.conventionalcommits.org/):
- Type prefix: feat, fix, refactor, docs, chore, test, perf, build, ci.
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).
- If a work-item id appears in changed paths (e.g. P3.M1.T3.S1), reference it in the subject.

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;

// ── Pattern: buildCommitMessageUserPrompt helper (Task 2) ──
function buildCommitMessageUserPrompt(diff: string): string {
  return [
    'Generate a git commit message for the staged diff below.',
    'Follow the formatting rules in your system instructions exactly.',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n');
}

// ── Pattern: generateCommitMessage boundary (Task 2, D2) ──
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError('stagecoach commit-message generation failed: empty staged diff');
  }
  const agent = createCommitMessageAgent();
  const prompt = createPrompt({ user: buildCommitMessageUserPrompt(diff), responseFormat: z.string() });
  const r = await agent.prompt(prompt);
  if (r.status === 'error') {
    throw new AgentError(
      `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
    );
  }
  const message = (r.data ?? '').trim();
  if (!message || message === 'skip') {
    throw new AgentError('stagecoach commit-message generation failed: empty agent output');
  }
  return message;
}

// ── Pattern: smartCommit generateMessage branch (Task 2, D3/D4/D5) ──
// (inside smartCommit, after `if (!addResult.success) return null;`)
let formatted: string;
if (options?.generateMessage) {
  const diffResult = await gitDiff({ path: repoRoot, staged: true });
  if (!diffResult.success) {
    logger().error(`Git diff (staged) failed: ${diffResult.error}`);
    return null;
  }
  const generated = await generateCommitMessage(diffResult.diff ?? ''); // throws AgentError → outer catch
  formatted = formatCommitMessage(generated);                          // wraps prefix + trailer (D5)
} else {
  formatted = formatCommitMessage(message);                            // DEFAULT — byte-identical
}
const commitResult = await gitCommit({ path: repoRoot, message: formatted });
```

### Integration Points

```yaml
CONFIG:
  - no new env vars (COMMIT_RETRY_* are P3.M1.T4.S1 — explicitly out of scope).

MODULE EXPORTS:
  - src/utils/git-commit.ts: EXPORT `SmartCommitOptions` (interface) and
    `generateCommitMessage(diff): Promise<string>` (boundary). smartCommit's
    signature widens to `(sessionPath, message, options?)`.
  - src/agents/commit-message-agent.ts: EXPORT `createCommitMessageAgent()`.

IMPORTS (new, in git-commit.ts):
  - gitDiff from '../tools/git-mcp.js' (added to existing import line)
  - AgentError from './errors.js'
  - createPrompt from 'groundswell'
  - z from 'zod'
  - createCommitMessageAgent from '../agents/commit-message-agent.js'

IMPORTS (new, in commit-message-agent.ts):
  - createAgent from 'groundswell'
  - createBaseConfig from './agent-factory.js'

NO DATABASE / NO ROUTES / NO REGISTRY / NO AGENT-PERSONA CHANGES.

DOWNSTREAM (this task ENABLES but does NOT implement):
  - P3.M1.T3.S2 (two-phase pre/post-cleanup commits in executeSubtask): will
    call smartCommit(path, fallback, { generateMessage: true }) at the
    pre-cleanup survival commit and the post-cleanup commit. This task's
    smartCommit signature + generateMessage option is the contract S2 consumes.
  - P3.M1.T4.S1 (bounded retry): will wrap generateCommitMessage in
    retryAgentPrompt with COMMIT_RETRY_MAX/COMMIT_RETRY_DELAY. This task's
    AgentError-throwing boundary is the retry contract.
  - P3.M1.T4.S2 (fallback placeholder): on retry exhaustion, will call
    smartCommit with a pre-formatted placeholder (may bypass formatCommitMessage
    per PRD §5.1 — that decision is S2's, not this task's).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint . --ext .ts — zero errors
npm run typecheck       # tsc --noEmit — zero errors (watch SmartCommitOptions + the 3rd param)
npm run format:check    # prettier --check — zero diffs (run `npm run format` to fix)
# Expected: clean. A type error here usually means createPrompt/z import or
# the AgentError constructor signature was wrong — read errors.ts:422 first.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The modified existing suite (default path unchanged + new generateMessage tests):
npx vitest run tests/unit/utils/git-commit.test.ts --reporter=verbose

# The new factory test:
npx vitest run tests/unit/agents/commit-message-agent.test.ts -v

# The integration suite (mocks smartCommit wholesale — must stay green unchanged):
npx vitest run tests/integration/smart-commit.test.ts -v

# Full suite:
npm run test:run   # or `npm run validate` (lint + format + typecheck + test)
# Expected: all green. If a default-path test now hits the agent mock, the
# generateMessage branch is not properly gated (the agent must instantiate ONLY
# inside generateCommitMessage, which only the generateMessage branch calls).
```

### Level 3: Integration Testing (generation boundary proof)

```bash
# Manual end-to-end generation proof against a real git repo + real LLM:
# (requires API keys configured; skip in CI — run locally to confirm wiring)
node --input-type=module -e '
import { generateCommitMessage } from "./src/utils/git-commit.ts";
try {
  const msg = await generateCommitMessage("diff --git a/a.ts b/a.ts\n+export const x = 1;");
  console.log("GENERATED:", JSON.stringify(msg));
  console.log("has [PRP Auto] prefix:", msg.includes("[PRP Auto]") === false); // expect true (prefix added later)
} catch (e) {
  console.error("THREW:", e.constructor.name, e.message);
  const { isTransientError } = await import("./src/utils/retry.ts");
  console.log("isTransient:", isTransientError(e)); // expect true (the P3.M1.T4 contract)
}
'
# Expected: a conventional-commit message WITHOUT [PRP Auto] (added by smartCommit),
# OR a thrown AgentError classified transient by isTransientError.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Coverage gate (the generateCommitMessage branches + smartCommit generateMessage
# branch must all be covered for the 100% threshold in vitest.config.ts):
npx vitest run tests/unit/utils/git-commit.test.ts tests/unit/agents/commit-message-agent.test.ts --coverage
# Expected: src/utils/git-commit.ts and src/agents/commit-message-agent.ts at
# 100% line/branch coverage. If the 'gitDiff failure → null' branch or the
# 'empty output → throw' branch is uncovered, add the missing test case.

# Backward-compat regression check (prove the default path is untouched):
git stash   # before implementing, capture baseline
npm run test:run -- tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts 2>&1 | tail -3
git stash pop
# After implementing, the SAME commands must show the SAME default-path tests passing.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run lint && npm run typecheck && npm run format:check` GREEN
- [ ] Level 2: modified `git-commit.test.ts` GREEN (default path unchanged + new
      generateMessage:true + boundary describe blocks) + new
      `commit-message-agent.test.ts` GREEN + integration `smart-commit.test.ts`
      GREEN unchanged
- [ ] Level 3: manual e2e produces a conventional-commit message OR a transient
      AgentError (run locally with API keys)
- [ ] Full suite: `npm run validate` GREEN

### Feature Validation

- [ ] Backward compat: `smartCommit(path, msg)` (no options) byte-identical —
      regression-guard test passes
- [ ] Opt-in generation: `smartCommit(path, fb, {generateMessage:true})` calls
      gitDiff(staged) → generateCommitMessage → formatCommitMessage → gitCommit
- [ ] Boundary contract: generateCommitMessage throws AgentError on empty diff /
      agent error / empty output; `isTransientError(thrown) === true`
- [ ] smartCommit never throws: generation failure → null return + error log
- [ ] Message formatting: LLM output wrapped in `[PRP Auto] … Co-Authored-By`
- [ ] No new config; no persona expansion; orchestrator call site unchanged

### Code Quality Validation

- [ ] `AgentPersona` union and `PERSONA_TOKEN_LIMITS` unchanged (reused
      `createBaseConfig('researcher','research')`)
- [ ] `src/config/constants.ts` unchanged (no `COMMIT_RETRY_*` — that is S4)
- [ ] `smartCommit` outer try/catch + null-on-failure contract preserved
- [ ] Zero new runtime dependencies (`git diff package.json` shows no dep changes
      — reuses `groundswell` + `zod`)
- [ ] JSDoc on `smartCommit` documents both paths + two-phase commit support
      (Mode A doc rides with the work per contract item 5)

### Documentation & Deployment

- [ ] `SmartCommitOptions` + `generateCommitMessage` JSDoc'd (transient-API-
      sensitive boundary, consumed by P3.M1.T4 retry)
- [ ] `createCommitMessageAgent` JSDoc'd (why researcher persona, why no mcps)
- [ ] No user-facing CLI/config change (internal capability) — matches contract
      item 4 OUTPUT ("Consumed by P3.M1.T3.S2, P3.M1.T4.S1") and item 5 DOCS
      (Mode A JSDoc on smartCommit)

---

## Anti-Patterns to Avoid

- ❌ **Do NOT expand the `AgentPersona` union.** It ripples into
      `PERSONA_TOKEN_LIMITS` and every factory. Reuse
      `createBaseConfig('researcher','research')` with overrides in a new thin
      module.
- ❌ **Do NOT add retry or `COMMIT_RETRY_*` config here.** That is P3.M1.T4.S1's
      deliverable. `generateCommitMessage` is a single unwrapped throw-on-failure
      boundary; the retry layer wraps it later. Adding retry now duplicates S1's
      scope and risks a wrong backoff config.
- ❌ **Do NOT let `smartCommit` throw.** Its documented contract (and the
      orchestrator's never-fail-on-commit assumption) is "returns null on any
      failure to allow pipeline to continue." `generateCommitMessage` throws;
      smartCommit's outer try/catch converts that to a null return + log.
- ❌ **Do NOT call `gitDiff` before `gitAdd`.** The diff must reflect the
      filtered staged set; a pre-`gitAdd` diff includes unstaged changes the
      commit will not contain → a misleading message.
- ❌ **Do NOT skip `formatCommitMessage` for the generated message.** Every commit
      keeps the `[PRP Auto]` prefix + Co-Authored-By trailer. The agent emits
      ONLY subject+body (system prompt forbids prefix/trailer); the caller wraps.
- ❌ **Do NOT throw a generic `Error` from `generateCommitMessage`.** It MUST be
      `AgentError` (hardcoded `PIPELINE_AGENT_LLM_FAILED` → transient). A generic
      Error or ValidationError would NOT be retried by P3.M1.T4.S1, breaking the
      §5.1 "generation timeout SHOULD be retried" contract.
- ❌ **Do NOT alter the default path.** `smartCommit(path, msg)` (no options) must
      be byte-identical. Gate the agent instantiation INSIDE
      `generateCommitMessage` so default callers never import/instantiate it.
- ❌ **Do NOT trust untrimmed LLM output.** Always `.trim()` and guard for empty
      (or the sentinel `'skip'`). Committing an empty/whitespace message is worse
      than the templated one.
- ❌ **Do NOT add `mcps` to the commit-message agent.** It reads the diff from
      the prompt text; tool access would let it re-read files (slow, leaky, and
      unnecessary for a summarization task).