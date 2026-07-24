# PRP — P4.M1.T1.S1: COSMETIC/SUBSTANTIVE and CLEAN/DIRTY LLM Classifiers

---

## Goal

**Feature Goal**: Implement the **LLM-driven binary change/artifact classifiers** mandated by
PRD §4.3 ("The Delta Workflow", h3.5, step 1 "Change Classification"). The pipeline must
classify a detected PRD change as **COSMETIC** (trivial: whitespace/formatting) or
**SUBSTANTIVE** (semantically significant), and independently classify a generated artifact
(e.g. the delta PRD) as **CLEAN** or **DIRTY**, using an LLM call that takes the structural
`DiffSummary` (from `diffPRDs()` in `src/core/prd-differ.ts`) as its input. This is the first
half of work item **P4.M1.T1** — subtask **S1** owns the two classifier functions + their
classification prompt templates + Mode-A JSDoc; the parallel subtask **S2**
("Transient-API retry and protective default on exhaustion") owns the bounded retry loop (default
4 attempts) and the fail-to-protective-default (SUBSTANTIVE / DIRTY) on exhaustion. **S1 does NOT
implement retry or the protective default** — it implements the inner LLM call and exposes a
clean throwing boundary that S2 will wrap.

**Deliverable** (1 new production module + 1 new prompt-generator file + 1 new test file + 2
minimal edits to existing prompt-registry files; **no** agent-factory edit, **no** models.ts
edit, **no** workflow/CLI/retry changes, **no** new dependencies):

1. **`src/core/change-classifier.ts`** (NEW) — the change/artifact classifier module exporting:
   - `type ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE'` + `ChangeClassificationSchema`
     (Zod enum), `type ArtifactClassification = 'CLEAN' | 'DIRTY'` +
     `ArtifactClassificationSchema` (co-located with the functions that produce them, per the
     models.ts dual-declaration convention — `Status`/`StatusEnum` at `models.ts:200`).
   - `classifyChange(diffSummary: DiffSummary): Promise<ChangeClassification>` — builds a
     `Prompt<ChangeClassification>` from the structural diff summary, invokes the QA agent
     (`createQAAgent()`), discriminates on `AgentResponse.status`, returns the validated
     classification. On `status !== 'success'`, empty `data`, or a value outside the enum, throws
     a typed `AgentError` (its `code` is HARDCODED to `ErrorCodes.PIPELINE_AGENT_LLM_FAILED` — see
     `src/utils/errors.ts:422-428`; the constructor is `new AgentError(message, context?, cause?)`,
     NOT `(message, { code })`). That code is transient by default in `isTransientError` — S2 retries it.
   - `classifyArtifact(content: string): Promise<ArtifactClassification>` — same shape, takes
     the artifact text (e.g. `delta_prd.md` content), returns `CLEAN`/`DIRTY`, throws the same
     transient `AgentError` on failure.
   - Mode-A JSDoc on both functions citing PRD §4.3.
2. **`src/agents/prompts/change-classifier-prompt.ts`** (NEW) — the typed `Prompt<T>` generator
   module exporting `createChangeClassificationPrompt(diffSummary: DiffSummary):
   Prompt<ChangeClassification>` and `createArtifactClassificationPrompt(content: string):
   Prompt<ArtifactClassification>`, mirroring `src/agents/prompts/delta-analysis-prompt.ts`
   structure (private `constructUserPrompt()` helper + exported `createXxxPrompt()` using
   `createPrompt({ user, system, responseFormat, enableReflection })`).
3. **`src/agents/prompts.ts`** (MODIFY) — add the `CHANGE_CLASSIFIER_PROMPT` string constant
   (prepended with `PRD_PREMERGED_DECLARATION`, matching `DELTA_ANALYSIS_PROMPT` at line 821 and
   `CLEANUP_PROMPT` at line 1094) and register it in the `PROMPTS` lookup object + `PromptKey`
   type (lines ~1159-1162).
4. **`src/agents/prompts/index.ts`** (MODIFY) — add the two re-export lines for the new
   generators (mirroring the existing four at lines 16-19).
5. **`tests/unit/core/change-classifier.test.ts`** (NEW) — the unit suite (vitest, Strategy-A
   mocking per `tests/unit/workflows/delta-analysis-workflow.test.ts:24-31`): mock
   `agent-factory.js` (`createQAAgent`) + `prompts/change-classifier-prompt.js`; inject a
   `prompt: vi.fn().mockResolvedValue(AgentResponse)`; assert (a) happy-path COSMETIC /
   SUBSTANTIVE / CLEAN / DIRTY returns; (b) `status:'error'` → throws; (c) `status:'success'`
   with empty/invalid `data` → throws; (d) the prompt generators receive the `DiffSummary` /
   content verbatim (the prompt is built from the diff, per PRD §4.3 + item contract LOGIC (c));
   (e) the prompt constant + generators are registered (compile-time + a registration test).

**Success Definition**:
- `classifyChange(diffSummary)` returns `'COSMETIC'` or `'SUBSTANTIVE'` on a successful agent
  response, and throws a typed transient `AgentError` (`PIPELINE_AGENT_LLM_FAILED`) on any
  non-success / empty / out-of-enum model output — establishing the throwing boundary S2 wraps.
- `classifyArtifact(content)` returns `'CLEAN'` or `'DIRTY'` with the same contract.
- Both consume the structured `DiffSummary` from `src/core/prd-differ.ts` (the LLM layer the
  PRD §4.3 mandates *on top of* `diffPRDs()`'s structural diff).
- The classification prompt templates live in the prompts layer (constant in `prompts.ts`,
  generator in `prompts/change-classifier-prompt.ts`, re-exported from `prompts/index.ts`),
  matching the two-layer prompt convention.
- `npm run validate` GREEN; `git diff --name-only` shows EXACTLY
  `src/core/change-classifier.ts`, `src/agents/prompts/change-classifier-prompt.ts`,
  `src/agents/prompts.ts`, `src/agents/prompts/index.ts`, and
  `tests/unit/core/change-classifier.test.ts` (zero overlap with S2's retry/protective-default
  work or with the parallel P3.M2.T6.S2 temp-cleanup PRP).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop during the delta workflow),
transitively future maintainers. When a user edits `PRD.md` mid-project, the pipeline detects a
hash mismatch (PRD §4.3 step 1, "Detection") and must decide whether the edit is worth spawning a
delta session over (SUBSTANTIVE) or is ignorable noise (COSMETIC — whitespace/formatting). The
`hasSignificantChanges()` heuristic in `prd-differ.ts:564` is a pure word-count heuristic that
the phase findings flag as **dead code (never called)**; PRD §4.3 replaces that heuristic with an
**LLM-driven** classifier that understands semantic significance. This subtask is that classifier.

**Use Case**: `handleDelta()` in `prp-pipeline.ts` computes `diffPRDs(oldPRD, newPRD)` →
`DiffSummary`; S1's `classifyChange(diffSummary)` turns that structural summary into a
COSMETIC/SUBSTANTIVE verdict (via an LLM); if SUBSTANTIVE, the delta workflow proceeds (steps
2–7). The CLEAN/DIRTY classifier (`classifyArtifact`) later guards the generated `delta_prd.md`
before it is consumed by the breakdown.

**User Journey**: PRD edited → hash mismatch detected → `diffPRDs()` produces `DiffSummary` →
`classifyChange(diffSummary)` (S1) → [S2 wraps this in bounded retry + protective default] →
COSMETIC (skip delta) or SUBSTANTIVE (spawn delta session) → delta PRD generated →
`classifyArtifact(deltaPrdContent)` (S1) → [S2 wraps] → CLEAN (use it) or DIRTY (reject /
regenerate). This PRP delivers the classification step; S2 delivers the resilience around it.

**Pain Points Addressed**: PRD §4.3 — without an LLM classifier, the pipeline either (a) spawns a
delta session for every trivial whitespace edit (wasteful) or (b) silently swallows a
semantically significant edit (dangerous). The LLM classifier distinguishes the two. (The retry
+ protective-default that make it *safe* are S2.)

---

## Why

