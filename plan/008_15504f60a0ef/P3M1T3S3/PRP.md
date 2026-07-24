# PRP — P3.M1.T3.S3: Create cleanup agent persona

---

## Goal

**Feature Goal**: Implement the **cleanup agent persona** mandated by PRD §4.2
step 4 and §9.3.3, completing the two-phase-commit pipeline assembled by
P3.M1.T3.S1 (stagecoach) and P3.M1.T3.S2 (the `CleanupRunner` seam + two-phase
wiring in `executeSubtask`). The cleanup agent is a **stateless single-shot**
agent (PRD §9.3.3 / Req "Stateless single-shot invocations") whose job is to
remove temporary artifacts (PRP scratch files), move generated docs to `docs/`,
and save `tasks.json` — and which is **absolutely forbidden** from touching
`plan/`, `PRD.md`, or any `PRP.md` (PRD §5.1 prompt-layer deletion protection).
This task fills the S2 no-op seam (`createCleanupRunner()`) with a runner that
invokes the real cleanup persona, so cleanup finally does real work instead of
returning `{ success: true, summary: 'cleanup disabled (no persona wired yet)' }`.

**Deliverable** (4 files: 2 modified, 2 created):
1. **`src/agents/prompts.ts`** — MODIFY: add `export const CLEANUP_PROMPT` (a
   system-prompt template literal that encodes the §4.2 cleanup job + the §5.1
   forbidden-paths rules), and register it in the `PROMPTS` map.
2. **`src/agents/agent-factory.ts`** — MODIFY: (a) add `'cleanup'` to the
   `AgentPersona` union; (b) add `cleanup: 4096` to `PERSONA_TOKEN_LIMITS`;
   (c) add `CLEANUP_PROMPT` to the `./prompts.js` import; (d) add a new
   `createCleanupAgent(): Agent` factory (mirrors `createCoderAgent` but with
   the cleanup persona + `CLEANUP_PROMPT`, fast tier via role `'implementation'`).
3. **`src/core/cleanup-runner.ts`** — MODIFY: **replace the no-op
   `createCleanupRunner()` body** (S2's placeholder) with a real runner that
   builds a runtime user prompt from `CleanupContext`, invokes
   `createCleanupAgent()`, checks `r.status`, and returns a `CleanupResult`. The
   seam types (`CleanupContext`, `CleanupResult`, `CleanupRunner`) stay byte-
   identical; only the factory's returned closure changes.
4. **`tests/unit/agents/cleanup-agent.test.ts`** — CREATE: unit tests for the
   persona factory (mirror `tests/unit/agents/commit-message-agent.test.ts`'s
   `vi.mock` pattern): asserts `createBaseConfig('cleanup', 'implementation')`,
   `name === 'CleanupAgent'`, `system === CLEANUP_PROMPT`, `mcps` IS defined
   (cleanup mutates the filesystem — unlike commit-message-agent which carries
   no tools), and the system prompt contains the forbidden-paths rules.
5. **`tests/unit/core/cleanup-runner.test.ts`** — MODIFY (S2 created it): add a
   new describe block asserting the default `createCleanupRunner()` now invokes
   the cleanup agent — i.e. it no longer returns the
   `'cleanup disabled (no persona wired yet)'` summary. Assert it builds a user
   prompt from `CleanupContext` (sessionPath + subtask.id + subtask.title),
   calls the agent, and maps `r.status` → `CleanupResult.success`. Mock
   `createCleanupAgent` so no real LLM call fires.

**Scope note (critical):** This task is **ONLY the cleanup persona + filling the
S2 seam**. It does NOT add retry/backoff around the cleanup call (cleanup is
non-fatal — S2 already wraps it in a swallowing try/catch; a bare
`withAgentDeadline` is optional but NOT required by this PRP), critical-file
deletion protection at the mechanical layer (`restore_critical_files` in
smartCommit — P3.M2.T4.S2), the orphaned-`plan/` skip-recovery (P3.M2.T5.S1), or
session-persistence auditing (P3.M2.T3.S1 — `AgentConfig` has no session field
yet; "stateless" here = single-shot invocation + `enableReflection: false` +
`enableCache: false`, exactly mirroring `commit-message-agent.ts`). It
**CONSUMES** S2's seam (treat S2's PRP as a contract) and S1's `smartCommit`
(stagecoach) — it PROVIDES no new seam.

**Success Definition**:
- A `'cleanup'` persona exists in `AgentPersona`; `createBaseConfig('cleanup',
  ...)` type-checks and yields `{ name: 'CleanupAgent', maxTokens: 4096, ... }`.
- `createCleanupAgent()` returns a Groundswell `Agent` whose `system` is
  `CLEANUP_PROMPT`, whose `mcps` is `MCP_TOOLS` (BashMCP + FilesystemMCP +
  GitMCP — cleanup mutates the filesystem), and whose model resolves to the
  **fast tier** via `ROLE_CONFIG.implementation`.
- `CLEANUP_PROMPT` (a) instructs removal of temp artifacts, moving docs to
  `docs/`, saving `tasks.json`; and (b) **forbids** `rm`/`git rm`/`git clean`/
  `mv` against `PRD.md`, any `PRP.md`, and anything under `plan/`, and forbids
  treating `PRD.md`/`PRP.md`/`tasks.json` as temporary (PRD §5.1 prompt layer).
- The default `createCleanupRunner()` (the one `new TaskOrchestrator(manager)`
  uses when no `cleanupRunner` is injected) **invokes the cleanup persona**:
  it builds a runtime user prompt from `CleanupContext`, calls
  `createCleanupAgent().prompt(...)`, and returns a `CleanupResult` whose
  `success` reflects the agent's `r.status`.
- Cleanup failure is still **non-fatal** to `executeSubtask` — the runner
  returns `{ success: false, error }` (or throws, caught by S2's nested
  try/catch) and the subtask still succeeds (the survival commit already
  persisted substance + status). **This invariant is owned by S2; S3 must not
  break it** (the runner may throw — S2 catches it).
- `npm run validate` GREEN; `package.json` `dependencies` unchanged.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop). Immediate
consumer: S2's `executeSubtask` success path, which calls
`this.#cleanupRunner({ sessionPath, subtask, repoRoot })` between the survival
commit and the post-cleanup commit.
**Use Case**: After a subtask passes validation and its substance is committed
(the survival commit), its leftover scratch artifacts (PRP research notes, temp
files) must be removed and any generated documentation moved into `docs/` so the
repo stays clean — then that reorganization is committed in the post-cleanup
commit (S2).
**User Journey**: orchestrator success path → survival `smartCommit` (S2) →
`#cleanupRunner(ctx)` → **[THIS TASK]** runner builds user prompt from `ctx` →
`createCleanupAgent().prompt(prompt)` → agent uses MCP file tools to remove
temp artifacts + move docs to `docs/` + save `tasks.json` → returns summary
string → runner maps to `CleanupResult` → orchestrator's second `flushUpdates`
+ post-cleanup `smartCommit`.
**Pain Points Addressed**: PRD §4.2 step 4 "Cleanup" — today the S2 seam is a
**no-op** (`{ success: true, summary: 'cleanup disabled (no persona wired
yet)' }`), so the post-cleanup commit always finds nothing to commit and the
repo accumulates scratch artifacts. This task makes cleanup real. The
forbidden-paths rules (PRD §5.1) prevent the cleanup agent — the one agent that
is explicitly licensed to delete things — from wiping `PRD.md`/`PRP.md`/`plan/`.

---

## Why

- **PRD compliance**: PRD §4.2 (h3.4) step 4 names "Cleanup: Temporary
  artifacts are removed; documentation is moved to `docs/`." and §9.3.3 (h4.10)
  names cleanup as a stateless single-shot persona. PRD §5.1 (h3.9) mandates the
  **prompt layer** of critical-file deletion protection: every deletion-capable
  agent prompt (cleanup included) forbids `rm`/`git rm`/`git clean`/`mv` against
  `PRD.md`, any `PRP.md`, or anything under `plan/`. `architecture/phase_findings.md`
  §PHASE 3 Finding G5 documents: "no cleanup persona exists in agent-factory.ts
  (only architect, researcher, coder, qa)." This task closes that gap.
