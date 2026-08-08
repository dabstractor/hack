# PRP — P1.M1.T3.S2: Wire non-QA factories + `createQAAgent(reasoningLevel)` signature + commit-message-agent

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) + §9.2.3 (Model Selection). The "two independent axes"
> requirement: **which model a role runs** (tier) and **how hard it reasons** (thinking level) MUST be
> decoupled. **S1** (parallel, in flight) severed the coupling by making `createBaseConfig` take a REQUIRED
> `thinking` param, deliberately leaving **6 src call sites broken** (TS2554). **S2 (THIS task) wires those
> 6 sites**: each factory resolves its OWN reasoning getter and passes it; `createCleanupAgent` and
> `commit-message-agent` hardcode `'off'`; `createQAAgent` becomes `createQAAgent(reasoningLevel)` (caller
> supplies the level — the bug-finder/validation split lives at the call sites in S3). Mode-A JSDoc on each
> factory documents its reasoning knob + default. Architecture spec:
> `plan/013_3f31aa2b81b7/architecture/integration-points.md §C` (factories) + `§D` (commit-message-agent).

---

## Goal

**Feature Goal**: In `src/agents/agent-factory.ts`, wire the 5 agent factories to pass a per-identity
reasoning level to `createBaseConfig` (S1's new required `thinking` arg): `createArchitectAgent`→
`getReasoningBreakdown()`, `createResearcherAgent`→`getReasoningAgent()`, `createCoderAgent`→
`getReasoningImpl()`, `createCleanupAgent`→hardcoded `'off'`, and `createQAAgent(reasoningLevel)`→ the
caller-supplied level (new required-param signature). In `src/agents/commit-message-agent.ts:361`, pass
hardcoded `'off'`. Update each factory's JSDoc (Mode A) for its reasoning knob + default, and update all
remaining `xhigh`/"normal reasoning budget" mentions in the FACTORY blocks to the §9.2.9 defaults. Extend
`tests/unit/agents/agent-factory.test.ts` + `commit-message-agent.test.ts` + `cleanup-agent.test.ts` with
reasoning-wiring assertions (each factory's `config.thinking` equals its getter default with env unset,
honors an env override, and `config.model` stays the tier's model — the decoupling holds).

**Deliverable**:
1. **`src/agents/agent-factory.ts`** — (a) extend the `constants.js` import (L34) with
   `getReasoningAgent`, `getReasoningBreakdown`, `getReasoningImpl`; (b) wire the 5 factories (each
   `createBaseConfig(...)` gains its 3rd arg); (c) change `createQAAgent` signature to
   `(reasoningLevel: ReasoningLevel): Agent`; (d) Mode-A JSDoc on each of the 5 factories + rewrite the
   createQAAgent JSDoc; (e) update the remaining `xhigh`/`normal reasoning budget` mentions in the
   FACTORY blocks. `createBaseConfig`, `ROLE_CONFIG`, `getModel`, `ModelRole`, `PERSONA_TOKEN_LIMITS`,
   `STATELESS_PERSONAS`, `MCP_TOOLS`, and the createBaseConfig-region JSDoc are UNCHANGED (S1's scope).
2. **`src/agents/commit-message-agent.ts`** — pass `'off'` as the 3rd arg to `createBaseConfig` (L361) +
   a JSDoc sentence documenting the hardcoded-`'off'` decision.
3. **`tests/unit/agents/agent-factory.test.ts`** — add a delegating `createAgent` spy (to capture
   `config`), update the 2 existing `createQAAgent()` calls to pass a level, and add a new
   `describe('factory reasoning wiring')` block asserting each factory's thinking/model.
4. **`tests/unit/agents/commit-message-agent.test.ts`** — update the `toHaveBeenCalledWith('researcher',
   'research')` assertion to include `'off'`.
5. **`tests/unit/agents/cleanup-agent.test.ts`** — add an assertion that cleanup hardcodes `thinking:'off'`
   and is NOT coupled to `PRP_REASONING_IMPL_AGENT`.

**Success Definition**:
- `createArchitectAgent()` → captured `config.thinking === 'high'` (default), `config.model === 'zai/glm-5.2'`; with `PRP_REASONING_BREAKDOWN_AGENT=xhigh` → `thinking === 'xhigh'` (model unchanged).
- `createResearcherAgent()` → `thinking === 'high'` (default); honors `PRP_REASONING_AGENT`.
- `createCoderAgent()` → `thinking === 'off'` (default); with `PRP_REASONING_IMPL_AGENT=high` → `thinking === 'high'` AND `model === 'zai/glm-5-turbo'` (the decoupling proof: a fast-tier model running reasoning on).
- `createCleanupAgent()` → `thinking === 'off'` HARDCODED; `PRP_REASONING_IMPL_AGENT=high` does NOT change it.
- `createQAAgent('xhigh')` → `config.thinking === 'xhigh'`, `config.model === 'zai/glm-5.2'`; `createQAAgent` now REQUIRES the arg.
- `createCommitMessageAgent()` → `createBaseConfig('researcher', 'research', 'off')` (asserted via `toHaveBeenCalledWith`).
- `npx vitest run` of the 3 targeted test files is GREEN.
- `npm run typecheck` (src-only): the **6 S1 TS2554 errors are GONE** (S2 wires them). Any REMAINING
  TS2554 is ONLY the ~5 `createQAAgent()` production call sites (S3's scope) — do NOT fix those here.
- `npm run lint` + `npm run format:check` clean.

## User Persona

N/A — internal pipeline composition. Indirect "users" are the createQAAgent call sites (S3 wires them:
bug-hunt/validation/delta-analysis/change-classifier pass their resolved getter) and, ultimately,
pipeline operators who gain independent per-role control of model tier and reasoning level (PRD §9.2.9).

## Why

- **Closes the §9.2.9 "two independent axes" data path at the factories.** S1 made `thinking` a required
  param so forgetting to resolve a level is a loud error; S2 makes each factory actually resolve and pass
  its own level, so every role composes its model (tier) and reasoning (level) independently.
- **`createCleanupAgent` and `commit-message-agent` deliberately hardcode `'off'`.** Both are mechanical
  single-shot operations (filesystem reorg / diff→message). Coupling them to `PRP_REASONING_IMPL_AGENT`
  would let `=high` accidentally turn reasoning on for them. Hardcoding with a documented decision keeps
  them immune to that env knob while still honoring the §9.2.9 spirit (off for mechanical work).
- **`createQAAgent(reasoningLevel)` splits the bug-finder vs validation identity at the CALL SITE.** The
  factory no longer bakes in a single getter; S3 passes `getReasoningBugFinder()` or
  `getReasoningValidation()` (or `getReasoningAgent()` for research-leaning callers), so each QA consumer
  resolves its OWN level independently — the core §9.2.9 requirement.
- **Unblocks S3.** S3 updates the 4-5 `createQAAgent()` production call sites to pass their resolved level;
  it needs the new signature.

## What

### User-visible behavior
None directly. Indirectly (once S3 lands): each role's reasoning level is independently configurable via
`PRP_REASONING_*`, decoupled from its model tier; QA consumers (bug-finder vs validation) run at
independently-resolved levels.

### Technical requirements (exact contract)

**Import** (`agent-factory.ts:34`) — add 3 getters:
```ts
import {
  getBugFinderAgent,
  getReasoningAgent,
  getReasoningBreakdown,
  getReasoningImpl,
  type ReasoningLevel,
} from '../config/constants.js';
```
(`ReasoningLevel` already imported; keep it — it types `createQAAgent`'s param. Do NOT import
`getReasoningValidation`/`getReasoningBugFinder` here — those are consumed at the createQAAgent call sites
in S3, not in the factory.)

**The 6 wiring edits**:

| Site (~line) | AFTER |
| ------------ | ----- |
| createArchitectAgent body | `const baseConfig = createBaseConfig('architect', 'reasoning', getReasoningBreakdown());` |
| createResearcherAgent body | `const baseConfig = createBaseConfig('researcher', 'research', getReasoningAgent());` |
| createCoderAgent body | `const baseConfig = createBaseConfig('coder', 'implementation', getReasoningImpl());` |
| createCleanupAgent body | `const baseConfig = createBaseConfig('cleanup', 'implementation', 'off'); // HARDCODE — not coupled to PRP_REASONING_IMPL_AGENT` |
| createQAAgent signature + body | `export function createQAAgent(reasoningLevel: ReasoningLevel): Agent {` … `const baseConfig = createBaseConfig('qa', 'reasoning', reasoningLevel);` |
| commit-message-agent.ts:361 | `const baseConfig = createBaseConfig('researcher', 'research', 'off'); // single-shot commit messages (§9.2.9)` |

- Every other config field in each factory (`system`, `mcps`, `enableReflection`, `enableCache`, `name`,
  `maxTokens`, the `logger().debug(...)` calls) is UNCHANGED. createQAAgent's `bugFinderAgent:
  getBugFinderAgent()` debug log stays (observability only — it NAMES the persona; does not change tier).
- **`'off'` for cleanup/commit-message is a string literal, NOT `getReasoningImpl()`** — explicit hardcode
  immune to the impl env knob.

**JSDoc (Mode A) — S2 owns the 5 FACTORY blocks + commit-message-agent; S1 owns createBaseConfig/ROLE_CONFIG/ThinkingLevel:**
- After S1 lands, grep `xhigh` and `normal reasoning budget` in `agent-factory.ts`. The mentions inside
  `createBaseConfig`/`ROLE_CONFIG`/`ThinkingLevel` (incl. the ~L296 `@example`) are S1's — leave them.
  Update the mentions inside the 5 FACTORY `@remarks` blocks:
  - createArchitectAgent: "`high` reasoning budget (default, configurable per §9.2.9 via
    `getReasoningBreakdown()` / `PRP_REASONING_BREAKDOWN_AGENT`)."
  - createResearcherAgent: "`high` reasoning budget (default, configurable per §9.2.9 via
    `getReasoningAgent()` / `PRP_REASONING_AGENT`)."
  - createCoderAgent: "`off` reasoning budget (default, configurable per §9.2.9 via `getReasoningImpl()`
    / `PRP_REASONING_IMPL_AGENT`)."
  - createQAAgent: REWRITE — remove "balanced tier @ `xhigh`", "`--thinking xhigh`", "stays balanced @
    `xhigh`"; new text: "The reasoning level is resolved by the CALLER per §9.2.9 and passed as
    `reasoningLevel` (the bug-finder vs validation split lives at the call sites). The balanced model tier
    is unchanged." Update the `@example` to `const qa = createQAAgent(getReasoningValidation());`.
  - createCleanupAgent: "`off` reasoning budget (hardcoded — cleanup is a mechanical reorg, NOT coupled to
    `PRP_REASONING_IMPL_AGENT`; documented per §9.2.9)."
- commit-message-agent.ts factory JSDoc: add a sentence — "`thinking: 'off'` is hardcoded (single-shot
  commit-message generation; not coupled to `PRP_REASONING_IMPL_AGENT`; §9.2.9)."

### Success Criteria
- [ ] Import extended with `getReasoningAgent`/`getReasoningBreakdown`/`getReasoningImpl` (L34).
- [ ] 6 wiring edits applied exactly as above (cleanup + commit-message = literal `'off'`).
- [ ] `createQAAgent(reasoningLevel: ReasoningLevel): Agent` — required param; body passes it.
- [ ] Each factory JSDoc (Mode A) documents its reasoning knob + default; createQAAgent JSDoc rewritten.
- [ ] No `xhigh`/`normal reasoning budget` mention remains inside any FACTORY `@remarks` block (grep-gated).
- [ ] New `describe('factory reasoning wiring')` proves each factory's thinking default + env-override + decoupling (model unchanged).
- [ ] `createCleanupAgent` proven NOT coupled to `PRP_REASONING_IMPL_AGENT` (stays `'off'`).
- [ ] `createQAAgent('xhigh')` stamps the level; `createQAAgent` requires the arg (a `@ts-expect-error` test on the bare call).
- [ ] commit-message-agent.test.ts assertion updated to `toHaveBeenCalledWith('researcher', 'research', 'off')`.
- [ ] 3 targeted vitest files GREEN; `npm run typecheck` clears the 6 S1 sites (only S3's createQAAgent call sites may remain TS2554); lint + format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
before/after of all 6 edits, the exact getter names/defaults/env-vars (T1.S2, Complete), the exact import
line to extend, the S1 contract (required `thinking` param — read as TRUTH), the JSDoc lines to update
(grep-gated, scoped to factory blocks), the key test decision (delegating `createAgent` spy to capture
config without breaking existing tests — copy-ready), the exact assertions for all 3 test files, and the
expected typecheck picture (S1's 6 sites cleared; S3's createQAAgent sites deliberately left) are all below.

### Documentation & References
```yaml
# MUST READ — copy-ready edits + the delegating-spy test decision + the typecheck picture
- docfile: plan/013_3f31aa2b81b7/P1M1T3S2/research/factory-reasoning-wiring.md
  section: "2. The 6 edits", "4. Test strategy — the KEY decision", "6. The expected typecheck picture after S2"
  why: The exact before/after for every edit, the 3-getter import extension, why the spy must DELEGATE (not
        stub) to keep existing green tests, copy-ready assertions for all 3 test files, and the S3-breakage framing.
  critical: cleanup + commit-message hardcode 'off' as a LITERAL (not getReasoningImpl()); createQAAgent takes a
        param (no getter call inside the factory).

# MUST READ — the architecture spec for this exact task (S2 = §C factories + §D commit-message-agent)
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "C. src/agents/agent-factory.ts" → "Factory wiring (each calls its getter)", "D. commit-message-agent.ts:361"
  why: Pins every wiring target + the createQAAgent signature change + the cleanup 'off' decision.
  critical: §C's createBaseConfig/ROLE_CONFIG/ThinkingLevel edits are S1 (parallel). §E's createQAAgent call sites are S3.

# PREDECESSOR (read as a CONTRACT) — what S1 produces (the required `thinking` param + the 6 breakage sites)
- docfile: plan/013_3f31aa2b81b7/P1M1T3S1/PRP.md
  section: "Goal" / "What → Technical requirements" / "Integration Points → DOWNSTREAM CONSUMERS"
  why: S1's createBaseConfig(persona, role='research', thinking: ThinkingLevel) is the signature S2 calls.
        S1 deliberately leaves the 6 src call sites as TS2554 — S2 closes them.
  critical: Do NOT re-edit createBaseConfig/ROLE_CONFIG/ThinkingLevel (S1's region). After S1 lands those are correct.

# INPUT — the 5 getters (T1.S2, Complete) — names, env vars, defaults
- file: src/config/constants.ts
  section: getReasoningBreakdown (:1709, default high), getReasoningAgent (:1681, high), getReasoningImpl (:1794, off),
           getReasoningBugFinder (:1737, high), getReasoningValidation (:1765, high)
  why: S2 consumes the first 3 in the factories; the last 2 are passed at createQAAgent call sites (S3). All are pure
        process.env reads at call time (resolveReasoningLevel, :1643) — tests set env via vi.stubEnv.
  gotcha: createQAAgent does NOT call a getter — it receives the level as a param. Import only 3 getters into agent-factory.ts.

# EDIT TARGET — the factories being wired
- file: src/agents/agent-factory.ts
  section: import L34; createArchitectAgent body (~L348); createResearcherAgent (~L384); createCoderAgent (~L416);
           createQAAgent signature+body (~L453); createCleanupAgent body (~L498); each factory's @remarks block
  why: Each createBaseConfig(...) call gains its 3rd arg; createQAAgent gains the required param; JSDoc updated.
  pattern: existing factory structure (spread baseConfig + override system/mcps) — only the createBaseConfig arg changes.
  gotcha: Locate each createBaseConfig call by grep, not line number (S1 shifts lines). Do NOT touch createBaseConfig/
          ROLE_CONFIG/ThinkingLevel definitions or their JSDoc.

# EDIT TARGET — commit-message-agent caller
- file: src/agents/commit-message-agent.ts
  section: L361 (`const baseConfig = createBaseConfig('researcher', 'research');`) + the factory JSDoc above it
  why: Add the literal 'off' 3rd arg + a JSDoc sentence. (NOTE: this file also has the commit-style builder from
        plan 012's work — unrelated; only the createBaseConfig call + its JSDoc are S2's edit.)
  gotcha: Leave the systemPrompt? param + buildCommitMessageSystemPrompt logic UNCHANGED.

# TEST FILES being extended
- file: tests/unit/agents/agent-factory.test.ts
  section: top (add delegating createAgent spy via vi.mock); 'agent creation functions' describe (update the 2
           createQAAgent() calls at ~L326 + ~L349 to pass a level); NEW describe('factory reasoning wiring')
  why: The spy captures config.thinking for architect/researcher/coder/QA; the new describe proves defaults + overrides + decoupling.
  gotcha: vi.mock must DELEGATE to real createAgent (preserve .name tests + MCP-regression test), NOT stub. S1 owns the
          createBaseConfig + 'model roles & reasoning budget' describes — leave them.
- file: tests/unit/agents/commit-message-agent.test.ts
  section: the toHaveBeenCalledWith('researcher', 'research') assertion (~L55) → add 'off'
  why: The factory now calls createBaseConfig('researcher', 'research', 'off'); the mock-module test asserts the call args.
  gotcha: This file mocks the WHOLE agent-factory.js module — do not change the fixture, only the assertion arity.
- file: tests/unit/agents/cleanup-agent.test.ts
  section: already mocks groundswell.createAgent to capture cfg — ADD one it() asserting thinking==='off' (hardcoded)
  why: Proves cleanup is NOT coupled to PRP_REASONING_IMPL_AGENT.
  gotcha: Add afterEach(() => vi.unstubAllEnvs()) for the stubbed env, or ensure vi.stubEnv auto-restores.

# CONSUMERS (downstream — do NOT implement here)
- file: src/agents/agent-factory.ts   # createQAAgent signature — S3 wires the call sites
- file: src/workflows/bug-hunt-workflow.ts:273, validation-workflow.ts:235, delta-analysis-workflow.ts:121,
       src/core/change-classifier.ts:112 + :161   # S3: createQAAgent(getReasoning*())
```

### Current Codebase tree (edit surface)

```bash
src/agents/agent-factory.ts            # EDIT: import (L34) + 5 factory bodies + createQAAgent signature + factory JSDoc
  ├─ import { getBugFinderAgent, type ReasoningLevel } (L34)   # EDIT: + getReasoningAgent/Breakdown/Impl
  ├─ [S1 region: createBaseConfig / ROLE_CONFIG / ThinkingLevel + their JSDoc]  # UNCHANGED (parallel S1)
  ├─ createArchitectAgent body (~L348)  # EDIT: + getReasoningBreakdown()
  ├─ createResearcherAgent body (~L384) # EDIT: + getReasoningAgent()
  ├─ createCoderAgent body (~L416)      # EDIT: + getReasoningImpl()
  ├─ createQAAgent (~L453)              # EDIT: signature + reasoningLevel param; + reasoningLevel arg
  └─ createCleanupAgent body (~L498)    # EDIT: + 'off' (literal)
src/agents/commit-message-agent.ts     # EDIT: L361 + 'off' (literal) + JSDoc sentence
src/config/constants.ts                # READ-ONLY (5 getters + ReasoningLevel — T1.S1/S2, Complete)
tests/unit/agents/agent-factory.test.ts        # EDIT: delegating spy + update 2 createQAAgent() + new describe
tests/unit/agents/commit-message-agent.test.ts # EDIT: assertion + 'off'
tests/unit/agents/cleanup-agent.test.ts        # EDIT: + thinking==='off' assertion
```

### Desired Codebase tree with files to be changed
```bash
src/agents/agent-factory.ts            # EDIT — import + 5 factories + createQAAgent signature + JSDoc
src/agents/commit-message-agent.ts     # EDIT — createBaseConfig 'off' arg + JSDoc
tests/unit/agents/agent-factory.test.ts        # EDIT — spy + createQAAgent() updates + new wiring describe
tests/unit/agents/commit-message-agent.test.ts # EDIT — assertion arity
tests/unit/agents/cleanup-agent.test.ts        # EDIT — + off-hardcode assertion
# (no new files; the createQAAgent production call sites are S3's scope — left as expected TS2554)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (scope): S2 edits the 5 FACTORIES + commit-message-agent.ts:361 + their JSDoc + the 3 test files.
//   Do NOT touch createBaseConfig/ROLE_CONFIG/ThinkingLevel definitions or their JSDoc (S1's region, parallel).

// CRITICAL (cleanup/commit-message hardcode 'off'): pass the STRING LITERAL 'off', NOT getReasoningImpl().
//   Coupling to the impl getter would let PRP_REASONING_IMPL_AGENT=high accidentally turn reasoning on for
//   mechanical single-shot operations. Document the decision in the JSDoc.

// CRITICAL (createQAAgent takes a param, not a getter): the factory body is createBaseConfig('qa','reasoning',
//   reasoningLevel) — it RECEIVES the level. Do NOT call getReasoningBugFinder()/getReasoningValidation() inside
//   the factory. The bug-finder/validation split is the CALLER's job (S3). So agent-factory.ts imports only 3
//   getters (breakdown/agent/impl), not validation/bugfinder.

// GOTCHA (delegating spy, not stub): in agent-factory.test.ts, vi.mock('groundswell') must call the REAL
//   createAgent (`vi.fn((cfg) => actual.createAgent(cfg))`), so existing agent.name === 'ArchitectAgent' tests
//   AND the MCP-registration regression test stay GREEN. A capture-only stub (cfg => ({__cfg:cfg})) would break them.

// GOTCHA (createQAAgent signature breaks ~5 production call sites — by design): after S2, src/workflows/* and
//   change-classifier.ts still call createQAAgent() with no args → TS2554. That is S3's scope; do NOT "fix" them.
//   (Analogous to S1 leaving 6 sites broken for S2.) The test-file createQAAgent() calls ARE in S2's scope — update them.

// GOTCHA (locate by grep, not line number): S1 (parallel) shifts line numbers. Grep for each `createBaseConfig('…', '…')`
//   inside the factory functions and for `export function createQAAgent`. Do not trust hardcoded line numbers.

// GOTCHA (getter is a pure env read): getReasoning*() reads process.env at CALL time (resolveReasoningLevel, no caching).
//   So vi.stubEnv('PRP_REASONING_BREAKDOWN_AGENT','xhigh') BEFORE calling the factory changes config.thinking.
//   Clear with the file's existing afterEach(() => vi.unstubAllEnvs()) (or add one in cleanup-agent.test.ts).

// GOTCHA (ThinkingLevel === ReasoningLevel): T1.S3 aliased them. createBaseConfig's param is ThinkingLevel; passing a
//   getReasoning*() result (ReasoningLevel) is type-compatible. createQAAgent's param is ReasoningLevel (per spec).

// GOTCHA (test reads latest cfg): use mockCreateAgent.mock.calls.at(-1)![0] in the new describe — existing factory
//   tests also populate .mock.calls. Do NOT call mockClear() on the shared spy (would interfere with sibling tests).
```

## Implementation Blueprint

### Data models and structure
No new data models. `ReasoningLevel` (the createQAAgent param type) and the 5 getters already exist (T1.S2).
`ThinkingLevel === ReasoningLevel` (T1.S3). The factories' config shape is unchanged; only the `thinking`
SOURCE changes (from hardcoded/ROLE_CONFIG in S0 → caller-resolved in S2).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/agents/agent-factory.ts — import + 5 factory wirings + createQAAgent signature + JSDoc
  - (a) IMPORT (L34): add getReasoningAgent, getReasoningBreakdown, getReasoningImpl to the constants import
        (keep getBugFinderAgent + type ReasoningLevel). COPY-READY in research §2a.
  - (b) WIRE the 4 non-QA factories — each createBaseConfig(...) gains its 3rd arg:
        architect→getReasoningBreakdown(); researcher→getReasoningAgent(); coder→getReasoningImpl();
        cleanup→'off' (LITERAL). COPY-READY table in research §2b.
  - (c) createQAAgent: signature `export function createQAAgent(reasoningLevel: ReasoningLevel): Agent`;
        body `createBaseConfig('qa', 'reasoning', reasoningLevel)`. Keep the logger().debug({…bugFinderAgent…})
        line UNCHANGED. Update the @example to `createQAAgent(getReasoningValidation())`.
  - (d) JSDoc (Mode A): update the 5 FACTORY @remarks blocks (research §3). REWRITE createQAAgent's JSDoc
        (remove 'xhigh'/'--thinking xhigh'/'stays balanced @xhigh'; new "level resolved by caller per §9.2.9").
  - (e) Grep-gate: `grep -nE "xhigh|normal reasoning budget" src/agents/agent-factory.ts` — the ONLY remaining
        mentions must be inside createBaseConfig/ROLE_CONFIG/ThinkingLevel (S1's region). Any inside a factory
        @remarks block must be updated.
  - DO NOT: touch createBaseConfig/ROLE_CONFIG/ThinkingLevel definitions or their JSDoc, getModel, ModelRole,
        PERSONA_TOKEN_LIMITS, STATELESS_PERSONAS, MCP_TOOLS, or the createQAAgent production call sites (S3).

Task 2: EDIT src/agents/commit-message-agent.ts — createBaseConfig 'off' arg + JSDoc
  - L361: `createBaseConfig('researcher', 'research')` → `createBaseConfig('researcher', 'research', 'off')`
        with an inline comment `// single-shot commit messages (§9.2.9)`.
  - JSDoc: add a sentence documenting thinking:'off' is hardcoded (not coupled to PRP_REASONING_IMPL_AGENT).
  - DO NOT: change the systemPrompt? param, buildCommitMessageSystemPrompt, or any other field.

Task 3: EDIT tests/unit/agents/agent-factory.test.ts — delegating spy + createQAAgent updates + new describe
  - (a) ADD (top of file, hoisted): vi.mock('groundswell', async importOriginal => { const actual = await
        importOriginal(); return { ...actual, createAgent: vi.fn((cfg) => actual.createAgent(cfg)) }; });
        + `import { createAgent } from 'groundswell'; const mockCreateAgent = vi.mocked(createAgent);`
        COPY-READY in research §4. DELEGATE (do not stub) so existing .name + MCP-regression tests stay green.
  - (b) UPDATE the 2 existing createQAAgent() calls: ~L326 (MCP-regression test) + ~L349 ("should create QA
        agent successfully") → createQAAgent('high'). (The signature now requires an arg.)
  - (c) ADD describe('factory reasoning wiring (PRD §9.2.9 / P1.M1.T3.S2)') with it() cases (research §4):
        architect default 'high' + model balanced; architect honors PRP_REASONING_BREAKDOWN_AGENT override;
        researcher default 'high' + honors PRP_REASONING_AGENT; coder default 'off' + honors PRP_REASONING_IMPL_AGENT
        AND model stays 'zai/glm-5-turbo' (decoupling); cleanup HARDCODED 'off' — PRP_REASONING_IMPL_AGENT=high
        does NOT change it; createQAAgent('xhigh') stamps the level + model balanced; createQAAgent requires the
        arg (@ts-expect-error on a bare createQAAgent() call). Read cfg via mockCreateAgent.mock.calls.at(-1)![0].
  - DO NOT: edit the createBaseConfig describe or the 'model roles & reasoning budget' describe (S1's scope).
  - PRESERVE: all existing tests GREEN.

Task 4: EDIT tests/unit/agents/commit-message-agent.test.ts — assertion arity
  - Update `toHaveBeenCalledWith('researcher', 'research')` (~L55) → `toHaveBeenCalledWith('researcher',
    'research', 'off')`. (The factory now passes the literal 'off'.)
  - DO NOT: change the mock fixture or any other assertion.

Task 5: EDIT tests/unit/agents/cleanup-agent.test.ts — off-hardcode assertion
  - ADD afterEach(() => vi.unstubAllEnvs()) (hygiene — the file currently has none) + an it():
        vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high'); mockCreateAgent.mockClear(); createCleanupAgent();
        cfg = mockCreateAgent.mock.calls[0][0]; expect(cfg.thinking).toBe('off'); expect(cfg.model).toBe('zai/glm-5-turbo').
  - Proves cleanup is NOT coupled to PRP_REASONING_IMPL_AGENT. COPY-READY in research §5.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the 6 wiring edits (research §2b)
// architect/researcher/coder — pass their getter:
const baseConfig = createBaseConfig('architect', 'reasoning', getReasoningBreakdown());
const baseConfig = createBaseConfig('researcher', 'research', getReasoningAgent());
const baseConfig = createBaseConfig('coder', 'implementation', getReasoningImpl());
// cleanup + commit-message — LITERAL 'off' (not the getter — immune to PRP_REASONING_IMPL_AGENT):
const baseConfig = createBaseConfig('cleanup', 'implementation', 'off');
const baseConfig = createBaseConfig('researcher', 'research', 'off'); // commit-message-agent.ts:361
// QA — caller supplies the level:
export function createQAAgent(reasoningLevel: ReasoningLevel): Agent {
  const baseConfig = createBaseConfig('qa', 'reasoning', reasoningLevel);
  // ... system/mcps/logger UNCHANGED ...
}

// PATTERN: the delegating createAgent spy in agent-factory.test.ts (research §4) — capture cfg + keep real agent
vi.mock('groundswell', async importOriginal => {
  const actual = await importOriginal<typeof import('groundswell')>();
  return { ...actual, createAgent: vi.fn((cfg: unknown) => actual.createAgent(cfg)) }; // delegate, don't stub
});
import { createAgent } from 'groundswell';
const mockCreateAgent = vi.mocked(createAgent);
// … new describe reads mockCreateAgent.mock.calls.at(-1)![0].thinking; existing agent.name tests still pass (real agent).

// PATTERN: the decoupling proof — coder honors PRP_REASONING_IMPL_AGENT but model tier is unchanged
it('createCoderAgent: impl reasoning on + fast-tier model (decoupling)', () => {
  vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high');
  createCoderAgent();
  const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string; model: string };
  expect(cfg.thinking).toBe('high');          // honors its own getter
  expect(cfg.model).toBe('zai/glm-5-turbo');  // …but the MODEL tier is unchanged — the two axes are independent
});

// GOTCHA (above): cleanup's 'off' is a LITERAL — setting PRP_REASONING_IMPL_AGENT must NOT change it.
// GOTCHA (above): createQAAgent does NOT call a getter — only 3 getters imported into agent-factory.ts.
```

### Integration Points
```yaml
IMPORTS (src/agents/agent-factory.ts):
  - extend L34: "+ getReasoningAgent, getReasoningBreakdown, getReasoningImpl" (keep getBugFinderAgent + type ReasoningLevel)

SIGNATURES (src/agents/agent-factory.ts):
  - createQAAgent: (reasoningLevel: ReasoningLevel): Agent   # NEW required param (was ())

DOWNSTREAM CONSUMERS (NOT this task — S3 wires them; S2 leaves them as expected TS2554):
  - S3: src/workflows/bug-hunt-workflow.ts:273 → createQAAgent(getReasoningBugFinder())
  - S3: src/workflows/validation-workflow.ts:235 → createQAAgent(getReasoningValidation())
  - S3: src/workflows/delta-analysis-workflow.ts:121 → createQAAgent(getReasoningAgent())
  - S3: src/core/change-classifier.ts:112 + :161 → createQAAgent(getReasoningAgent())

NONE OF: createBaseConfig/ROLE_CONFIG/ThinkingLevel + their JSDoc (S1), getModel/ModelRole/PERSONA_TOKEN_LIMITS/
         STATELESS_PERSONAS/MCP_TOOLS, commit-message-agent's systemPrompt?/builder, PRD.md, spec/**, tasks.json,
         prd_snapshot.md, src/config/hack-config.ts (T2.S2).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run lint             # eslint . --ext .ts — clean (eslint is not type-aware, so the createQAAgent call-site arity errors don't trip it)
npm run format:check     # prettier --check — clean (run `npm run format` if it flags)
# Expected: zero errors on the edited files.
```

### Level 2: Unit Tests (the PRIMARY runtime gate)
```bash
npx vitest run tests/unit/agents/agent-factory.test.ts tests/unit/agents/commit-message-agent.test.ts tests/unit/agents/cleanup-agent.test.ts
# EXPECTED: GREEN. The new 'factory reasoning wiring' describe passes (each factory's thinking default + override +
#   decoupling); createQAAgent('xhigh') stamps the level; cleanup stays 'off' under PRP_REASONING_IMPL_AGENT=high;
#   commit-message's toHaveBeenCalledWith includes 'off'. The existing factory tests (agent.name, MCP-regression)
#   stay GREEN because the spy DELEGATES to real createAgent.
# If a factory test asserts the wrong thinking, confirm the getter default (high/high/high/off) and that you
#   read mockCreateAgent.mock.calls.at(-1) (not a fixed index). If agent.name tests break, the spy stubbed instead of delegated.
```

### Level 3: The Typecheck Gate (S1 sites CLEARED; S3 sites deliberately TS2554)
```bash
npm run typecheck 2>&1 | grep "error TS2554"
# EXPECTED: the 6 S1 errors (createBaseConfig arity at the 5 factories + commit-message-agent:361) are GONE —
#   S2 wired them. Any REMAINING TS2554 must be ONLY the createQAAgent production call sites (~5):
#   src/workflows/bug-hunt-workflow.ts, validation-workflow.ts, delta-analysis-workflow.ts, src/core/change-classifier.ts.
# Confirm the S1 sites are cleared:
npm run typecheck 2>&1 | grep -E "agent-factory\.ts|commit-message-agent\.ts" | grep "TS2554" || echo "OK: S1 sites wired (no arity errors in these files)"
# EXPECTED: "OK: S1 sites wired" (the createQAAgent SIGNATURE change is in agent-factory.ts but is correct — only the
#   CALL SITES in workflows/change-classifier error, which is S3's scope).
# CRITICAL: do NOT "fix" the createQAAgent() call sites in src/workflows/* or change-classifier.ts — that is S3.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual decoupling proof (no agent call) — print model + thinking for cross-axis factory combos.
npx tsx -e "process.env.PRP_REASONING_IMPL_AGENT='high'; import('./src/agents/agent-factory.js').then(({createCoderAgent}) => { const a = createCoderAgent(); console.log('coder (impl=high):', JSON.stringify({name:(a as any).name})); });"
# (The real agent object may not expose thinking/model — the authoritative proof is the Level 2 unit test, which
#   reads the captured config. This smoke-check just confirms the factory runs without throwing under an env override.)
# Grep-gate the JSDoc: no stray xhigh remains in factory @remarks blocks.
grep -nE "xhigh|normal reasoning budget" src/agents/agent-factory.ts
# EXPECTED: remaining mentions are ONLY inside createBaseConfig/ROLE_CONFIG/ThinkingLevel (S1's region). If any appear
#   inside createArchitectAgent/createResearcherAgent/createCoderAgent/createQAAgent/createCleanupAgent @remarks, fix them.
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 lint + format:check clean on the edited files.
- [ ] Level 2: 3 targeted vitest files GREEN (new wiring describe + existing tests).
- [ ] Level 3: the 6 S1 TS2554 sites are CLEARED; only S3's createQAAgent call sites may remain TS2554.
- [ ] Level 4: grep-gate confirms no stray xhigh in factory @remarks blocks.

### Feature Validation
- [ ] Each factory's `config.thinking` equals its getter default (architect/researcher → high; coder → off) with env unset.
- [ ] Each factory honors its env override (PRP_REASONING_BREAKDOWN_AGENT/AGENT/IMPL_AGENT).
- [ ] Decoupling proven: coder with PRP_REASONING_IMPL_AGENT=high → thinking 'high' + model 'zai/glm-5-turbo'.
- [ ] createCleanupAgent + commit-message-agent hardcode 'off' (literal) — NOT coupled to PRP_REASONING_IMPL_AGENT.
- [ ] createQAAgent(reasoningLevel) stamps the passed level; requires the arg.
- [ ] config.model stays the tier's model for every factory regardless of thinking (decoupling holds).

### Code Quality Validation
- [ ] Delegating createAgent spy (not a stub) — existing agent.name + MCP-regression tests stay GREEN.
- [ ] Only 3 getters imported into agent-factory.ts (breakdown/agent/impl); createQAAgent takes a param.
- [ ] cleanup/commit-message 'off' is a LITERAL with a documented decision.
- [ ] JSDoc (Mode A) on each factory documents its reasoning knob + default; createQAAgent JSDoc rewritten.
- [ ] createBaseConfig/ROLE_CONFIG/ThinkingLevel region UNCHANGED (S1's scope).

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M2 owns changeset docs — separate milestone).
- [ ] No env-var additions (the PRP_REASONING_* getters already exist from T1.S2).

---

## Anti-Patterns to Avoid
- ❌ Don't couple cleanup/commit-message to `getReasoningImpl()` — hardcode the `'off'` literal so `PRP_REASONING_IMPL_AGENT=high` can't accidentally turn their reasoning on.
- ❌ Don't call a getter inside `createQAAgent` — it RECEIVES the level as a param. The bug-finder/validation split is the caller's job (S3).
- ❌ Don't stub `createAgent` (capture-only) in agent-factory.test.ts — it breaks the existing `agent.name` tests and hollows the MCP-regression test. DELEGATE to the real impl.
- ❌ Don't "fix" the createQAAgent production call sites in src/workflows/* or change-classifier.ts — that is S3's scope; the TS2554 there is the expected hand-off (like S1→S2).
- ❌ Don't touch createBaseConfig/ROLE_CONFIG/ThinkingLevel definitions or their JSDoc — S1 owns that region (parallel).
- ❌ Don't import getReasoningValidation/getReasoningBugFinder into agent-factory.ts — they're consumed at the createQAAgent call sites in S3, not in the factory.
- ❌ Don't trust line numbers — S1 (parallel) shifts them. Grep for each `createBaseConfig('…', '…')` and `export function createQAAgent`.
- ❌ Don't edit the createBaseConfig or 'model roles & reasoning budget' describes in agent-factory.test.ts — S1 adapts those.
- ❌ Don't leave a bare `createQAAgent()` in the test file (L326/L349) — update both to pass a level, or they'll run with reasoningLevel=undefined (esbuild strips types, so it won't crash vitest, but it's semantically wrong and the `@ts-expect-error` test would also misbehave).
- ❌ Don't run the full TS test suite and treat the expected S3 createQAAgent TS2554 errors (or unrelated pre-existing diagnostics) as this task's failure — run the 3 targeted vitest files (Level 2) + the bounded typecheck check (Level 3).

---

## Confidence Score
**8.5 / 10** — one-pass success. The 6 wiring edits are mechanical and unambiguous; the getter contract
(T1.S2) and S1's required-`thinking` signature are fixed inputs. The main residual risk is the delegating
`createAgent` spy in agent-factory.test.ts interacting with Groundswell's real `createAgent` across many
calls — mitigated by delegating (existing tests already exercise real createAgent) and by the grep/typecheck
gates that catch a forgotten wiring or a stray xhigh JSDoc. The createQAAgent signature change produces
expected S3-breakage at production call sites (by design, mirroring S1→S2).