- **PRD compliance**: PRD §4.3 (h3.5) step 1, "Change Classification", states verbatim:
  > "Detected changes are classified by an LLM-driven binary classifier as **COSMETIC** (trivial:
  > whitespace/formatting) or **SUBSTANTIVE** (semantically significant). A parallel **CLEAN/DIRTY**
  > classifier guards generated artifacts (e.g., the delta PRD)."
  This PRP implements the **classifier functions + prompt templates** (the "LLM-driven binary
  classifier" + the "parallel CLEAN/DIRTY classifier"). The retry/protective-default clauses in
  the same paragraph ("These classifiers MUST distinguish transient API failures… retrying up to
  a bounded count (default 4) before giving up. On exhaustion they MUST fail to the
  protective/conservative default…") are **explicitly S2** (next subtask).
- **Work-item contract mapping**:
  - **CONTRACT (1) RESEARCH NOTE** — *"prd-differ.ts does structural diffing (diffPRDs,
    hasSignificantChanges — the latter is DEAD CODE, never called). The PRD §4.3 specifies an
    LLM-driven binary classifier on top of the structural diff."* → This PRP builds the
    LLM-driven classifier that consumes `diffPRDs()`'s `DiffSummary`. It does NOT touch the dead
    `hasSignificantChanges()` (out of scope; it is a pure heuristic, not the LLM layer).
  - **CONTRACT (3) LOGIC** — *"(a) Create a new module `src/core/change-classifier.ts` with two
    classifier functions: `classifyChange(diffSummary: DiffSummary): Promise<'COSMETIC'|
    'SUBSTANTIVE'>` and `classifyArtifact(content: string): Promise<'CLEAN'|'DIRTY'>`."* →
    `classifyChange` + `classifyArtifact` in `src/core/change-classifier.ts` (Task 1). The
    signatures match exactly (`DiffSummary` imported from `../core/prd-differ.js`; the return
    types are the new co-located unions).
  - *"(b) Both use an LLM call (via `createQAAgent` or a dedicated lightweight agent) with a
    classification prompt."* → Both invoke `createQAAgent()` (reused — the item explicitly
    permits it; see Decision in All Needed Context) and pass the classification `Prompt<T>`.
  - *"(c) The classifier receives the structural diff summary from `diffPRDs()` (prd-differ.ts)
    as input."* → `classifyChange(diffSummary: DiffSummary)` — the `DiffSummary` IS the
    structural diff summary; the prompt generator renders it into the user turn (Task 2). The
    test asserts the `DiffSummary` is threaded verbatim into the prompt (Task 3).
  - *"(d) Add classification prompt templates to `src/agents/prompts/` or
    `src/agents/prompts.ts`."* → BOTH layers: `CHANGE_CLASSIFIER_PROMPT` constant in
    `prompts.ts` + `createChangeClassificationPrompt` / `createArtifactClassificationPrompt` in
    `prompts/change-classifier-prompt.ts` + re-export in `prompts/index.ts` (Task 2 + Task 4 +
    Task 5). This matches the two-layer convention (`DELTA_ANALYSIS_PROMPT` const + the
    `delta-analysis-prompt.ts` generator).
  - **CONTRACT (4) OUTPUT** — *"Change classifier module with COSMETIC/SUBSTANTIVE and
    CLEAN/DIRTY functions. Consumed by P4.M1.T1.S2."* → The module is the inner call; S2
    consumes it (wraps it in retry + protective default). The throwing boundary S1 establishes
    (transient `AgentError` on failure) is exactly what S2 needs to classify failures as
    transient and retry them.
  - **CONTRACT (5) DOCS** — *"[Mode A] JSDoc on `classifyChange` and `classifyArtifact`. This
    rides WITH the work."* → Mode-A JSDoc on both functions (Task 1) + the module header, citing
    PRD §4.3. No `.env.example`, no `docs/`, no README (per-file docs ride with the work).
  - **CONTRACT (2) INPUT** — *"No prior subtask output consumed."* → S1 consumes only the
    existing `DiffSummary` type from `prd-differ.ts` (a stable, shipped interface). It does NOT
    depend on S2 (S2 depends on S1).
- **No overlap with sibling PRPs**: S2 owns the retry/protective-default layer (it will wrap
  S1's functions — S1 must NOT implement retry, only the throwing boundary). The parallel
  **P3.M2.T6.S2** (temp-prompt-cleanup) owns `src/core/temp-prompt-cleanup.ts` — this PRP does
  NOT touch it. P3.M2.T6.S1 owns `src/agents/prompt-delivery.ts` — not touched. This PRP's diff
  is exactly the five files listed under Deliverable.

---

## What

One new production module (`src/core/change-classifier.ts`), one new prompt-generator file
(`src/agents/prompts/change-classifier-prompt.ts`), one new test file
(`tests/unit/core/change-classifier.test.ts`), and two minimal edits to existing prompt-registry
files (`src/agents/prompts.ts` add a constant, `src/agents/prompts/index.ts` add two re-exports).
**No** agent-factory edit (reuse `createQAAgent`), **no** models.ts edit (types co-located in the
new module), **no** workflow/CLI/retry changes, **no** new dependencies.

### Success Criteria

- [ ] **`src/core/change-classifier.ts`** (NEW) exports:
      - `export type ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE';`
      - `export const ChangeClassificationSchema = z.enum(['COSMETIC', 'SUBSTANTIVE']);`
      - `export type ArtifactClassification = 'CLEAN' | 'DIRTY';`
      - `export const ArtifactClassificationSchema = z.enum(['CLEAN', 'DIRTY']);`
      - `export async function classifyChange(diffSummary: DiffSummary):
        Promise<ChangeClassification>` — creates the agent (`createQAAgent()`), builds the prompt
        (`createChangeClassificationPrompt(diffSummary)`), calls `agent.prompt(prompt)` directly
        (NO `retryAgentPrompt` — that is S2), discriminates on `response.status`, returns
        `response.data` on success; throws `AgentError({ code: PIPELINE_AGENT_LLM_FAILED,
        message })` on `status !== 'success'`, `data === null`, or any enum-invalid value.
      - `export async function classifyArtifact(content: string):
        Promise<ArtifactClassification>` — same shape, builds
        `createArtifactClassificationPrompt(content)`, same throwing contract. Throws on empty
        `content` input (guard) before calling the agent.
      - Mode-A JSDoc on both functions + module header citing PRD §4.3 (h3.5 step 1).
      - A module-level lazy logger accessor (`let _logger; const logger = () => (_logger ??=
        getLogger('ChangeClassifier'))`) — debug-log the classification result + warn-log throws.
- [ ] **`src/agents/prompts/change-classifier-prompt.ts`** (NEW):
      - `export function createChangeClassificationPrompt(diffSummary: DiffSummary):
        Prompt<ChangeClassification>` — `createPrompt({ user: constructUserPrompt(diffSummary),
        system: CHANGE_CLASSIFIER_PROMPT, responseFormat: ChangeClassificationSchema,
        enableReflection: true })`.
      - `export function createArtifactClassificationPrompt(content: string):
        Prompt<ArtifactClassification>` — same shape with `ArtifactClassificationSchema`.
      - Private `constructChangeUserPrompt(diffSummary)` and `constructArtifactUserPrompt(content)`
        helpers that render the `DiffSummary` (summaryText + changes) / artifact content into the
        user turn, prepended with `PRD_PREMERGED_DECLARATION` (matching
        `delta-analysis-prompt.ts`).
- [ ] **`src/agents/prompts.ts`** (MODIFY): add `export const CHANGE_CLASSIFIER_PROMPT = \`...\``
        (prepended with `PRD_PREMERGED_DECLARATION`); add `CHANGE_CLASSIFIER: CHANGE_CLASSIFIER_PROMPT`
        to the `PROMPTS` lookup; add `CHANGE_CLASSIFIER` to the `PromptKey` type.
- [ ] **`src/agents/prompts/index.ts`** (MODIFY): add
        `export { createChangeClassificationPrompt, createArtifactClassificationPrompt } from
        './change-classifier-prompt.js';`.
- [ ] **`tests/unit/core/change-classifier.test.ts`** (NEW): Strategy-A mocks (agent-factory +
        prompt-generator) + `AgentResponse` injection; covers happy-path (4 returns), error-status
        throw, empty-data throw, enum-invalid-data throw, empty-content guard, prompt-threading
        assertions, and prompt-constant registration. 100% branch coverage of the new module.
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY the five files listed under Deliverable.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?" — YES. This PRP names: the exact 5-step LLM-call recipe (create agent → build
`Prompt<T>` → `agent.prompt(prompt)` → discriminate `.status` → use `.data`); the exact
`AgentResponse<T>` shape (`{status, data, error, metadata}` — no `.content`); the exact prompt
two-layer convention (`DELTA_ANALYSIS_PROMPT` const in prompts.ts:821 + the
`delta-analysis-prompt.ts` generator + index.ts re-export); the exact test mocking boilerplate
(`vi.mock('../../../src/agents/agent-factory.js', () => ({ createQAAgent: vi.fn() }))` + inject
`{ prompt: vi.fn().mockResolvedValue({ status:'success', data:'SUBSTANTIVE', error:null,
metadata:{} }) }`); the exact `DiffSummary` shape consumed (prd-differ.ts:111-164); the exact
throwing contract for the S2 boundary (`AgentError({ code: PIPELINE_AGENT_LLM_FAILED })` —
transient); and the exact scope boundary against S2 (no retry, no protective default).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://zod.dev/api?id=enums
  why: z.enum() for the responseFormat classification schema. Groundswell validates the LLM output
        against this; an out-of-enum value surfaces as status:'error' (or data:null) which S1 throws on.
  critical: the enum literals MUST be uppercase 'COSMETIC'|'SUBSTANTIVE' and 'CLEAN'|'DIRTY' (PRD §4.3
        verbatim — the prompt instructs the model to emit exactly these tokens).