- **Contract item 3 (LOGIC) full coverage**:
  - (a) *"Add a 'cleanup' persona to AgentPersona type in agent-factory.ts."* →
    extend the union + `PERSONA_TOKEN_LIMITS` (so `createBaseConfig('cleanup')`
    type-checks + resolves a token limit).
  - (b) *"Create createCleanupAgent() factory — implementation role (fast tier),
    stateless (no session persistence per Req 3.7), with a CLEANUP_PROMPT system
    prompt."* → new factory mirroring `createCoderAgent` (role `'implementation'`
    → fast tier via `ROLE_CONFIG`); "stateless" = single-shot invocation +
    `enableReflection: false` + `enableCache: false` (there is no session field
    on `AgentConfig` yet — P3.M2.T3.S1 audits that later).
  - (c) *"The cleanup prompt instructs: remove temporary artifacts (PRP scratch
    files), move generated docs to docs/, save tasks.json. It MUST NOT touch
    plan/, PRD.md, or PRP.md (deletion protection per Req 3.8)."* → the
    `CLEANUP_PROMPT` content.
  - (d) *"Add CLEANUP_PROMPT to src/agents/prompts.ts."* → new `export const
    CLEANUP_PROMPT` + `PROMPTS.CLEANUP` entry.
  - (e) *"Wire the cleanup agent into the executeSubtask two-phase commit flow
    between pre-cleanup and post-cleanup commits."* → S2 already wires the flow
    (`#cleanupRunner` between the two commits); this task fills the runner so it
    actually invokes the persona. **No `task-orchestrator.ts` edit is needed** —
    the seam is consumed as-is.
- **Design rationale (union-expansion vs thin-factory)**: Two precedents exist.
  The thin-factory precedent (`commit-message-agent.ts`) reuses
  `createBaseConfig('researcher')` and avoids expanding the union. **However the
  contract item 3(a) explicitly mandates** "Add a 'cleanup' persona to
  AgentPersona type in agent-factory.ts" and item 3(d) mandates "Add CLEANUP_PROMPT
  to src/agents/prompts.ts". This task therefore follows the **core-persona
  precedent** (`createCoderAgent`/`createQAAgent`): union member + token-limit
  key + `PROMPTS` entry + factory in `agent-factory.ts`. This is non-negotiable —
  it is the contract.

---

## What

Two modified production modules (`prompts.ts`, `agent-factory.ts`), one modified
core module (`cleanup-runner.ts` — fill the no-op), one new + one modified test
file.

### Success Criteria

- [ ] **`AgentPersona` includes `'cleanup'`**: the union at
      `agent-factory.ts` reads `'architect' | 'researcher' | 'coder' | 'qa' |
      'cleanup'`. Verified by `tsc --noEmit` + a test asserting
      `createBaseConfig('cleanup')` returns a config with `maxTokens === 4096`.
- [ ] **`PERSONA_TOKEN_LIMITS` has a `cleanup` key** (value `4096`, matching the
      researcher/coder/qa tier). Verified by `createBaseConfig('cleanup')` not
      indexing `undefined`.
- [ ] **`createCleanupAgent()` factory exists** in `agent-factory.ts` (mirrors
      `createCoderAgent`): calls `createBaseConfig('cleanup', 'implementation')`,
      overrides `system: CLEANUP_PROMPT`, sets `mcps: MCP_TOOLS`, returns
      `createAgent(config)`. Verified by a unit test asserting the
      `createBaseConfig` call args + the captured `createAgent` config.
- [ ] **Cleanup agent carries MCP tools**: the captured `createAgent` config has
      `mcps` defined (=== `MCP_TOOLS`). **This diverges from commit-message-agent
      (no tools) — cleanup mutates the filesystem.** Verified by
      `expect(cfg.mcps).toBeDefined()`.
- [ ] **Cleanup agent is stateless single-shot**: `enableReflection: false` and
      `enableCache: false` (matches `commit-message-agent.ts`; cleanup is a
      one-shot reorg, no reflection loop, no cacheable prompt). Verified by a
      test. *(Note: there is no `AgentConfig.session` field yet — P3.M2.T3.S1
      handles mechanical session-persistence disabling; "stateless" here is
      achieved via single-shot invocation + these flags.)*
- [ ] **`CLEANUP_PROMPT` exists** in `prompts.ts` as an exported template-literal
      const, registered in the `PROMPTS` map as `CLEANUP`. Verified by import +
      `PROMPTS.CLEANUP === CLEANUP_PROMPT`.
- [ ] **`CLEANUP_PROMPT` encodes the cleanup job**: contains explicit
      instructions to (i) remove temporary artifacts (PRP scratch files / temp
      build outputs), (ii) move generated docs to `docs/`, (iii) save
      `tasks.json`. Verified by `expect(CLEANUP_PROMPT).toContain('docs/')` etc.
- [ ] **`CLEANUP_PROMPT` encodes deletion protection (PRD §5.1)**: explicitly
      forbids `rm`, `git rm`, `git clean`, and `mv` against `PRD.md`, any
      `PRP.md`, and anything under `plan/`; forbids treating `PRD.md`,
      `PRP.md`, or `tasks.json` as "temporary." Verified by string-content
      assertions on each forbidden token + path.
- [ ] **`createCleanupRunner()` invokes the cleanup persona**: the default runner
      (the one `new TaskOrchestrator(manager)` uses) builds a runtime user prompt
      from `CleanupContext`, calls `createCleanupAgent().prompt(prompt)`, and
      returns a `CleanupResult` whose `success` mirrors `r.status === 'success'`.
      The old no-op summary `'cleanup disabled (no persona wired yet)'` is GONE.
      Verified by mocking `createCleanupAgent` + `createPrompt`/`agent.prompt`
      and asserting the agent is called + the result maps status.
- [ ] **Runner maps agent status → CleanupResult**: on `r.status === 'success'`,
      `{ success: true, summary: <r.data> }`; on `r.status === 'error'` or
      `'partial'`, `{ success: false, error: <r.error?.message> }`. Verified by
      parameterized tests.
- [ ] **Runner builds user prompt from `CleanupContext`**: the user prompt passed
      to `createPrompt` contains `ctx.sessionPath`, `ctx.subtask.id`, and
      `ctx.subtask.title`, plus the operational instructions (move docs, remove
      temp, save tasks.json) and a restatement of the forbidden paths. Verified
      by capturing the `createPrompt` user string in a test.
- [ ] **Non-fatal invariant preserved (S2 owns this; S3 must not break it)**:
      when the cleanup persona's `agent.prompt` rejects, the runner EITHER
      returns `{ success: false, error }` OR lets the throw propagate (S2's
      nested try/catch at `task-orchestrator.ts` swallows it either way). S3's
      runner MUST NOT add a catch-and-rethrow that turns a cleanup failure into a
      subtask failure. Verified by a test asserting a throwing mock agent does
      not crash the runner into a non-recoverable state (it throws, and S2's
      catch handles it — assert the runner itself does not swallow-then-rethrow
      as a different error type).
- [ ] **No orchestrator edit**: `task-orchestrator.ts` is UNCHANGED. Verified by
      `git diff --stat src/core/task-orchestrator.ts` showing no modifications.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names the exact union