- file: src/core/prd-differ.ts
  section: lines 111-164 (DiffSummary + SectionChange interfaces), line 564 (hasSignificantChanges — DEAD)
  why: THE INPUT TYPE. classifyChange(diffSummary: DiffSummary) consumes exactly this shape. All fields are
        readonly. hasSignificantChanges is the pure-heuristic predecessor the PRD §4.3 LLM classifier
        supersedes — DO NOT modify it (out of scope; it is dead code but its removal is a separate concern).
  pattern: DiffSummary = { changes: SectionChange[]; summaryText: string; stats: { totalAdded,
        totalModified, totalRemoved, sectionsAffected } }. SectionChange = { type:'added'|'modified'|
        'removed'; sectionTitle; lineNumber; oldContent?; newContent?; impact:'low'|'medium'|'high' }.
  gotcha: import DiffSummary from '../core/prd-differ.js' (NOT models.js — DiffSummary lives in prd-differ.ts
        and is re-exported from core/index.ts:69). READ-ONLY — do NOT modify prd-differ.ts.

- file: src/workflows/delta-analysis-workflow.ts
  section: lines 118-170 (analyzeDelta step)
  why: THE CANONICAL 5-STEP LLM-CALL RECIPE. createQAAgent() → createDeltaAnalysisPrompt() →
        retryAgentPrompt(() => agent.prompt(prompt), {agentType,operation}) → discriminate .status → use
        .data. S1 follows this EXCEPT it calls agent.prompt(prompt) directly (NO retryAgentPrompt — that
        is S2's contract). The status-discrimination + error-message extraction is the template.
  pattern: if (agentResponse.status !== 'success' || agentResponse.data === null) { throw new Error(
        `QA agent failed: ${agentResponse.error?.message ?? 'Unknown error'}`); } const result =
        agentResponse.data;
  gotcha: S1 throws an AgentError (not a bare Error) so S2's isTransientError classifies it transient.
        See src/utils/errors.js for AgentError + ErrorCodes.PIPELINE_AGENT_LLM_FAILED.

- file: src/agents/prompts/delta-analysis-prompt.ts
  why: THE TEMPLATE for the new prompt-generator file. Mirror its structure EXACTLY: private
        constructUserPrompt() helper + exported createXxxPrompt() using createPrompt({ user, system,
        responseFormat, enableReflection }). Import the system-prompt const + PRD_PREMERGED_DECLARATION
        from '../prompts.js'. Import the schema + (optionally) the type from the classifier module.
  pattern: constructUserPrompt renders structured input into a markdown user turn prepended with
        PRD_PREMERGED_DECLARATION; createXxxPrompt wraps it in createPrompt with responseFormat = the Zod
        enum schema + enableReflection: true.

- file: src/agents/prompts.ts
  section: line 821 (DELTA_ANALYSIS_PROMPT const), lines 1159-1162 (PROMPTS lookup + PromptKey type),
        line 770 (DELTA_PRD_PROMPT — note this is DEAD CODE per phase findings; do NOT copy its
        $PREV_SESSION_DIR shell-substitution style)
  why: Layer A of the two-layer prompt convention. Add CHANGE_CLASSIFIER_PROMPT here (prepended with
        PRD_PREMERGED_DECLARATION, like DELTA_ANALYSIS_PROMPT), and register it in PROMPTS + PromptKey.
  pattern: export const CHANGE_CLASSIFIER_PROMPT = `\n# Change Classifier\n\n${PRD_PREMERGED_DECLARATION}\n\n...`
        as a backtick string; PROMPTS lookup is `{ TASK_BREAKDOWN, PRP_BLUEPRINT, ..., CHANGE_CLASSIFIER } as const`.

- file: src/agents/prompts/index.ts
  why: Layer B barrel. Add two re-export lines mirroring the existing four (createArchitectPrompt,
        createPRPBlueprintPrompt, createDeltaAnalysisPrompt, createBugHuntPrompt).
  pattern: export { createChangeClassificationPrompt, createArtifactClassificationPrompt } from
        './change-classifier-prompt.js';

- file: src/agents/agent-factory.ts
  section: createQAAgent() (line 447), createBaseConfig() (line 295)
  why: S1 REUSES createQAAgent() — it already exists, returns a configured Agent (reasoning role, xhigh
        budget, BUG_HUNT_PROMPT system). The classifier overrides the system prompt via the Prompt<T>'s
        `system` field (createPrompt system takes precedence over the agent's default system for that
        call). NO edit to agent-factory.ts (reuse; zero contention with S2 / P3.M2.T6.S2).
  gotcha: createQAAgent uses the 'qa' persona (stateless, reasoning role). That is fine for a
        single-shot classification. DO NOT add a new persona (avoids editing the shared AgentPersona union
        + PERSONA_TOKEN_LIMITS + STATELESS_PERSONAS — minimizes merge contention). The item explicitly
        permits "via createQAAgent".

- file: src/utils/errors.js
  why: AgentError + ErrorCodes for the throwing boundary. S1 throws AgentError({ code:
        ErrorCodes.PIPELINE_AGENT_LLM_FAILED, message }) on any non-success / empty / enum-invalid model
        output. This code is transient by default in src/utils/retry.ts isTransientError (S2 retries it).
  gotcha: do NOT put 'parse'/'parsing' in the thrown message — isTransientError treats a message
        containing those words as PERMANENT (not retried). S1's invalid-output message should say e.g.
        'change classifier returned no data' / 'invalid classification value', NOT 'failed to parse'.

- file: src/utils/retry.ts
  section: isTransientError (lines 311-395), retryAgentPrompt (lines 668-698)
  why: READ to understand the S2 boundary S1 sets up. S1 does NOT call retryAgentPrompt (S2 will wrap
        S1's classifyChange/classifyArtifact). S1 just needs to throw a TRANSIENT error so S2's retry
        treats it as retryable. PIPELINE_AGENT_LLM_FAILED is transient; ValidationError + 'parse' messages
        are permanent. Watchdog kill (exit 124) is terminal. NO empty-output detection in isTransientError
        — empty output must surface as a thrown AgentError (S1 does this).
  gotcha: DO NOT wrap the agent call in retryAgentPrompt in S1 — that is S2's contract. S1 calls
        agent.prompt(prompt) bare and throws on failure.

- file: tests/unit/workflows/delta-analysis-workflow.test.ts
  section: lines 24-31 (vi.mock boilerplate), lines 105-123 (AgentResponse injection)
  why: THE TEST TEMPLATE (Strategy A). vi.mock('../../../src/agents/agent-factory.js', () => ({
        createQAAgent: vi.fn() })); vi.mock the prompt-generator module; import the mocked factory; cast
        as any; per-test mockReturnValue({ prompt: vi.fn().mockResolvedValue({ status:'success',
        data:'SUBSTANTIVE', error:null, metadata:{} }) }).
  pattern: describe → GIVEN → it('SHOULD') → // SETUP // EXECUTE // VERIFY comment blocks. vi.clearAllMocks()
        in beforeEach (also done globally by tests/setup.ts, but per-file is conventional for clarity).

- file: tests/unit/core/prd-differ.test.ts
  section: lines 498-567 (DiffSummary inline-literal construction), lines 13-21 (import pattern)
  why: How to construct a DiffSummary test fixture (inline literal, all readonly fields) for feeding
        classifyChange. Import type { DiffSummary } from '../../../src/core/prd-differ.js'.

- file: vitest.config.ts
  why: 100% coverage thresholds (statements/branches/functions/lines ALL 100). pool:'forks'.
        setupFiles:['./tests/setup.ts']. groundswell alias → ../groundswell/dist/index.js. The new test
        MUST achieve 100% coverage of the new module (every branch: success/error/empty/enum-invalid/
        empty-content-guard must have a test).

- file: plan/008_15504f60a0ef/P4M1T1S1/research/00_research_summary.md
  why: S1's own research summary. §VERDICT (net-new module), §SCOPE BOUNDARY (S1 vs S2 — the load-bearing
        split), §The canonical LLM-call recipe, §AgentResponse shape, §createPrompt signature, §Prompt
        registration two layers, §The agent factory decision (reuse createQAAgent), §Retry layer facts (the
        S2 boundary), §Logger lazy pattern, §Test conventions (100% coverage + Strategy A mock), §npm
        scripts. The implementer MUST read this before writing the module.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  prd-differ.ts                 # INPUT TYPE owner — DiffSummary + SectionChange (lines 111-164). READ-ONLY.
  models.ts                     # dual-declaration convention reference (Status/StatusEnum line 200). NOT edited.
  index.ts                      # re-exports prd-differ types (line 69). NOT edited (types co-located in new module).
src/agents/
  agent-factory.ts              # createQAAgent() (line 447) — REUSED, NOT edited.
  prompts.ts                    # Layer A — string-constant system prompts. MODIFY: add CHANGE_CLASSIFIER_PROMPT.
  prompts/
    index.ts                    # Layer B barrel. MODIFY: add two re-export lines.
    delta-analysis-prompt.ts    # TEMPLATE for the new prompt-generator file (read-only reference).
    change-classifier-prompt.ts # NEW — createChangeClassificationPrompt + createArtifactClassificationPrompt.
  prompts.ts (CHANGE_CLASSIFIER_PROMPT)  # MODIFY — add const + PROMPTS/PromptKey registration.
src/utils/
  errors.js                     # AgentError + ErrorCodes (PIPELINE_AGENT_LLM_FAILED) — the throwing boundary.
  retry.ts                      # isTransientError (read-only) — explains why PIPELINE_AGENT_LLM_FAILED is transient.
  logger.ts                     # getLogger('name') lazy pattern (read-only).
tests/unit/
  core/
    prd-differ.test.ts          # TEMPLATE — DiffSummary fixture construction + GIVEN/SHOULD style (read-only).
    change-classifier.test.ts   # NEW — the unit suite (Strategy A mocks).
  workflows/
    delta-analysis-workflow.test.ts  # TEMPLATE — vi.mock(agent-factory) + AgentResponse injection (read-only).
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/
  change-classifier.ts          # NEW — ChangeClassification/ArtifactClassification types + Zod schemas +
                                #   classifyChange(diffSummary) + classifyArtifact(content). Each: createQAAgent()
                                #   → build Prompt<T> → agent.prompt(prompt) bare (NO retry — S2 owns that) →
                                #   discriminate .status → return .data OR throw AgentError(PIPELINE_AGENT_LLM_FAILED).
                                #   Mode-A JSDoc citing PRD §4.3. Lazy logger accessor.
src/agents/prompts/
  change-classifier-prompt.ts   # NEW — createChangeClassificationPrompt(diffSummary) + createArtifactClassificationPrompt(content).
                                #   Mirror delta-analysis-prompt.ts: private constructUserPrompt helpers + exported
                                #   createXxxPrompt via createPrompt({user, system: CHANGE_CLASSIFIER_PROMPT,
                                #   responseFormat: <enum schema>, enableReflection: true}).
src/agents/prompts.ts           # MODIFY — add CHANGE_CLASSIFIER_PROMPT const (PRD_PREMERGED_DECLARATION prepended) +
                                #   register in PROMPTS lookup + PromptKey type.
src/agents/prompts/index.ts     # MODIFY — add `export { createChangeClassificationPrompt, createArtifactClassificationPrompt } from './change-classifier-prompt.js';`.
tests/unit/core/
  change-classifier.test.ts     # NEW — Strategy A mocks; happy-path (COSMETIC/SUBSTANTIVE/CLEAN/DIRTY),
                                #   status:'error' throw, empty-data throw, enum-invalid-data throw, empty-content
                                #   guard, prompt-threading (DiffSummary/content verbatim), prompt-constant registration.
                                #   100% branch coverage of change-classifier.ts.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (S1 vs S2 scope split — load-bearing): S1 implements the classifier FUNCTIONS + prompts ONLY.
//   S1 MUST NOT implement retry (retryAgentPrompt) or the protective default (SUBSTANTIVE/DIRTY on exhaustion).
//   Those are S2's contract. S1's job is to make the LLM call and throw a TRANSIENT AgentError on failure —
//   that throw is the boundary S2 wraps in a retry loop. If S1 swallows the error or returns a silent default,
//   S2 has nothing to retry and the PRD §4.3 protective-default clause is unimplementable.

// CRITICAL (throw a TRANSIENT error, never a permanent one): throw `new AgentError(message)`
//   (no options). AgentError.code is HARDCODED to ErrorCodes.PIPELINE_AGENT_LLM_FAILED (errors.ts:423)
//   — transient by default in isTransientError (retry.ts:326-337) so S2 retries it. DO NOT use
//   ValidationError and DO NOT put 'parse'/'parsing' in the message — both are
//   PERMANENT (never retried) per isTransientError. Phrase invalid-output messages as 'returned no
//   data' / 'invalid classification value', NOT 'failed to parse'.

// CRITICAL (call agent.prompt() BARE, not via retryAgentPrompt): the retry wrapper is S2's layer. If S1 wraps
//   in retryAgentPrompt, S2's outer retry would double-retry (3× inner × 4× outer) and the protective-default
//   boundary would be wrong. S1: const response = await agent.prompt(prompt); — then discriminate.

// CRITICAL (AgentResponse has NO .content): agent.prompt() returns { status, data, error, metadata }. The
//   validated payload is .data (typed T from responseFormat), or null on error. Do NOT look for .content or
//   treat the return as a string. (commit-message-agent uses responseFormat: z.string() so ITS .data is a
//   string — S1 uses responseFormat: <enum schema> so .data is the union literal.)

// GOTCHA (responseFormat Zod enum validates the LLM output): createPrompt({ responseFormat:
//   ChangeClassificationSchema }) makes Groundswell validate the model's output against the enum. An
//   out-of-enum value → status:'error' (or data:null) → S1 throws. This is why S1 does NOT need its own
//   JSON.parse — Groundswell does the validation. (Contrast: bug-hunt's file-as-contract path does manual
//   JSON.parse because reasoning models don't honor responseFormat reliably for COMPLEX schemas; a 2-value
//   enum is simple enough that responseFormat works — delta-analysis uses it for DeltaAnalysisSchema.)

// GOTCHA (reuse createQAAgent, do NOT add a persona): adding a persona to agent-factory.ts means editing the
//   shared AgentPersona union + PERSONA_TOKEN_LIMITS + STATELESS_PERSONAS — merge contention with S2 and the
//   parallel P3.M2.T6.S2. The item explicitly permits "via createQAAgent". createQAAgent's default system
//   (BUG_HUNT_PROMPT) is OVERRIDDEN for the classification call by the Prompt<T>'s `system` field —
//   createPrompt({ system: CHANGE_CLASSIFIER_PROMPT }) takes precedence for that call. So reusing createQAAgent
//   is correct and zero-contention.

// GOTCHA (DiffSummary is readonly + imported from prd-differ.js): import type { DiffSummary } from
//   '../core/prd-differ.js'. All its fields are readonly (changes, summaryText, stats). The prompt generator
//   READS them (renders summaryText + changes into the user turn) — never mutates. Do NOT re-declare
//   DiffSummary; consume the existing type.

// GOTCHA (types co-located in the module, NOT models.ts): define ChangeClassification/ArtifactClassification
//   + their Zod schemas IN src/core/change-classifier.ts. They are the module's output contract and tightly
//   coupled to the classifier functions. This keeps S1's diff self-contained (no models.ts edit → less
//   contention with S2/future items) and matches the principle that a module owns its output types. S2 will
//   import them from change-classifier.ts. (models.ts is the precedent for the dual type+schema declaration
//   STYLE, not the location.)

// GOTCHA (PRD_PREMERGED_DECLARATION prepended): every prompt that embeds PRD/artifact content MUST state the
//   text is pre-merged (PRD §2.3). The CHANGE_CLASSIFIER_PROMPT constant AND the constructUserPrompt helpers
//   prepend PRD_PREMERGED_DECLARATION (matching DELTA_ANALYSIS_PROMPT + delta-analysis-prompt.ts). Import it
//   from '../prompts.js'.

// GOTCHA (ESM .js imports): all intra-project imports use .js extensions even in .ts source
//   (e.g. '../core/prd-differ.js', './change-classifier-prompt.js', '../agents/agent-factory.js').

// GOTCHA (lazy logger accessor, not constructor field): use the module-private idiom
//   `let _logger: Logger | undefined; const logger = () => (_logger ??= getLogger('ChangeClassifier'));`
//   (mirrors dependency-validator.ts:44-45, retry.ts:628-629). Avoid the constructor-field idiom (loses
//   lazy instantiation). Debug-log the classification result; warn-log throws.

// GOTCHA (100% branch coverage enforced): vitest.config.ts requires statements/branches/functions/lines ALL
//   at 100%. Every branch in change-classifier.ts (success path, status!=='success' throw, data===null throw,
//   enum-invalid throw, empty-content guard) MUST have an explicit test. Use describe → GIVEN → it('SHOULD')
//   → // SETUP // EXECUTE // VERIFY.
```

---

## Implementation Blueprint

### Data models and structure

The classifier module co-locates its output types (the classification unions + Zod schemas) with
the functions that produce them, following the `Status`/`StatusEnum` dual-declaration *style*
(`models.ts:200`) but in the new module (not models.ts).

```typescript
/**
 * (Module header — Mode A) PRD §4.3 (h3.5) "The Delta Workflow" step 1, "Change Classification" —
 * the LLM-driven binary classifiers. classifyChange turns the structural DiffSummary (from
 * diffPRDs, src/core/prd-differ.ts) into a COSMETIC (trivial: whitespace/formatting) vs
 * SUBSTANTIVE (semantically significant) verdict. classifyArtifact guards a generated artifact
 * (e.g. delta_prd.md) as CLEAN or DIRTY.
 *
 * SCOPE (P4.M1.T1.S1): this module is the INNER LLM call. It does NOT retry and does NOT apply
 * a protective default — that is P4.M1.T1.S2 (bounded retry default 4 + fail-to-protective-default
 * SUBSTANTIVE/DIRTY on exhaustion). On any non-success / empty / enum-invalid model output this
 * module throws a TRANSIENT AgentError(PIPELINE_AGENT_LLM_FAILED) so S2's retry treats it as
 * retryable.
 */
import { z } from 'zod';
import type { Agent } from 'groundswell';
import { DiffSummary } from '../core/prd-differ.js';   // type-only import is fine; see note
import { createQAAgent } from '../agents/agent-factory.js';
import {
  createChangeClassificationPrompt,
  createArtifactClassificationPrompt,
} from '../agents/prompts/change-classifier-prompt.js';
import { AgentError, ErrorCodes } from '../utils/errors.js';
import { getLogger, type Logger } from '../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ChangeClassifier'));

/** COSMETIC (trivial: whitespace/formatting) vs SUBSTANTIVE (semantically significant). PRD §4.3. */
export type ChangeClassification = 'COSMETIC' | 'SUBSTANTIVE';
export const ChangeClassificationSchema = z.enum(['COSMETIC', 'SUBSTANTIVE']);

/** CLEAN vs DIRTY artifact classification (guards generated artifacts, e.g. delta_prd.md). PRD §4.3. */
export type ArtifactClassification = 'CLEAN' | 'DIRTY';
export const ArtifactClassificationSchema = z.enum(['CLEAN', 'DIRTY']);

/**
 * Classify a detected PRD change as COSMETIC or SUBSTANTIVE via an LLM call over the structural
 * DiffSummary. PRD §4.3.
 *
 * @throws {AgentError} code PIPELINE_AGENT_LLM_FAILED (transient) on status!=='success', null data,
 *   or an enum-invalid value — so the S2 retry layer can re-attempt and apply the protective default.
 */
export async function classifyChange(diffSummary: DiffSummary): Promise<ChangeClassification> {
  const agent: Agent = createQAAgent();
  const prompt = createChangeClassificationPrompt(diffSummary);
  const response = await agent.prompt(prompt);   // BARE — no retryAgentPrompt (S2 owns retry)
  if (response.status !== 'success' || response.data === null) {
    const msg = `change classifier returned no data: ${response.error?.message ?? 'unknown error'}`;
    logger().warn({ status: response.status }, msg);
    // AgentError.code is HARDCODED to PIPELINE_AGENT_LLM_FAILED (errors.ts:423) — transient by default.
    throw new AgentError(msg);
  }
  // response.data is validated against ChangeClassificationSchema by Groundswell (responseFormat).
  const result = response.data as ChangeClassification;
  logger().debug({ classification: result }, 'change classified');
  return result;
}