line to extend, the exact token-limit object to extend, the exact factory shape
to mirror (`createCoderAgent`), the exact `CLEANUP_PROMPT` content requirements
(quoting PRD §4.2 + §5.1 verbatim), the exact seam to fill (the no-op
`createCleanupRunner` body), the exact invocation pattern (`createPrompt` +
`r.status` check, from `git-commit.ts:168`), the exact test mock pattern
(`commit-message-agent.test.ts`), and the exact reasons the alternative
thin-factory approach is rejected (the contract mandates union expansion).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://www.conventionalcommits.org/en/v1.0.0/
  why: NOT for the prompt content, but to understand the post-cleanup commit
       context — the cleanup agent's doc reorganization is committed by S2's
       stagecoach (S1) which generates a conventional-commit message. The
       cleanup agent itself does NOT commit (it mutates the working tree; S2
       commits). Keep this boundary clear: the agent moves files, S2 commits.
  critical: The cleanup agent MUST NOT run `git commit` itself — that would
            race with S2's post-cleanup smartCommit and double-commit. The
            CLEANUP_PROMPT must forbid `git commit` / `git add` (delegation
            boundary), even though it carries GitMCP for read-only inspection.

- file: src/agents/commit-message-agent.ts
  why: THE STATELESS-SINGLE-SHOT TEMPLATE. A thin factory that reuses
       createBaseConfig, overrides name/system/maxTokens, sets
       enableReflection:false + enableCache:false, and returns createAgent(config).
       This is the exact config-override SHAPE the cleanup factory must mirror —
       EXCEPT cleanup also sets `mcps: MCP_TOOLS` (it mutates the filesystem).
       ALSO the canonical "how to invoke an agent" reference lives in its caller
       src/utils/git-commit.ts:168-189 (createPrompt + r.status check).
  pattern: read the FULL file. Note the lazy logger accessor
           `let _logger; const logger = () => (_logger ??= getLogger('X'))`.
  gotcha: commit-message-agent reuses persona 'researcher' to AVOID expanding
          the union. The cleanup task MUST expand the union (contract item 3a)
          — so the cleanup factory lives in agent-factory.ts (next to
          createCoderAgent), NOT in a separate thin-factory file. Do not copy
          commit-message-agent's "reuse researcher" trick for cleanup.

- file: src/agents/agent-factory.ts
  why: THE PRIMARY EDIT for the persona. (1) AgentPersona union (~line 98) —
       add `| 'cleanup'`. (2) PERSONA_TOKEN_LIMITS (~line 173-178, `as const`)
       — add `cleanup: 4096,`. (3) import block from './prompts.js' (~line 56)
       — add CLEANUP_PROMPT. (4) ADD createCleanupAgent() factory after
       createQAAgent (~line 410), mirroring createCoderAgent's shape but with
       createBaseConfig('cleanup', 'implementation') and system: CLEANUP_PROMPT.
  pattern: READ createCoderAgent (lines ~360-380) and createQAAgent (~390-410)
           — they show the exact `{ ...baseConfig, system, mcps: MCP_TOOLS }`
           spread + logger().debug + return createAgent(config) shape. The
           cleanup factory is a 4th sibling.
  gotcha: ROLE_CONFIG is UNCHANGED — the three roles (research/reasoning/
          implementation) already exist. Cleanup uses 'implementation' (fast
          tier) per contract item 3(b). createBaseConfig('cleanup',
          'implementation') resolves tier via ROLE_CONFIG.implementation.tier
          === 'fast' and model via getModel('fast'). Do NOT add a role.
  gotcha: enableReflection + enableCache come from createBaseConfig as TRUE by
          default. The cleanup factory MUST override them to FALSE (stateless
          single-shot) — add them to the spread config object explicitly, like
          commit-message-agent.ts does.

- file: src/agents/prompts.ts
  why: ADD CLEANUP_PROMPT. Declaration pattern (see BUG_HUNT_PROMPT ~line 918):
       `export const CLEANUP_PROMPT = \`\n# ...\n${PRD_PREMERGED_DECLARATION}\n
       ...\n\`;` (template literal; inject PRD_PREMERGED_DECLARATION after the
       H1 to match the 4 core-persona prompts). THEN register in the PROMPTS
       map (~line 1042): add `CLEANUP: CLEANUP_PROMPT,`.
  pattern: READ BUG_HUNT_PROMPT (lines ~910-1040) for the JSDoc + template
           structure. The cleanup prompt is SHORTER (it is a focused reorg
           task, not a creative bug-hunt) — aim for ~40-80 lines.
  gotcha: the 4 core persona prompts do NOT use `as const`; DELTA_PRD and
          DELTA_ANALYSIS do. Match the core-persona convention (no `as const`)
          for CLEANUP_PROMPT so it is a plain string assignable to AgentConfig.system.
  gotcha: PRD_PREMERGED_DECLARATION (line 34) is injected because the cleanup
          prompt may reference the PRD; even if it does not embed PRD text,
          matching the convention is harmless and keeps the prompt consistent
          with its siblings.