/**
 * Classify a generated artifact (e.g. delta_prd.md content) as CLEAN or DIRTY via an LLM call.
 * PRD §4.3.
 *
 * @throws {AgentError} code PIPELINE_AGENT_LLM_FAILED (transient) on empty input or model failure.
 */
export async function classifyArtifact(content: string): Promise<ArtifactClassification> {
  if (!content || content.trim().length === 0) {
    throw new AgentError('artifact classifier received empty content');  // code hardcoded PIPELINE_AGENT_LLM_FAILED
  }
  const agent: Agent = createQAAgent();
  const prompt = createArtifactClassificationPrompt(content);
  const response = await agent.prompt(prompt);
  if (response.status !== 'success' || response.data === null) {
    const msg = `artifact classifier returned no data: ${response.error?.message ?? 'unknown error'}`;
    logger().warn({ status: response.status }, msg);
    throw new AgentError(msg);  // code hardcoded PIPELINE_AGENT_LLM_FAILED
  }
  const result = response.data as ArtifactClassification;
  logger().debug({ classification: result }, 'artifact classified');
  return result;
}
```

> **NOTE on the `DiffSummary` import:** it is an interface (type-only). Use
> `import type { DiffSummary } from '../core/prd-differ.js';` to avoid a runtime import cycle risk.
> **`AgentError` constructor (verified `src/utils/errors.ts:422-428`):** `new AgentError(message,
> context?: PipelineErrorContext, cause?: Error)`. Its `code` is a HARDCODED readonly class property
> (`readonly code = ErrorCodes.PIPELINE_AGENT_LLM_FAILED`) — you do NOT pass `code` as an option.
> This is exactly what S1 wants: any thrown `AgentError` is transient by default (`isTransientError`
> treats `PIPELINE_AGENT_LLM_FAILED` as transient). `ErrorCodes` does not need to be imported for the
> throw (only if you assert on it in tests); `AgentError` is the only import needed from
> `../utils/errors.js`. Match the existing call sites: `throw new AgentError('message')` (e.g.
> `git-commit.ts` stagecoach boundary uses `new AgentError('... failed: ...')`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/agents/prompts.ts — add CHANGE_CLASSIFIER_PROMPT constant (Layer A)
  - IMPLEMENT: export const CHANGE_CLASSIFIER_PROMPT = `<backtick string>` — a classification
    system prompt that (a) prepends PRD_PREMERGED_DECLARATION, (b) instructs the model to emit
    EXACTLY one token: COSMETIC or SUBSTANTIVE for changes / CLEAN or DIRTY for artifacts, (c)
    defines the two labels precisely per PRD §4.3 (COSMETIC = trivial: whitespace/formatting;
    SUBSTANTIVE = semantically significant; CLEAN = artifact is well-formed and faithful;
    DIRTY = artifact is malformed / contaminated / unfaithful), (d) includes 1–2 few-shot
    examples mirroring the DELTA_ANALYSIS_PROMPT style. A SINGLE constant serves both functions
    (the user turn disambiguates change-vs-artifact via the prompt-generator helpers).
  - MODIFY: add `CHANGE_CLASSIFIER: CHANGE_CLASSIFIER_PROMPT,` to the PROMPTS lookup object
    (~line 1159) and add `'CHANGE_CLASSIFIER'` to the PromptKey type.
  - FOLLOW pattern: DELTA_ANALYSIS_PROMPT (prompts.ts:821) — backtick string, PRD_PREMERGED_DECLARATION
    prepended, clear role/role-definition header.
  - NAMING: SCREAMING_SNAKE_CASE constant; CHANGE_CLASSIFIER key in PROMPTS.
  - PLACEMENT: src/agents/prompts.ts (Layer A, alongside the other system-prompt constants).
  - GOTCHA: do NOT copy DELTA_PRD_PROMPT's $PREV_SESSION_DIR shell-substitution style (it is dead
    code per phase findings). Use plain markdown.

Task 2: CREATE src/agents/prompts/change-classifier-prompt.ts (Layer B — the Prompt<T> generator)
  - IMPORT: createPrompt, type Prompt from 'groundswell'; ChangeClassification +
    ChangeClassificationSchema + ArtifactClassification + ArtifactClassificationSchema from
    '../../core/change-classifier.js'; CHANGE_CLASSIFIER_PROMPT + PRD_PREMERGED_DECLARATION from
    '../prompts.js'; type DiffSummary from '../../core/prd-differ.js'.
  - IMPLEMENT private constructChangeUserPrompt(diffSummary: DiffSummary): string — renders the
    DiffSummary into a markdown user turn: the summaryText, the stats (totalAdded/Modified/Removed,
    sectionsAffected), and each SectionChange (type, sectionTitle, impact, and oldContent/newContent
    for context). Prepend PRD_PREMERGED_DECLARATION. Instruct: "Classify this change as exactly
    COSMETIC or SUBSTANTIVE."
  - IMPLEMENT private constructArtifactUserPrompt(content: string): string — wraps the artifact
    content in a fenced block, prepends PRD_PREMERGED_DECLARATION, instructs: "Classify this
    artifact as exactly CLEAN or DIRTY."
  - IMPLEMENT export function createChangeClassificationPrompt(diffSummary: DiffSummary):
    Prompt<ChangeClassification> — createPrompt({ user: constructChangeUserPrompt(diffSummary),
    system: CHANGE_CLASSIFIER_PROMPT, responseFormat: ChangeClassificationSchema,
    enableReflection: true }).
  - IMPLEMENT export function createArtifactClassificationPrompt(content: string):
    Prompt<ArtifactClassification> — same shape with constructArtifactUserPrompt(content) +
    ArtifactClassificationSchema.
  - FOLLOW pattern: src/agents/prompts/delta-analysis-prompt.ts (private constructUserPrompt +
    exported createXxxPrompt via createPrompt).
  - NAMING: createChangeClassificationPrompt / createArtifactClassificationPrompt (camelCase,
    create-prefixed, matching createDeltaAnalysisPrompt).
  - PLACEMENT: src/agents/prompts/change-classifier-prompt.ts.
  - GOTCHA: the .js import of change-classifier.js from prompts/ creates a dependency
    prompts/ → core/change-classifier → agents/agent-factory + prompts/change-classifier-prompt.
    This is a CYCLE only if change-classifier.ts imports the generator at module-load in a way that
    loops; it imports it (Task 3) but the generator imports only TYPES + SCHEMAS (type-only) from
    change-classifier.ts — use `import type` for the unions and a value import for the Zod schemas
    (schemas are values). To be safe, the generator can import the schemas from change-classifier.ts
    (Zod schemas are side-effect-free values) and the types via `import type`. If a cycle warning
    surfaces at typecheck, move the 4 type+schema declarations into a tiny
    src/core/change-classifier-types.ts and have BOTH modules import from it — but try the direct
    import first (TS handles type/value mixed imports from the same module without runtime cycle
    issues because the schemas are pure constants).

Task 3: CREATE src/core/change-classifier.ts (the classifier module — see Data models block)
  - IMPLEMENT: the module header (PRD §4.3 citation + S1/S2 scope note); the 4 type+schema
    declarations; the lazy logger accessor; classifyChange(diffSummary); classifyArtifact(content).
    See Data models block for exact code.
  - FOLLOW pattern: src/workflows/delta-analysis-workflow.ts:118-170 (status discrimination +
    error-message extraction) — EXCEPT call agent.prompt(prompt) bare (no retryAgentPrompt).
  - NAMING: classifyChange / classifyArtifact (verb-first, matching hasSignificantChanges /
    classifyError in task-retry-manager.ts:369).
  - DEPENDENCIES: zod; groundswell (type Agent); ../core/prd-differ.js (type DiffSummary);
    ../agents/agent-factory.js (createQAAgent); ../agents/prompts/change-classifier-prompt.js (the
    generators); ../utils/errors.js (AgentError); ../utils/logger.js (getLogger).
  - PLACEMENT: src/core/change-classifier.ts (the path named in the item contract).
  - GOTCHA: `AgentError` constructor is `new AgentError(message, context?, cause?)` (errors.ts:425);
    its `code` is HARDCODED to PIPELINE_AGENT_LLM_FAILED (errors.ts:423) — do NOT pass `{ code }`.
    Import only `AgentError` (ErrorCodes only needed if a test asserts on the code). The thrown
    message MUST NOT contain 'parse'/'parsing' (isTransientError treats those words as permanent).

Task 4: MODIFY src/agents/prompts/index.ts — re-export the generators (Layer B barrel)
  - ADD: `export { createChangeClassificationPrompt, createArtifactClassificationPrompt } from
    './change-classifier-prompt.js';`
  - FOLLOW pattern: the existing 4 re-export lines (createArchitectPrompt, createPRPBlueprintPrompt,
    createDeltaAnalysisPrompt, createBugHuntPrompt).
  - PLACEMENT: src/agents/prompts/index.ts.

Task 5: CREATE tests/unit/core/change-classifier.test.ts (Strategy A — the unit suite)
  - IMPORT: describe, expect, it, vi, beforeEach from 'vitest'; classifyChange, classifyArtifact,
    ChangeClassification, ArtifactClassification from '../../../src/core/change-classifier.js';
    type DiffSummary from '../../../src/core/prd-differ.js'; createQAAgent from
    '../../../src/agents/agent-factory.js'; createChangeClassificationPrompt,
    createArtifactClassificationPrompt from '../../../src/agents/prompts/change-classifier-prompt.js';
    CHANGE_CLASSIFIER_PROMPT from '../../../src/agents/prompts.js'.
  - MOCK (top-level, before imports): 
        vi.mock('../../../src/agents/agent-factory.js', () => ({ createQAAgent: vi.fn() }));
        vi.mock('../../../src/agents/prompts/change-classifier-prompt.js', () => ({
          createChangeClassificationPrompt: vi.fn(),
          createArtifactClassificationPrompt: vi.fn(),
        }));
    Then import the mocked modules and cast as any (mockCreateQAAgent, etc.).
  - beforeEach: vi.clearAllMocks(); mockCreateQAAgent.mockReturnValue({ prompt: vi.fn() });
    mockCreateChangeClassificationPrompt.mockReturnValue({ __prompt: 'change' });
    mockCreateArtifactClassificationPrompt.mockReturnValue({ __prompt: 'artifact' }).
  - describe('classifyChange'):
    * GIVEN a successful SUBSTANTIVE response → mockReturnValue({ prompt: vi.fn().mockResolvedValue(
      { status:'success', data:'SUBSTANTIVE', error:null, metadata:{} }) }); const result = await
      classifyChange(diffFixture); expect(result).toBe('SUBSTANTIVE'); expect(createQAAgent).
      toHaveBeenCalled(); expect(createChangeClassificationPrompt).toHaveBeenCalledWith(diffFixture)
      (proves the DiffSummary is threaded verbatim — PRD §4.3 + contract LOGIC (c)).
    * GIVEN a successful COSMETIC response → data:'COSMETIC' → expect('COSMETIC').
    * GIVEN status:'error' → mockResolvedValue({ status:'error', data:null, error:{message:'oops'},
      metadata:{} }) → await expect(classifyChange(diff)).rejects.toThrow(); assert the thrown error
      is an AgentError with code PIPELINE_AGENT_LLM_FAILED (transient — S2 boundary). Import
      { isAgentError } from '../../../src/utils/errors.js' (errors.ts:703) to assert
      `isAgentError(cause)` === true, and `cause.code === 'PIPELINE_AGENT_LLM_FAILED'`. (AgentError's
      code is hardcoded, so this assertion is stable.)
    * GIVEN status:'success' but data:null → rejects.toThrow (AgentError PIPELINE_AGENT_LLM_FAILED).
    * GIVEN status:'partial' → treat as success per AgentResponse contract? NO — mirror
      delta-analysis-workflow (only 'success' is usable). Test: 'partial' → rejects.toThrow (the
      `status !== 'success'` branch covers it). [Confirm: if 'partial' should be treated as data,
      adjust — but delta-analysis throws on non-success, so mirror that.]
  - describe('classifyArtifact'):
    * GIVEN successful CLEAN → data:'CLEAN' → expect('CLEAN'); createArtifactClassificationPrompt
      called with the content string.
    * GIVEN successful DIRTY → data:'DIRTY' → expect('DIRTY').
    * GIVEN status:'error' → rejects.toThrow (AgentError PIPELINE_AGENT_LLM_FAILED).
    * GIVEN empty content input ('' and '   ') → rejects.toThrow BEFORE calling the agent (assert
      createQAAgent was NOT called — the guard short-circuits). This is the empty-content guard branch.
    * GIVEN status:'success' data:null → rejects.toThrow.
  - describe('prompt registration'):
    * expect(CHANGE_CLASSIFIER_PROMPT).toBeTruthy() + expect it to contain 'COSMETIC' and
      'SUBSTANTIVE' and 'CLEAN' and 'DIRTY' (locks the label vocabulary per PRD §4.3).
    * expect(createChangeClassificationPrompt).toBeTypeOf('function') + same for
      createArtifactClassificationPrompt (the generators are exported).
  - COVERAGE: every branch in change-classifier.ts must be hit — success (change), success
    (artifact), status!=='success' (change), status!=='success' (artifact), data===null (change),
    data===null (artifact), empty-content guard (artifact). 100% statements/branches/functions/lines.
  - FOLLOW pattern: tests/unit/workflows/delta-analysis-workflow.test.ts:24-31,105-123 (Strategy A
    mock boilerplate + AgentResponse injection) + tests/unit/core/prd-differ.test.ts (GIVEN/SHOULD +
    SETUP/EXECUTE/VERIFY + DiffSummary fixture construction).
  - FIXTURE: build a DiffSummary inline (prd-differ.test.ts:498-567 style) with 1–2 SectionChanges
    for the change-classification tests.
  - PLACEMENT: tests/unit/core/change-classifier.test.ts.

Task 6: JSDoc (Mode A — rides with the work)
  - change-classifier.ts: module header (PRD §4.3 + S1/S2 scope note) + JSDoc on
    ChangeClassification, ChangeClassificationSchema, ArtifactClassification,
    ArtifactClassificationSchema, classifyChange, classifyArtifact (citing PRD §4.3 + the
    @throws AgentError boundary for S2).
  - change-classifier-prompt.ts: module header + JSDoc on createChangeClassificationPrompt /
    createArtifactClassificationPrompt (citing PRD §4.3 + the responseFormat validation).
  - prompts.ts: JSDoc on CHANGE_CLASSIFIER_PROMPT (like DELTA_ANALYSIS_PROMPT's JSDoc).
  - change-classifier.test.ts: describe-block doc comments citing PRD §4.3 + the S1/S2 split.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the 5-step LLM call (delta-analysis-workflow.ts:118-170), MINUS the retry wrapper (S2 owns it).
export async function classifyChange(diffSummary: DiffSummary): Promise<ChangeClassification> {
  const agent = createQAAgent();                                    // 1. create agent (reused)
  const prompt = createChangeClassificationPrompt(diffSummary);     // 2. build typed Prompt<T>
  const response = await agent.prompt(prompt);                      // 3. BARE call (NO retryAgentPrompt)
  if (response.status !== 'success' || response.data === null) {    // 4. discriminate .status
    throw new AgentError(                                           //    throw TRANSIENT (S2 retries)
      `change classifier returned no data: ${response.error?.message ?? 'unknown error'}`,
    );  // AgentError.code is HARDCODED to PIPELINE_AGENT_LLM_FAILED (errors.ts:423) — no { code } arg
  }
  return response.data as ChangeClassification;                     // 5. use validated .data
}

// PATTERN: the prompt generator (delta-analysis-prompt.ts), with responseFormat = Zod enum.
export function createChangeClassificationPrompt(diffSummary: DiffSummary): Prompt<ChangeClassification> {
  return createPrompt({
    user: constructChangeUserPrompt(diffSummary),     // renders summaryText + changes into markdown
    system: CHANGE_CLASSIFIER_PROMPT,                 // overrides createQAAgent's BUG_HUNT_PROMPT for this call
    responseFormat: ChangeClassificationSchema,       // Groundswell validates output ∈ {'COSMETIC','SUBSTANTIVE'}
    enableReflection: true,
  });
}
//   GOTCHA: responseFormat on a 2-value enum is reliable (delta-analysis uses it for the complex
//   DeltaAnalysisSchema; a 2-value enum is strictly simpler). If the model emits prose, Groundswell
//   validation fails → status:'error' → S1 throws → S2 retries. Do NOT switch to file-as-contract
//   (that is for reasoning models failing on COMPLEX schemas — bug-hunt's lesson).

// PATTERN: the throwing boundary for S2 (transient, retried by S2's isTransientError).
throw new AgentError(message);  // code is HARDCODED to PIPELINE_AGENT_LLM_FAILED (errors.ts:423)
//   isTransientError (retry.ts:326-337): PIPELINE_AGENT_LLM_FAILED is transient UNLESS the message
//   contains 'parse'/'parsing'. So phrase invalid-output messages as 'returned no data' / 'invalid
//   classification value' — NEVER 'failed to parse'. ValidationError is ALSO permanent — do not use it.

// PATTERN: the Strategy-A test mock (delta-analysis-workflow.test.ts:24-31,105-123).
vi.mock('../../../src/agents/agent-factory.js', () => ({ createQAAgent: vi.fn() }));
vi.mock('../../../src/agents/prompts/change-classifier-prompt.js', () => ({
  createChangeClassificationPrompt: vi.fn(),
  createArtifactClassificationPrompt: vi.fn(),
}));
import { createQAAgent } from '../../../src/agents/agent-factory.js';
const mockCreateQAAgent = createQAAgent as any;
// per-test:
mockCreateQAAgent.mockReturnValue({
  prompt: vi.fn().mockResolvedValue({
    status: 'success', data: 'SUBSTANTIVE', error: null, metadata: {},
  }),
});
```