- file: src/core/cleanup-runner.ts   # S2 created it; S3 FILLS the no-op
  why: THE SEAM TO FILL. S2 created CleanupContext/CleanupResult/CleanupRunner
       types (byte-identical to the Data-models block below) and a no-op
       createCleanupRunner() returning { success:true, summary:'cleanup
       disabled (no persona wired yet)' }. S3 REPLACES ONLY the closure body
       of createCleanupRunner — the types and signature stay identical.
  pattern: READ the full file. The new body: import createCleanupAgent from
           '../agents/agent-factory.js' + createPrompt + z from 'zod'; build a
           user prompt string from ctx; const r = await agent.prompt(prompt);
           map r.status → CleanupResult. Wrap in try/catch that returns
           { success:false, error } on unexpected throw (so the runner is
           robust; S2's catch is the outer belt-and-suspenders).
  gotcha: IMPORT CYCLE CHECK — cleanup-runner.ts (core/) → agent-factory.ts
          (agents/) → (config/*, utils/logger, agents/prompts.ts, tools/*).
          Nothing in the agents/ chain imports back into core/, so NO cycle.
          Verified by scout recon. The Subtask import in cleanup-runner.ts is
          ALREADY type-only (`import type { Subtask }`) — leave it.
  gotcha: do NOT change the CleanupRunner type signature or add a parameter to
          createCleanupRunner — S2's orchestrator calls
          `this.#cleanupRunner({ sessionPath, subtask, repoRoot })` with NO
          extra args. The agent is created INSIDE the returned closure (lazy —
          one agent per cleanup invocation, matching single-shot semantics).

- file: src/utils/git-commit.ts   # lines 168-189
  why: THE CANONICAL AGENT-INVOCATION PATTERN. generateCommitMessage() shows:
       const agent = createCommitMessageAgent();
       const prompt = createPrompt({ user: buildXUserPrompt(data),
       responseFormat: z.string() });
       const r = await agent.prompt(prompt);
       if (r.status === 'error') { throw new AgentError(...) }
       const text = (r.data ?? '').trim();
       This is EXACTLY the shape the cleanup runner must follow (substitute
       createCleanupAgent + buildCleanupUserPrompt(ctx)).
  pattern: copy the createPrompt + r.status check + r.data extraction. Use
           responseFormat: z.string() (cleanup returns a free-text summary,
           matching CleanupResult.summary being a plain string).
  gotcha: git-commit THROWS AgentError on failure (because smartCommit's caller
          retries). The cleanup runner must NOT throw on agent failure — it
          returns { success:false, error } instead (S2 treats cleanup as
          non-fatal). Only throw on truly unexpected errors (S2 catches those
          too). Do NOT import AgentError unless you choose to wrap unexpected
          errors; preferring a { success:false } return is simpler + safer.

- file: tests/unit/agents/commit-message-agent.test.ts
  why: THE TEST PATTERN TO MIRROR for the new cleanup-agent.test.ts. Two vi.mock
       calls: (1) mock '../../../src/agents/agent-factory.js' → { createBaseConfig:
       vi.fn(fixture) }; (2) mock 'groundswell' → { createAgent: vi.fn(cfg =>
       ({__cfg: cfg})) }. Then assert createBaseConfig called with the right
       (persona, role) + read the captured config via
       mockCreateAgent.mock.calls[0][0].
  pattern: READ the full file. The cleanup test asserts
           createBaseConfig('cleanup', 'implementation'), cfg.name ===
           'CleanupAgent', cfg.system === CLEANUP_PROMPT, cfg.mcps IS defined,
           cfg.enableReflection === false, cfg.enableCache === false.
  gotcha: the cleanup test MUST import the REAL CLEANUP_PROMPT from
          '../../../src/agents/prompts.js' (do NOT mock prompts.ts) so the
          assertion `cfg.system === CLEANUP_PROMPT` ties the factory to the
          actual prompt constant. But createBaseConfig is mocked, so the
          prompts.ts import inside agent-factory.ts is not exercised — that is
          fine; the assertion is on the spread value.

- file: tests/unit/core/cleanup-runner.test.ts   # S2 created it; S3 EXTENDS
  why: S2's test asserts the no-op default. S3 ADDS a describe block asserting
       the default now invokes the cleanup persona. Mock
       '../../../src/agents/agent-factory.js' → { createCleanupAgent: vi.fn(()
       => ({ prompt: vi.fn() })) } so no real agent/LLM fires. Assert: the mock
       agent.prompt is called once; the user prompt contains sessionPath +
       subtask.id; on r.status==='success' the runner returns
       { success:true, summary }; on 'error' returns { success:false, error }.
  pattern: READ the existing S2 tests in this file first (the no-op assertion
       will now FAIL — UPDATE/REPLACE it; the no-op summary string is gone).
  gotcha: the S2 no-op test `expect(result.summary).toBe('cleanup disabled
          (no persona wired yet)')` MUST be removed/updated — that string no
          longer exists. Do not leave a stale failing test.

- file: plan/008_15504f60a0ef/P3M1T3S2/PRP.md
  why: THE CONTRACT for the seam. Defines CleanupContext { sessionPath, subtask,
       repoRoot }, CleanupResult { success, summary?, error? }, CleanupRunner,
       and the no-op createCleanupRunner default. S3 fills the default. Also
       confirms the non-fatal invariant: S2's task-orchestrator wraps
       #cleanupRunner in a nested try/catch that swallows — so the runner may
       throw or return success:false freely.
  pattern: treat the seam types as FROZEN. Do not rename fields.
  gotcha: repoRoot === process.cwd() (S2 passes it). The cleanup agent operates
          at repo root — its file moves are relative to repoRoot, NOT
          sessionPath. sessionPath is the plan/{seq}_{hash}/ work dir whose
          research/* the agent may move to docs/ (but it must NOT delete
          sessionPath itself — that is under plan/).

- docfile: plan/008_15504f60a0ef/P3M1T3S3/research/scout1-persona-pattern.md
  why: full recon of the persona/factory/prompt/test pattern with exact line refs.
  section: §1-§7 (the summary table is the change list).

- docfile: plan/008_15504f60a0ef/P3M1T3S3/research/scout2-invocation-layout.md
  why: full recon of the agent.prompt invocation pattern + module-layout decision
       + import-cycle check.
  section: §1 (git-commit.ts:168 invocation) + §3 (seam already exists) + §5
           (layout — note: scout2 recommended the thin-factory approach, but the
           CONTRACT item 3a/3d mandates union-expansion; follow the contract).
```

### Current Codebase tree (relevant slice)

```bash
src/
  agents/
    prompts.ts               # MODIFY — add CLEANUP_PROMPT + PROMPTS.CLEANUP
    agent-factory.ts         # MODIFY — union + token-limits + import + createCleanupAgent()
  core/
    cleanup-runner.ts        # MODIFY (S2 created) — fill the no-op createCleanupRunner body
    task-orchestrator.ts     # READ-ONLY — S2 already wires #cleanupRunner; UNCHANGED by S3
    models.ts                # READ — Subtask type (type-only import in cleanup-runner)
  utils/
    git-commit.ts            # READ — canonical agent.prompt invocation pattern (lines 168-189)
    logger.ts                # READ — getLogger(name) signature
tests/
  unit/
    agents/
      cleanup-agent.test.ts        # CREATE — persona factory tests (mirror commit-message-agent.test.ts)
      commit-message-agent.test.ts # READ — the mock pattern to mirror
    core/
      cleanup-runner.test.ts       # MODIFY (S2 created) — replace no-op assertion with persona-invocation tests
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/agents/prompts.ts
  # MODIFIED: + export const CLEANUP_PROMPT (system prompt: cleanup job + §5.1
  #   forbidden-paths rules) + PROMPTS.CLEANUP entry + PromptKey now includes 'CLEANUP'.
src/agents/agent-factory.ts
  # MODIFIED: AgentPersona union += 'cleanup'; PERSONA_TOKEN_LIMITS += cleanup:4096;
  #   import += CLEANUP_PROMPT; + createCleanupAgent() factory (cleanup persona,
  #   implementation role → fast tier, mcps: MCP_TOOLS, enableReflection:false,
  #   enableCache:false, system: CLEANUP_PROMPT).
src/core/cleanup-runner.ts
  # MODIFIED: createCleanupRunner() body REPLACED — builds a user prompt from
  #   CleanupContext, invokes createCleanupAgent().prompt(...), maps r.status →
  #   CleanupResult. Types (CleanupContext/Result/Runner) UNCHANGED.
tests/unit/agents/cleanup-agent.test.ts
  # NEW: factory tests — createBaseConfig('cleanup','implementation'), name ===
  #   'CleanupAgent', system === CLEANUP_PROMPT, mcps defined, reflection/cache off.
tests/unit/core/cleanup-runner.test.ts
  # MODIFIED: REPLACE the S2 no-op summary assertion with a describe block that
  #   mocks createCleanupAgent and asserts the runner invokes it, builds the user
  #   prompt from ctx, and maps r.status → CleanupResult.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the contract (item 3a/3d) MANDATES union-expansion + CLEANUP_PROMPT
// in prompts.ts. Do NOT follow commit-message-agent's "reuse researcher persona,
// avoid union expansion" trick — that was a deliberate choice for stagecoach
// (P3.M1.T3.S1) where no contract required a persona. Cleanup's contract does.

// CRITICAL: cleanup MUST carry mcps: MCP_TOOLS (BashMCP + FilesystemMCP + GitMCP).
// commit-message-agent OMITS mcps (it reads a diff from the prompt text). Cleanup
// actually mutates the filesystem (move docs, remove temp, save tasks.json), so
// it needs the file/bash tools. Forgetting mcps is the #1 way this silently fails.

// CRITICAL: the cleanup agent MUST NOT run `git commit` or `git add` — S2's
// stagecoach smartCommit does the post-cleanup commit. If the agent commits,
// it races with smartCommit and double-commits or commits nothing. The
// CLEANUP_PROMPT must FORBID git commit / git add (read-only git is fine).

// CRITICAL: PRD §5.1 prompt-layer deletion protection. The CLEANUP_PROMPT must
// forbid rm / git rm / git clean / mv against: PRD.md, **/PRP.md, plan/**.
// AND forbid treating PRD.md / PRP.md / tasks.json as "temporary." This is the
// prompt layer; the mechanical layer (restore_critical_files) is P3.M2.T4.S2.

// CRITICAL: "stateless" (Req 3.7) is achieved via SINGLE-SHOT invocation +
// enableReflection:false + enableCache:false. AgentConfig has NO session field
// yet — P3.M2.T3.S1 audits/disables session persistence mechanically later.
// Do NOT add a fictional session field. Do NOT pass --no-session anywhere
// (no such wiring exists yet).

// GOTCHA: Groundswell's agent.prompt() NEVER throws on LLM failure — it returns
// { status: 'error', error: AgentErrorDetails }. You MUST check r.status.
// (Confirmed: groundswell agent.d.ts AgentResponseStatus = 'success'|'error'|
// 'partial'; r.data is non-null only on success/partial.) See git-commit.ts:178.

// GOTCHA: the cleanup runner is NON-FATAL. S2's task-orchestrator wraps
// #cleanupRunner in a nested try/catch that swallows. So the runner may return
// { success:false } OR throw — both are handled. Prefer returning
// { success:false, error } for agent failures (cleaner); let only truly
// unexpected throws propagate (S2 catches them). Do NOT catch-and-rethrow as
// a different error type — that would just be noise S2 re-catches.

// GOTCHA: the agent is created INSIDE the returned closure (lazy, per-call),
// NOT at module load. This preserves S2's "createCleanupRunner returns a
// callable" contract and means a failed agent construction surfaces at cleanup
// time (not pipeline boot). It also means each cleanup gets a fresh agent
// (correct for single-shot semantics — no shared session/state).

// GOTCHA: Subtask is imported TYPE-ONLY in cleanup-runner.ts (`import type {
// Subtask }`) — S2 already did this to avoid the runtime cycle through the
// heavy models.ts. Leave it type-only. The cleanup-runner.ts → agent-factory.ts
// → ... chain has NO cycle (agents/ never imports core/).
```

---

## Implementation Blueprint

### Data models and structure

No new types — S2's seam types are frozen. The only new "data" is the
`CLEANUP_PROMPT` string constant + the runtime user-prompt builder. The runner
fills the existing contract:

```typescript
// src/core/cleanup-runner.ts — S2's FROZEN types (do NOT modify):
import type { Subtask } from './models.js';
export interface CleanupContext {
  readonly sessionPath: string;   // plan/{seq}_{hash}/
  readonly subtask: Subtask;
  readonly repoRoot: string;      // process.cwd()
}
export interface CleanupResult {
  readonly success: boolean;
  readonly summary?: string;
  readonly error?: string;
}
export type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;

// NEW body for createCleanupRunner() (S3 replaces S2's no-op):
//   - builds a runtime user prompt from ctx
//   - invokes createCleanupAgent() (lazy, inside the closure)
//   - maps r.status → CleanupResult
//   - returns { success:false, error } on unexpected throw (non-fatal)

// src/agents/prompts.ts — NEW constant:
//   export const CLEANUP_PROMPT = `# ... \n${PRD_PREMERGED_DECLARATION}\n...`;
//   // + add `CLEANUP: CLEANUP_PROMPT,` to the PROMPTS map.

// src/agents/agent-factory.ts — NEW union member + token key + factory:
//   export type AgentPersona = 'architect'|'researcher'|'coder'|'qa'|'cleanup';
//   const PERSONA_TOKEN_LIMITS = { architect:8192, researcher:4096, coder:4096,
//     qa:4096, cleanup:4096 } as const;
//   export function createCleanupAgent(): Agent { ... }  // mirrors createCoderAgent
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD CLEANUP_PROMPT to src/agents/prompts.ts
  - IMPLEMENT: `export const CLEANUP_PROMPT = \`...\`;` — a template literal:
    * H1: "# Cleanup Agent — Post-Validation Artifact Reorganization"
    * inject `${PRD_PREMERGED_DECLARATION}` immediately after the H1 (match the
      4 core-persona prompts).
    * ROLE/GOAL: "You are the cleanup agent. After a subtask passes validation
      and its substance is committed, you reorganize the working tree: remove
      temporary artifacts and move generated documentation into docs/. You are
      invoked ONCE per subtask, single-shot — you do not resume sessions."
    * JOB (PRD §4.2 step 4): explicit numbered instructions —
      1. Remove temporary artifacts: PRP scratch files, transient build/test
         outputs, anything that is clearly a scratch artifact (NOT source, NOT
         docs, NOT pipeline-state files).
      2. Move generated documentation into `docs/` (e.g. research notes, design
         docs produced during the subtask that belong in the permanent docs tree).
      3. Save `tasks.json` (the orchestrator flushes it; do not corrupt it).
    * FORBIDDEN ACTIONS (PRD §5.1 prompt layer) — make this a hard, explicit
      block, name every forbidden token:
      "You MUST NOT run `rm`, `git rm`, `git clean`, or `mv` (or any equivalent
      deletion/move) against ANY of:
        - `PRD.md` (the product requirements document)
        - any `PRP.md` (anywhere in the repo)
        - anything under `plan/` (the pipeline work directory — its substance is
          already committed by the survival commit; you must not touch it)
      You MUST NOT treat `PRD.md`, `PRP.md`, or `tasks.json` as 'temporary.'
      You MUST NOT run `git commit` or `git add` — the orchestrator commits your
      reorganization; committing yourself causes a double-commit race."
    * OPERATIONAL NOTES: "Operate at the repository root. You have bash,
      filesystem, and git (read-only) tools. Prefer `mv` over copy-then-delete
      for doc moves. If nothing needs cleanup, output 'no cleanup needed' — that
      is a success, not a failure. Output a one-line summary of what you did
      (or 'no cleanup needed')."
    * NO `as const` (match the 4 core persona prompts).
  - REGISTER: add `CLEANUP: CLEANUP_PROMPT,` to the `PROMPTS` map (~line 1042),
    AFTER `BUG_HUNT: BUG_HUNT_PROMPT`. This extends `PromptKey` automatically.
  - JSDOC: add a JSDoc block above the constant (match BUG_HUNT_PROMPT's JSDoc):
    describe it as the cleanup persona system prompt; cite PRD §4.2 step 4 +
    §5.1; note Source: "authored for P3.M1.T3.S3 (no PROMPTS.md source)."
  - PLACEMENT: logically right before BUG_HUNT_PROMPT (~line 910) or right after
    it — pick one and keep PROMPTS-map order consistent.
  - NAMING: CLEANUP_PROMPT (SCREAMING_SNAKE_CASE, matching siblings).
  - GOTCHA: do NOT embed the full PRD — the cleanup agent does not need it. The
    PRD_PREMERGED_DECLARATION line is convention; keep the prompt focused.

Task 2: EXTEND AgentPersona + PERSONA_TOKEN_LIMITS in src/agents/agent-factory.ts
  - MODIFY union (~line 98):
      export type AgentPersona = 'architect' | 'researcher' | 'coder' | 'qa' | 'cleanup';
  - MODIFY PERSONA_TOKEN_LIMITS (~line 173-178, `as const`): add `cleanup: 4096,`.
  - MODIFY the import from './prompts.js' (~line 56): add `CLEANUP_PROMPT` to the
    named-import list (keep alphabetical/order-matching the existing list).
  - DO NOT touch ROLE_CONFIG, ModelRole, ThinkingLevel, or createBaseConfig —
    they are generic and already handle the new persona via the union + token map.
  - VERIFY: `npx tsc --noEmit` passes (createBaseConfig('cleanup') now indexes a
    real token limit + the union accepts 'cleanup').

Task 3: ADD createCleanupAgent() factory in src/agents/agent-factory.ts
  - IMPLEMENT (place AFTER createQAAgent, ~line 410, BEFORE the re-exports):
      /**
       * Create a Cleanup agent for post-validation artifact reorganization.
       *
       * @remarks
       * Uses the **Implementation** model role (fast tier, normal budget per
       * PRD §9.2.3) — cleanup is a mechanical reorg, not a reasoning task.
       * Uses the CLEANUP_PROMPT system prompt (PRD §4.2 step 4 + §5.1 deletion
       * protection). Stateless single-shot: enableReflection:false +
       * enableCache:false (PRD §9.3.3). Carries MCP_TOOLS (bash+filesystem+git)
       * because cleanup mutates the filesystem (diverges from the tool-less
       * commit-message-agent). The agent MUST NOT git commit (the orchestrator
       * commits via stagecoach).
       * @returns Configured Groundswell Agent instance.
       */
      export function createCleanupAgent(): Agent {
        const baseConfig = createBaseConfig('cleanup', 'implementation');
        const config = {
          ...baseConfig,
          system: CLEANUP_PROMPT,
          mcps: MCP_TOOLS,
          enableReflection: false,
          enableCache: false,
        };
        logger().debug({ persona: 'cleanup', model: config.model }, 'Creating agent');
        return createAgent(config);
      }
  - FOLLOW pattern: createCoderAgent (lines ~360-380) — same spread + logger + return.
  - NAMING: createCleanupAgent (camelCase, matching createCoderAgent/createQAAgent).
  - GOTCHA: the spread `...baseConfig` sets enableReflection:true + enableCache:true;
    the explicit overrides AFTER the spread flip them to false. Order matters —
    overrides must come after the spread.
  - GOTCHA: name is NOT overridden — createBaseConfig('cleanup') already derives
    name 'CleanupAgent' (capitalized first letter + 'Agent'). Do not override name.

Task 4: REPLACE the no-op createCleanupRunner body in src/core/cleanup-runner.ts
  - READ the full file first (S2 created it). Note the FROZEN types
    (CleanupContext/CleanupResult/CleanupRunner) — do NOT touch them.
  - ADD imports at top:
      import { createAgent, type Agent } from 'groundswell';   // if not present
      import { createPrompt } from 'groundswell';
      import { z } from 'zod';
      import { createCleanupAgent } from '../agents/agent-factory.js';
      import { getLogger } from '../utils/logger.js';
    (Add a lazy logger accessor matching commit-message-agent.ts:
     `let _logger; const logger = () => (_logger ??= getLogger('CleanupRunner'));`)
  - REPLACE the createCleanupRunner() body (S2's no-op) with:
      export function createCleanupRunner(): CleanupRunner {
        return async (ctx: CleanupContext): Promise<CleanupResult> => {
          const agent = createCleanupAgent();   // lazy, per-call (single-shot)
          const userPrompt = buildCleanupUserPrompt(ctx);
          const prompt = createPrompt({ user: userPrompt, responseFormat: z.string() });
          try {
            const r = await agent.prompt(prompt);
            if (r.status === 'error') {
              const msg = r.error?.message ?? 'cleanup agent returned error status';
              logger().warn({ error: msg, subtaskId: ctx.subtask.id }, 'Cleanup agent failed');
              return { success: false, error: msg };
            }
            const summary = (typeof r.data === 'string' ? r.data : String(r.data ?? '')).trim()
              || 'cleanup complete';
            logger().info({ subtaskId: ctx.subtask.id, summary }, 'Cleanup agent succeeded');
            return { success: true, summary };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger().warn({ error: msg, subtaskId: ctx.subtask.id },
              'Cleanup agent threw — returning non-fatal failure (S2 swallows)');
            return { success: false, error: msg };
          }
        };
      }
  - ADD a private helper (NOT exported, or exported only for testing):
      function buildCleanupUserPrompt(ctx: CleanupContext): string {
        return [
          `Cleanup task for subtask ${ctx.subtask.id}: ${ctx.subtask.title}`,
          ``,
          `Repository root: ${ctx.repoRoot}`,
          `Subtask work directory (under plan/ — DO NOT TOUCH): ${ctx.sessionPath}`,
          ``,
          `Perform the cleanup job described in your system prompt:`,
          `1. Remove temporary artifacts (scratch files, transient build/test outputs).`,
          `2. Move generated documentation into docs/.`,
          `3. Leave tasks.json intact (the orchestrator saves it).`,
          ``,
          `FORBIDDEN (per PRD §5.1): do NOT rm/git rm/git clean/mv PRD.md, any`,
          `PRP.md, or anything under plan/. Do NOT git commit or git add (the`,
          `orchestrator commits). If nothing needs cleanup, output 'no cleanup needed'.`,
          ``,
          `Output a one-line summary of what you did.`,
        ].join('\n');
      }
  - PRESERVE: the type declarations (CleanupContext/Result/Runner) byte-identical.
  - PRESERVE: any S2 JSDoc on createCleanupRunner — UPDATE it to say "invokes
    the cleanup agent persona (P3.M1.T3.S3)" instead of "no-op placeholder."
  - GOTCHA: the agent is created INSIDE the closure (lazy, per-call) — do NOT
    hoist it to module scope (single-shot semantics + avoids boot-time failure).
  - GOTCHA: returning { success:false } on agent error is preferred over throwing
    (S2 handles both, but a clean return is less noisy). The catch returns
    { success:false } too — so the runner effectively never throws for agent
    failures; only a synchronous bug in buildCleanupUserPrompt would throw, and
    S2 catches that.

Task 5: CREATE tests/unit/agents/cleanup-agent.test.ts
  - MIRROR tests/unit/agents/commit-message-agent.test.ts structure exactly:
    * vi.mock('../../../src/agents/agent-factory.js', () => ({
        createBaseConfig: vi.fn(() => ({ name:'CleanupAgent', model:'zai/glm-5-turbo',
          harness:'pi', enableCache:true, enableReflection:true, maxTokens:4096,
          system:'placeholder', env:{ANTHROPIC_API_KEY:'',ANTHROPIC_BASE_URL:''} })),
      }));
    * vi.mock('groundswell', () => ({ createAgent: vi.fn((cfg) => ({ __cfg: cfg })) }));
    * import { createAgent } from 'groundswell';
    * import { createBaseConfig } from '../../../src/agents/agent-factory.js';
    * import { createCleanupAgent } from '../../../src/agents/agent-factory.js';
    * import { CLEANUP_PROMPT } from '../../../src/agents/prompts.js';   // REAL prompt
  - TESTS (describe('agents/cleanup-agent') > describe('createCleanupAgent')):
    1. should call createBaseConfig with ('cleanup', 'implementation')
       → expect(mockCreateBaseConfig).toHaveBeenCalledWith('cleanup','implementation').
    2. should return an Agent from createAgent
       → mockCreateAgent called once; result defined.
    3. should set name to 'CleanupAgent' (derived by createBaseConfig)
       → cfg.name === 'CleanupAgent'.
    4. should set system to CLEANUP_PROMPT
       → cfg.system === CLEANUP_PROMPT (the REAL imported constant).
    5. should carry MCP_TOOLS (cleanup mutates the filesystem)
       → cfg.mcps IS defined (expect(cfg.mcps).toBeDefined()).
       → contrast: this is the KEY difference from commit-message-agent (no tools).
    6. should disable reflection (single-shot)
       → cfg.enableReflection === false.
    7. should disable cache (single-shot)
       → cfg.enableCache === false.
    8. should preserve the fast-tier model from createBaseConfig
       → cfg.model === 'zai/glm-5-turbo' (the mocked fixture value).
  - SEPARATE test (no mock of prompts.ts): assert CLEANUP_PROMPT content:
    * in a describe('CLEANUP_PROMPT content') block (can be in the same file or a
      prompts.test.ts if one exists — check first; if not, keep it here):
      - expect(CLEANUP_PROMPT).toContain('docs/');
      - expect(CLEANUP_PROMPT).toContain('tasks.json');
      - expect(CLEANUP_PROMPT).toContain('plan/');
      - expect(CLEANUP_PROMPT).toMatch(/rm|git rm|git clean|mv/);  // forbids these
      - expect(CLEANUP_PROMPT).toContain('PRD.md');
      - expect(CLEANUP_PROMPT).toContain('PRP.md');
      - expect(CLEANUP_PROMPT).toContain('git commit');  // forbids self-commit
  - PLACEMENT: tests/unit/agents/.

Task 6: MODIFY tests/unit/core/cleanup-runner.test.ts (S2 created it)
  - READ the existing S2 tests. The no-op assertion
    (`expect(result.summary).toBe('cleanup disabled (no persona wired yet)')`)
    NOW FAILS — REMOVE/REPLACE it.
  - ADD vi.mock for the cleanup agent so no real LLM fires:
      vi.mock('../../../src/agents/agent-factory.js', () => ({
        createCleanupAgent: vi.fn(() => ({
          prompt: vi.fn(() => Promise.resolve({ status:'success', data:'moved 2 docs to docs/' })),
        })),
      }));
    (Also mock 'groundswell' createPrompt as a passthrough if needed — or let the
    real createPrompt run since it is a pure builder.)
  - ADD describe('createCleanupRunner — persona invocation') with tests:
    1. should invoke createCleanupAgent().prompt exactly once
       → const runner = createCleanupRunner();
         await runner({ sessionPath:'/x/plan/008_..', subtask: {id:'P3.M1.T3.S3',
           title:'t', type:'Subtask', status:'Complete', story_points:2,
           dependencies:[]}, repoRoot:'/x' });
         expect(mockCreateCleanupAgent).toHaveBeenCalledTimes(1);
         expect(mockPrompt).toHaveBeenCalledTimes(1);
    2. should build a user prompt containing sessionPath + subtask.id + subtask.title
       → capture the createPrompt user arg (mock createPrompt OR read it via the
         agent.prompt mock's call arg if createPrompt is passthrough). Assert the
         user string contains the sessionPath, 'P3.M1.T3.S3', and the title.
    3. should map r.status==='success' → { success:true, summary }
       → result.success === true; result.summary === 'moved 2 docs to docs/'.
    4. should map r.status==='error' → { success:false, error }
       → override the mock to return { status:'error', error:{message:'boom'} };
         result.success === false; result.error === 'boom'.
    5. should map r.status==='partial' → { success:true, summary } (partial still
       has data) OR { success:false } — PICK ONE and document it. Recommended:
       treat 'partial' as success (data is present) per groundswell semantics.
       → override mock to return { status:'partial', data:'partial cleanup' };
         result.success === true.
    6. should return { success:false, error } when agent.prompt rejects
       → override mock prompt to throw new Error('network'); result.success ===
         false; result.error contains 'network'. (Confirms non-fatal + S2's catch
         is belt-and-suspenders.)
  - PRESERVE any S2 tests that do NOT depend on the no-op summary (e.g. type-
    shape tests for CleanupContext). Only the no-op-summary assertion is stale.
  - GOTCHA: the Subtask fixture must satisfy the Subtask interface — include all
    REQUIRED fields (id, type:'Subtask', title, status, story_points, dependencies).
    Check src/core/models.ts Subtask interface for the full required set; cast with
    `as Subtask` if needed to avoid enumerating every optional field.

Task 7: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json   # union + token-map + import typecheck
  - RUN: npx eslint src/agents/prompts.ts src/agents/agent-factory.ts src/core/cleanup-runner.ts
  - RUN: npx vitest run tests/unit/agents/cleanup-agent.test.ts
         tests/unit/core/cleanup-runner.test.ts
  - RUN: npm run validate   # the canonical gate (lint + typecheck + full unit suite)
  - EXPECT: GREEN. If red:
    * a missed required Subtask field in the test fixture → check models.ts.
    * stale S2 no-op assertion still present → remove it (Task 6).
    * createBaseConfig('cleanup') type error → you forgot PERSONA_TOKEN_LIMITS.cleanup.
    * cfg.system !== CLEANUP_PROMPT → you mocked prompts.ts by accident; don't.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the cleanup factory (Task 3) — mirrors createCoderAgent, diverges
// from commit-message-agent by CARRYING mcps (cleanup mutates the filesystem).
export function createCleanupAgent(): Agent {
  const baseConfig = createBaseConfig('cleanup', 'implementation');
  const config = {
    ...baseConfig,
    system: CLEANUP_PROMPT,
    mcps: MCP_TOOLS,            // <-- cleanup needs file/bash/git tools
    enableReflection: false,    // <-- overrides baseConfig's true (single-shot)
    enableCache: false,         // <-- overrides baseConfig's true (single-shot)
  };
  logger().debug({ persona: 'cleanup', model: config.model }, 'Creating agent');
  return createAgent(config);
}

// PATTERN: the runner fills the S2 seam (Task 4) — agent.prompt invocation
// shape copied from src/utils/git-commit.ts:168-189, adapted to return
// CleanupResult (non-fatal) instead of throwing AgentError.
export function createCleanupRunner(): CleanupRunner {
  return async (ctx) => {
    const agent = createCleanupAgent();                 // lazy, per-call
    const prompt = createPrompt({
      user: buildCleanupUserPrompt(ctx),
      responseFormat: z.string(),
    });
    try {
      const r = await agent.prompt(prompt);             // never throws on LLM fail
      if (r.status === 'error') {
        return { success: false, error: r.error?.message ?? 'cleanup agent error' };
      }
      const summary = (typeof r.data === 'string' ? r.data : String(r.data ?? '')).trim()
        || 'cleanup complete';
      return { success: true, summary };
    } catch (err) {   // unexpected (agent construction, prompt build) — non-fatal
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  };
}

// CRITICAL INVARIANTS:
// 1. The cleanup agent MUST NOT git commit/add (CLEANUP_PROMPT forbids it; S2's
//    stagecoach does the post-cleanup commit). A self-committing agent races
//    with smartCommit → double-commit or empty-commit.
// 2. The cleanup agent MUST NOT touch plan/, PRD.md, PRP.md (PRD §5.1 prompt
//    layer). The survival commit already persisted plan/; deleting it would
//    un-do the survival guarantee.
// 3. The runner is NON-FATAL — it returns {success:false} on agent failure
//    rather than throwing. S2's nested try/catch is the outer guard; this
//    runner's own catch makes cleanup robust even if S2's guard changes.
// 4. "Stateless" = single-shot invocation + enableReflection:false +
//    enableCache:false. There is no AgentConfig.session field yet (P3.M2.T3.S1
//    handles mechanical session disabling later). Do NOT invent one.
```

### Integration Points

```yaml
PERSONA UNION (src/agents/agent-factory.ts):
  - add: `'cleanup'` to the AgentPersona union
  - add: `cleanup: 4096` to PERSONA_TOKEN_LIMITS
  - effect: createBaseConfig('cleanup', role) now type-checks + resolves a token limit
            + derives name 'CleanupAgent'

PROMPT REGISTRY (src/agents/prompts.ts):
  - add: `export const CLEANUP_PROMPT`
  - add: `CLEANUP: CLEANUP_PROMPT` to the PROMPTS map
  - effect: PromptKey now includes 'CLEANUP'; the prompt is importable for the
            factory + testable for content

FACTORY (src/agents/agent-factory.ts):
  - add: `createCleanupAgent()` (mirrors createCoderAgent; cleanup persona,
          implementation role → fast tier, mcps: MCP_TOOLS, reflection/cache off)
  - import: add CLEANUP_PROMPT to the ./prompts.js import

SEAM (src/core/cleanup-runner.ts):
  - replace: the no-op createCleanupRunner body with the persona-invoking runner
  - PRESERVE: CleanupContext / CleanupResult / CleanupRunner types (FROZEN)
  - effect: new TaskOrchestrator(manager) now runs REAL cleanup (no options needed)

EXECUTION LOOP (src/core/task-orchestrator.ts):
  - NO EDIT (S2 already wires #cleanupRunner between the two commits)
  - the default runner (this task) is picked up automatically via
    `options?.cleanupRunner ?? createCleanupRunner()`

DOWNSTREAM CONSUMERS / NON-GOALS:
  - P3.M2.T3.S1: mechanical session-persistence disabling (AgentConfig has no
    session field yet — leave that to S1 of T3)
  - P3.M2.T4.S1: prompt-layer deletion protection for OTHER deletion-capable
    agents (bug hunter, bug-fix breakdown, post-validation fix) — this task only
    does cleanup's prompt layer
  - P3.M2.T4.S2: mechanical restore_critical_files in smartCommit (the
    belt-and-suspenders to this task's prompt layer)
  - P3.M1.T4.S1/S2: stagecoach retry/fallback — NOT around the cleanup call
    (cleanup is non-fatal; no retry needed)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing prompts.ts + agent-factory.ts + cleanup-runner.ts
npx eslint src/agents/prompts.ts src/agents/agent-factory.ts src/core/cleanup-runner.ts
npx tsc --noEmit -p tsconfig.json
# Expected: zero errors. Common fixes:
#  - PERSONA_TOKEN_LIMITS missing `cleanup` key → createBaseConfig('cleanup')
#    indexes undefined → TS error. Add the key.
#  - CLEANUP_PROMPT not imported in agent-factory.ts → add to the ./prompts.js import.
#  - zod not imported in cleanup-runner.ts → `import { z } from 'zod'`.

# Project-wide
npm run lint
npx tsc --noEmit
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Persona factory
npx vitest run tests/unit/agents/cleanup-agent.test.ts

# Runner (persona invocation)
npx vitest run tests/unit/core/cleanup-runner.test.ts

# Regression: ensure the S2 two-phase commit tests still pass (the seam contract
# is unchanged; only the default runner's behavior changed)
npx vitest run tests/unit/core/task-orchestrator.test.ts

# Full agents + core suites
npx vitest run tests/unit/agents/ tests/unit/core/

# Expected: all GREEN. If task-orchestrator.test.ts red, S2's two-phase test
# injected a custom cleanupRunner spy — that STILL works (the default runner is
# only used when no spy is injected). If cleanup-runner.test.ts red on a no-op
# summary assertion, you missed removing the stale S2 assertion (Task 6).
```

### Level 3: Integration Testing (System Validation)

```bash
# Project-wide gate
npm run validate
# Expected: GREEN. Runs lint + typecheck + the full unit suite.

# Confirm no orchestrator edit (S2 owns that file)
git diff --stat src/core/task-orchestrator.ts
# Expected: NO output (unchanged).

# Confirm the seam types are byte-identical (only the runner body changed)
git diff src/core/cleanup-runner.ts
# Expected: the CleanupContext/CleanupResult/CleanupRunner declarations are
# UNCHANGED; only createCleanupRunner's body + new imports differ.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Prompt-content behavioral verification (codified as tests in Task 5):
# 1. DELETION PROTECTION: CLEANUP_PROMPT forbids rm/git rm/git clean/mv against
#    PRD.md, PRP.md, plan/. (Covered by the CLEANUP_PROMPT content assertions.)
# 2. NO SELF-COMMIT: CLEANUP_PROMPT forbids git commit/git add. (Covered.)
# 3. JOB COVERAGE: CLEANUP_PROMPT instructs remove-temp + move-to-docs/ + save-
#    tasks.json. (Covered by toContain('docs/'), toContain('tasks.json').)
# 4. NON-FATAL: runner returns {success:false} on agent error/throw; never
#    rethrows as a different type. (Covered by Task 6 tests 4 + 6.)

# No network / no real LLM / no real git in unit tests — createCleanupAgent is
# mocked in cleanup-runner.test.ts; createBaseConfig + createAgent are mocked in
# cleanup-agent.test.ts. The cleanup agent is NEVER actually prompted in tests.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 GREEN: `npx eslint src/agents/prompts.ts src/agents/agent-factory.ts src/core/cleanup-runner.ts` + `tsc --noEmit`
- [ ] Level 2 GREEN: `npx vitest run tests/unit/agents/cleanup-agent.test.ts tests/unit/core/cleanup-runner.test.ts tests/unit/core/task-orchestrator.test.ts`
- [ ] Level 3 GREEN: `npm run validate`
- [ ] `git diff --stat src/core/task-orchestrator.ts` shows NO changes (S2 owns it)

### Feature Validation

- [ ] `AgentPersona` union includes `'cleanup'`; `PERSONA_TOKEN_LIMITS.cleanup === 4096`
- [ ] `createCleanupAgent()` calls `createBaseConfig('cleanup', 'implementation')` and returns an Agent with `system === CLEANUP_PROMPT`, `mcps` defined, `enableReflection === false`, `enableCache === false`
- [ ] `CLEANUP_PROMPT` is exported from prompts.ts and registered as `PROMPTS.CLEANUP`
- [ ] `CLEANUP_PROMPT` encodes the §4.2 job (remove temp, move docs to docs/, save tasks.json) AND the §5.1 forbidden-paths rules (no rm/git rm/git clean/mv on PRD.md/PRP.md/plan/) AND forbids git commit/add
- [ ] Default `createCleanupRunner()` invokes the cleanup persona (the `'cleanup disabled'` no-op summary is GONE)
- [ ] Runner builds user prompt from `CleanupContext` (sessionPath + subtask.id + subtask.title)
- [ ] Runner maps `r.status` → `CleanupResult` (success→{success:true,summary}; error→{success:false,error})
- [ ] Runner is non-fatal: returns `{success:false}` on agent throw/error (does not rethrow as a different type)
- [ ] S2's two-phase commit tests still pass (the seam contract is unchanged)

### Code Quality Validation

- [ ] Factory mirrors `createCoderAgent` shape (spread + logger + return createAgent)
- [ ] `mcps: MCP_TOOLS` is set (cleanup mutates the filesystem — diverges from commit-message-agent)
- [ ] Overrides (`enableReflection:false`, `enableCache:false`) come AFTER the `...baseConfig` spread
- [ ] Runner creates the agent INSIDE the closure (lazy, per-call — single-shot semantics)
- [ ] Seam types (`CleanupContext`/`CleanupResult`/`CleanupRunner`) are byte-identical to S2
- [ ] No import cycle (core/cleanup-runner → agents/agent-factory → config/utils/tools; agents/ never imports core/)
- [ ] Stale S2 no-op assertion removed from cleanup-runner.test.ts

### Documentation & Deployment

- [ ] JSDoc on `createCleanupAgent` cites PRD §4.2 + §9.2.3 + §9.3.3 + the stateless-single-shot rationale
- [ ] JSDoc on `CLEANUP_PROMPT` cites PRD §4.2 step 4 + §5.1
- [ ] JSDoc on `createCleanupRunner` updated from "no-op placeholder" to "invokes the cleanup persona (P3.M1.T3.S3)"
- [ ] No new env vars / config (this task adds none)

---

## Anti-Patterns to Avoid

- ❌ Don't follow commit-message-agent's "reuse researcher persona, skip union expansion" trick — the contract item 3(a) MANDATES adding `'cleanup'` to `AgentPersona`.
- ❌ Don't omit `mcps: MCP_TOOLS` — cleanup mutates the filesystem (move docs, remove temp); without tools the agent can do nothing. commit-message-agent omits mcps only because it reads a diff from the prompt.
- ❌ Don't let the cleanup agent run `git commit`/`git add` — it races with S2's stagecoach post-cleanup smartCommit. Forbid it in CLEANUP_PROMPT.
- ❌ Don't let the cleanup agent touch `plan/`, `PRD.md`, or `PRP.md` — PRD §5.1 prompt layer; the survival commit already persisted plan/.
- ❌ Don't add a fictional `AgentConfig.session` field for "stateless" — it doesn't exist yet (P3.M2.T3.S1). Stateless = single-shot + enableReflection:false + enableCache:false.
- ❌ Don't add retry/backoff around the cleanup call — cleanup is non-fatal (S2 swallows); retry is unnecessary and is NOT this task's scope.
- ❌ Don't throw `AgentError` from the runner on agent failure — return `{success:false, error}` (S2's non-fatal contract). AgentError is for retryable boundaries (git-commit.ts), not non-fatal cleanup.
- ❌ Don't edit `task-orchestrator.ts` — S2 already wired the seam; this task only fills the default runner.
- ❌ Don't change the `CleanupContext`/`CleanupResult`/`CleanupRunner` types — they are S2's frozen contract.
- ❌ Don't create the agent at module scope — create it INSIDE the returned closure (lazy, per-call, single-shot).
- ❌ Don't leave the stale S2 no-op-summary assertion in cleanup-runner.test.ts — it will fail.