### Integration Points

```yaml
NO RUNTIME INTEGRATION in S1 — this PRP adds the classifier module + prompts + tests. It does NOT:
  - wire classifyChange/classifyArtifact into handleDelta() (prp-pipeline.ts) — that is a LATER
    work item (the delta-workflow caller), once S2's retry/protective-default is in place. Wiring
    now would be dead code (S2 hasn't shipped the retry layer the caller needs).
  - modify DATABASE / CONFIG / ROUTES / CLI / harness / any workflow / retry.ts / agent-factory.ts.
  - add environment variables.
  - add npm dependencies.
The ONLY consumers of change-classifier.ts in S1 are:
  - tests/unit/core/change-classifier.test.ts (this PRP).
  - src/agents/prompts/change-classifier-prompt.ts (imports the type+schema values).
  - (future) P4.M1.T1.S2 wraps classifyChange/classifyArtifact in retry + protective default.
  - (future) the delta-workflow caller (handleDelta in prp-pipeline.ts) invokes the S2-wrapped
    classifier — NOT in scope for S1.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating each file — fix before proceeding
npm run lint            # eslint . --ext .ts (the new/modified files must pass)
npm run typecheck       # tsc --noEmit -p tsconfig.build.json (catches the prompts/→core cycle if any)
npm run format:check    # prettier --check (run `npm run format` if it complains)

# Expected: Zero errors. If typecheck flags a prompts/→core/change-classifier cycle, resolve by
# splitting the 4 type+schema declarations into src/core/change-classifier-types.ts and importing
# from there in both modules (see Task 2 GOTCHA). If lint flags unused imports, remove them.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new module in isolation
npm run test:run -- change-classifier

# Coverage of the new module (MUST be 100% statements/branches/functions/lines)
npm run test:coverage -- change-classifier

# Full suite (ensure no regression — the prompts.ts/index.ts edits must not break existing prompt tests)
npm run test:run

# Expected: All tests pass. The new tests (happy-path COSMETIC/SUBSTANTIVE/CLEAN/DIRTY, status:error
# throw, empty-data throw, enum-invalid throw [if reachable via mock], empty-content guard, prompt
# threading, prompt registration) must be GREEN. Coverage of change-classifier.ts MUST be 100%.
# If coverage < 100%, add a test for the uncovered branch (likely the 'partial' status or a
# specific null-data path).
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — S1 adds a leaf module + prompts + tests. There is no runtime integration to
# validate (no existing call site invokes classifyChange/classifyArtifact yet; wiring is a later
# work item). The "integration" is: npm run validate (lint + format + typecheck + test) all GREEN.

npm run validate
# Expected: GREEN. This is the gate.

# Manual verification (optional): confirm the prompt constant + generators are registered.
node -e "import('./dist/agents/prompts.js').then(m => console.log('CHANGE_CLASSIFIER' in m.PROMPTS, typeof m.CHANGE_CLASSIFIER_PROMPT))"
# (after `npm run build`) Expected: true string
# OR grep:
grep -n "CHANGE_CLASSIFIER_PROMPT\|createChangeClassificationPrompt" src/agents/prompts.ts src/agents/prompts/index.ts src/agents/prompts/change-classifier-prompt.ts
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Verify the thrown error is classified TRANSIENT by the existing isTransientError (so S2 will retry it).
# (Read-only check — confirms the S1/S2 boundary is correct.)
grep -n "PIPELINE_AGENT_LLM_FAILED" src/utils/errors.js src/utils/retry.ts
# Expected: PIPELINE_AGENT_LLM_FAILED is a valid ErrorCode AND isTransientError treats it as transient
# (unless the message contains 'parse'/'parsing' — confirm S1's messages avoid those words).

# Verify the classifier consumes the DiffSummary type from prd-differ (contract LOGIC (c)).
grep -n "DiffSummary" src/core/change-classifier.ts
# Expected: import type { DiffSummary } from '../core/prd-differ.js'; + classifyChange(diffSummary: DiffSummary).

# Verify no retry was added in S1 (S2 owns retry).
grep -n "retryAgentPrompt\|retry(" src/core/change-classifier.ts
# Expected: ZERO matches (retry is S2's contract).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] All new tests pass: `npm run test:run -- change-classifier`.
- [ ] 100% coverage of `src/core/change-classifier.ts`: `npm run test:coverage -- change-classifier`.
- [ ] No linting errors: `npm run lint`.
- [ ] No type errors: `npm run typecheck` (no prompts/→core cycle).
- [ ] No formatting issues: `npm run format:check`.
- [ ] `git diff --name-only` shows EXACTLY `src/core/change-classifier.ts`,
      `src/agents/prompts/change-classifier-prompt.ts`, `src/agents/prompts.ts`,
      `src/agents/prompts/index.ts`, and `tests/unit/core/change-classifier.test.ts`.

### Feature Validation

- [ ] `classifyChange(diffSummary)` returns `'COSMETIC'` or `'SUBSTANTIVE'` on success; throws
      `AgentError(PIPELINE_AGENT_LLM_FAILED)` on `status !== 'success'`, `data === null`, or
      enum-invalid output.
- [ ] `classifyArtifact(content)` returns `'CLEAN'` or `'DIRTY'` on success; throws the same
      transient error on model failure; throws on empty `content` input BEFORE calling the agent.
- [ ] Both call `agent.prompt(prompt)` BARE (no `retryAgentPrompt`) — retry is S2's contract.
- [ ] Both consume the `DiffSummary` / content via the prompt generators (the `DiffSummary` is
      threaded verbatim into `createChangeClassificationPrompt` — asserted in test).
- [ ] The classification prompt templates exist in BOTH layers: `CHANGE_CLASSIFIER_PROMPT` const
      in `prompts.ts` (registered in `PROMPTS` + `PromptKey`) AND the two generators in
      `prompts/change-classifier-prompt.ts` (re-exported from `prompts/index.ts`).
- [ ] The thrown error message AVOIDS 'parse'/'parsing' (so `isTransientError` treats it transient
      for S2 to retry).
- [ ] No retry / protective-default logic in S1 (S2 owns it).

### Code Quality Validation

- [ ] Mirrors `src/workflows/delta-analysis-workflow.ts:118-170` (status discrimination) — minus
      the retry wrapper.
- [ ] Mirrors `src/agents/prompts/delta-analysis-prompt.ts` (prompt-generator structure).
- [ ] Mirrors `tests/unit/workflows/delta-analysis-workflow.test.ts:24-31,105-123` (Strategy-A
      mock boilerplate + `AgentResponse` injection) + `tests/unit/core/prd-differ.test.ts`
      (GIVEN/SHOULD + SETUP/EXECUTE/VERIFY + DiffSummary fixture).
- [ ] Types co-located in the module (not models.ts) following the `Status`/`StatusEnum`
      dual-declaration *style*.
- [ ] Lazy logger accessor (`_logger ??= getLogger('ChangeClassifier')`).
- [ ] ESM `.js` imports throughout.
- [ ] Anti-patterns avoided (see below): no retry in S1, no models.ts edit, no agent-factory edit,
      no 'parse' in error messages, no responseFormat-as-text (use the Zod enum).

### Documentation & Deployment

- [ ] Mode-A JSDoc on `classifyChange`, `classifyArtifact`, the 4 type+schema declarations, and
      the module header — citing PRD §4.3 (h3.5 step 1) + the S1/S2 scope split.
- [ ] JSDoc on `CHANGE_CLASSIFIER_PROMPT` + the two prompt generators.
- [ ] No environment variables added (contract item 5: DOCS = Mode A only).
- [ ] No user-facing / config / API surface change beyond the new exported functions/types.

---

## Anti-Patterns to Avoid

- ❌ **Don't implement retry or the protective default in S1.** That is S2's contract
  (P4.M1.T1.S2). S1's job is the inner LLM call + a clean throwing boundary. If S1 wraps in
  `retryAgentPrompt` or returns a silent SUBSTANTIVE/DIRTY default on failure, S2 has nothing to
  retry and the PRD §4.3 protective-default clause becomes unimplementable.
- ❌ **Don't call `agent.prompt()` via `retryAgentPrompt`.** Call it bare
  (`const response = await agent.prompt(prompt);`). The retry wrapper is S2's layer; double-wrapping
  would compound retry counts and break the protective-default boundary.
- ❌ **Don't throw a permanent error.** Use `AgentError({ code: PIPELINE_AGENT_LLM_FAILED })` and
  AVOID the words 'parse'/'parsing' in the message (`isTransientError` treats those as permanent /
  non-retried). ValidationError is also permanent — do not use it. S2 must be able to retry S1's
  failures.
- ❌ **Don't look for `response.content` or treat the return as a string.** `agent.prompt()` returns
  `AgentResponse<T>` = `{ status, data, error, metadata }`. The validated payload is `.data` (typed
  `T` from `responseFormat`), or `null` on error. The commit-message-agent's `.data` is a string
  only because ITS `responseFormat` is `z.string()`; S1 uses the Zod enum, so `.data` is the union
  literal.
- ❌ **Don't add a new agent persona to `agent-factory.ts`.** Reuse `createQAAgent()` (the item
  explicitly permits "via createQAAgent"). A new persona means editing the shared `AgentPersona`
  union + `PERSONA_TOKEN_LIMITS` + `STATELESS_PERSONAS` — merge contention with S2 and the parallel
  P3.M2.T6.S2. The `Prompt<T>`'s `system` field overrides `createQAAgent`'s default `BUG_HUNT_PROMPT`
  for the classification call.
- ❌ **Don't edit `models.ts`.** Co-locate the classification types + Zod schemas in
  `src/core/change-classifier.ts` (the module owns its output contract). This keeps S1's diff
  self-contained and avoids contention. `models.ts` is the precedent for the dual-declaration
  *style*, not the location.
- ❌ **Don't touch `prd-differ.ts` or the dead `hasSignificantChanges()`.** S1 CONSUMES `DiffSummary`
  (read-only import). `hasSignificantChanges` is dead code the LLM classifier supersedes, but its
  removal is a separate concern — out of scope.
- ❌ **Don't switch to file-as-contract / manual `JSON.parse`.** That pattern exists because
  reasoning models fail `responseFormat` on COMPLEX schemas (the bug-hunt lesson). A 2-value Zod enum
  is simple enough that `responseFormat` works reliably (delta-analysis uses it for the complex
  `DeltaAnalysisSchema`). If the model emits prose, Groundswell validation fails → `status:'error'`
  → S1 throws → S2 retries.
- ❌ **Don't wire `classifyChange`/`classifyArtifact` into `handleDelta()` or any workflow.** The
  caller is a LATER work item (after S2 ships the retry/protective-default layer). Wiring now would
  be dead code and out of scope.
- ❌ **Don't overlap with the parallel P3.M2.T6.S2 (temp-prompt-cleanup) or S2 (retry).** This PRP's
  diff is exactly the five files listed. `src/core/temp-prompt-cleanup.ts` is P3.M2.T6.S2's;
  `src/utils/retry.ts` is S2's; `src/agents/agent-factory.ts` is reused (not edited).