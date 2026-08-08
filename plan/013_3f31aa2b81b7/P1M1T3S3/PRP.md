# PRP — P1.M1.T3.S3: Update the `createQAAgent` call sites to pass their resolved reasoning level

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) + §9.2.3 (Model Selection). This is the **call-site
> half** of the QA reasoning split. **S1** severed model↔reasoning coupling in `createBaseConfig`;
> **S2** wired the 5 agent factories and changed `createQAAgent` to `createQAAgent(reasoningLevel)`,
> deliberately leaving the **5 production call sites** as TS2554 (the S3 hand-off, mirroring S1→S2).
> **S3 (THIS task) closes them**: each caller resolves its OWN reasoning getter and passes it, so the
> bug-finder and validation QA agents run at **independently-configurable** reasoning levels — the core
> §9.2.9 requirement. Architecture spec: `plan/013_3f31aa2b81b7/architecture/integration-points.md §E`.

---

## Goal

**Feature Goal**: In the **4 files / 5 call sites** that invoke `createQAAgent()`, pass the caller's
resolved per-role reasoning level as the (now-required) `reasoningLevel` argument, and extend the unit
tests to prove each caller threads its OWN level — with bug-finder and validation shown to resolve
**independent** levels.

- `src/workflows/bug-hunt-workflow.ts:273` → `createQAAgent(getReasoningBugFinder())` (bug-finder's own level)
- `src/workflows/validation-workflow.ts:235` → `createQAAgent(getReasoningValidation())` (validation's own level)
- `src/workflows/delta-analysis-workflow.ts:121` → `createQAAgent(getReasoningAgent())` (research-leaning, documented)
- `src/core/change-classifier.ts:112` (`classifyChange`) → `createQAAgent(getReasoningAgent())` (research-leaning, documented)
- `src/core/change-classifier.ts:161` (`classifyArtifact`) → `createQAAgent(getReasoningAgent())` (research-leaning, documented)

Each of the 4 files adds the relevant getter to its `import … from '../config/constants.js'`. A brief
inline comment at the **3 research-leaning sites** (delta-analysis + both change-classifier calls) records
the decision + §9.2.9 ref.

**Deliverable**:
1. **5 call-site edits** across `src/workflows/{bug-hunt-workflow,validation-workflow,delta-analysis-workflow}.ts`
   and `src/core/change-classifier.ts` (2 calls) — each `createQAAgent()` → `createQAAgent(getReasoning*())`.
2. **4 import edits** — each file's `../config/constants.js` named-import gains its getter
   (`getReasoningBugFinder` / `getReasoningValidation` / `getReasoningAgent`); delta-analysis adds a NEW
   import statement (it has none today).
3. **3 research-leaning inline comments** (delta-analysis L121; change-classifier L112 + L161).
4. **4 test-file extensions** — `tests/unit/workflows/{bug-hunt,validation,delta-analysis}-workflow.test.ts`
   + `tests/unit/core/change-classifier.test.ts` — new `it()` cases asserting `createQAAgent` receives the
   resolved level (default + override), including the bug-finder-vs-validation **independence** proof.
5. **1 mock conversion** — `validation-workflow.test.ts` constants.js mock → `importOriginal` spread so
   `getReasoningValidation` is REAL (required: the whole-module mock would otherwise make it `undefined`).

**Success Definition**:
- `createQAAgent` is invoked with a resolved level at all 5 sites; no bare `createQAAgent()` call remains
  in `src/` (grep-gated — only JSDoc/doc-example mentions may remain).
- **Independence proof:** with `PRP_REASONING_BUG_FINDER_AGENT=xhigh` + `PRP_REASONING_VALIDATION_AGENT=low`
  set together, bug-hunt's `createQAAgent` receives `'xhigh'` and validation's receives `'low'` — each
  workflow reads ONLY its own knob (two new `it()` cases, one per file).
- The 3 research-leaning sites receive `getReasoningAgent()`'s value; an override of
  `PRP_REASONING_AGENT` flows to them (tested in delta-analysis + change-classifier).
- `npm run typecheck` is **fully clean** — the 5 S2-left TS2554 errors are GONE (this is the end-to-end
  "QA split complete" signal; S3 touches no factory/base-config region).
- `npx vitest run` of the 4 targeted files is GREEN (existing tests untouched + new cases pass); `npm run
  lint` + `npm run format:check` clean.

## User Persona

N/A — internal pipeline wiring. Indirect "users" are pipeline operators who, once S3 lands (with the rest
of P1.M1), gain the §9.2.9 guarantee: each QA role's reasoning budget is an independent axis, configurable
via `PRP_REASONING_BUG_FINDER_AGENT` / `PRP_REASONING_VALIDATION_AGENT` without touching the model tier or
any other role's level.

## Why

- **Realizes the core §9.2.9 requirement at the call sites.** S2 split the QA identity at the FACTORY
  (`createQAAgent(reasoningLevel)` — caller supplies the level); S3 makes each caller actually supply its
  OWN level. Until S3, both bug-hunt and validation would (once S2's required arg is satisfied) pass the
  same value, defeating the "independent" guarantee. S3 is where the independence becomes real.
- **bug-finder vs validation are genuinely different workloads.** Bug-finding is adversarial analysis;
  validation checks against the full PRD. A user may want `xhigh` for one and `medium` for the other.
  S3 wires each to its dedicated getter (`getReasoningBugFinder` / `getReasoningValidation`), so the two
  never share a knob.
- **delta-analysis + change-classifier are research-leaning by design (documented decision).** They are
  diff/artifact *analysis* tasks, not bug-finding or validation. PRD §3 names the first three callers; the
  researchleaning 4th/5th (change-classifier) was discovered during integration research. Routing them to
  `getReasoningAgent()` (the research/PRP level) is an implementation decision, recorded inline per §9.2.9
  so a future maintainer sees WHY they don't use a bug-finder/validation level.
- **Closes the QA-split story.** With S1 (decouple) + S2 (factories) + S3 (call sites), every agent role
  composes its model (tier) and reasoning (level) independently, end-to-end, with no hard-wired `xhigh`.

## What

### User-visible behavior
None directly. Indirectly (with the rest of P1.M1): each QA role's extended-thinking budget is
independently configurable and decoupled from its model tier; bug-finder and validation each honor their
own `PRP_REASONING_*` var.

### Technical requirements (exact contract)

**Call-site edits** (5 total — research §3 has the copy-ready snippets):

| File:line | AFTER |
| --------- | ----- |
| `bug-hunt-workflow.ts:273` | `const qaAgent = createQAAgent(getReasoningBugFinder());` (bug-finder's own level) |
| `validation-workflow.ts:235` | `const agent = createQAAgent(getReasoningValidation());` (validation's own level) |
| `delta-analysis-workflow.ts:121` | `const qaAgent = createQAAgent(getReasoningAgent());` + research-leaning comment |
| `change-classifier.ts:112` | `const agent: Agent = createQAAgent(getReasoningAgent());` + research-leaning comment |
| `change-classifier.ts:161` | `const agent: Agent = createQAAgent(getReasoningAgent());` + research-leaning comment |

**Import edits** (4 — research §2 table):
- `bug-hunt-workflow.ts:39` → `import { getBugFinderAgent, getReasoningBugFinder } from '../config/constants.js';`
- `validation-workflow.ts:51-54` → add `getReasoningValidation` to the existing `getValidationAgent, getValidationTimeoutSeconds` named import.
- `delta-analysis-workflow.ts` (after the agent-factory import ~L24) → ADD `import { getReasoningAgent } from '../config/constants.js';`
- `change-classifier.ts:48` → `import { getClassifierRetryMax, getReasoningAgent } from '../config/constants.js';`

**Research-leaning comments** — at delta-analysis L121 and change-classifier L112 + L161, a brief inline
comment: "RESEARCH-LEANING (PRD §9.2.9): this is an analysis task (not bug-finding/validation), so it
reuses the AGENT (research) reasoning level via getReasoningAgent()." (Copy-ready text in research §3.)

**Test extensions** (research §4–§5):
- `bug-hunt-workflow.test.ts` + `validation-workflow.test.ts`: new `describe('createQAAgent reasoning
  wiring (PRD §9.2.9 / P1.M1.T3.S3)')` with (a) default-level case and (b) **independence** case (both
  role-vars set to distinct values; assert each workflow's `createQAAgent` got ONLY its own).
- `delta-analysis-workflow.test.ts` + `change-classifier.test.ts`: new `it()` asserting the
  research-leaning caller threads `getReasoningAgent()`'s level (default + a `PRP_REASONING_AGENT` override).
- All 4 files: add `afterEach(() => vi.unstubAllEnvs())` wherever `vi.stubEnv` is newly used (NONE of the
  files define it today; vitest does NOT auto-restore env stubs here).
- `validation-workflow.test.ts`: **convert** the constants.js mock to the `importOriginal` spread form
  (research §4b) so `getReasoningValidation` is the REAL getter — the whole-module mock would otherwise
  make it `undefined` and break every `generateScript` test.

### Success Criteria
- [ ] All 5 call sites pass a resolved getter; no bare `createQAAgent()` remains in `src/` (grep: only
      JSDoc/doc-example mentions allowed).
- [ ] Each of the 4 files imports its getter from `../config/constants.js`.
- [ ] 3 research-leaning inline comments present (delta-analysis L121; change-classifier L112 + L161).
- [ ] New bug-hunt + validation tests prove **independence**: each reads ONLY its own role var.
- [ ] New delta-analysis + change-classifier tests prove the research-leaning caller threads
      `getReasoningAgent()` (honors a `PRP_REASONING_AGENT` override).
- [ ] `validation-workflow.test.ts` constants mock converted to `importOriginal` (existing `getValidationAgent`/
      `getValidationTimeoutSeconds` fakes preserved → their assertions stay GREEN).
- [ ] `npm run typecheck` fully clean (0 TS2554); 4 targeted vitest files GREEN; lint + format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
before/after of all 5 call sites, the exact 4 import edits (incl. delta-analysis needing a NEW import),
the exact getter names + env-var names + defaults (T1.S2, Complete — verified in `src/config/constants.ts`),
the S2 contract (`createQAAgent(reasoningLevel: ReasoningLevel)` — read as TRUTH, S2 is in flight), the
copy-ready test code for all 4 files (incl. the validation-workflow mock-conversion GOTCHA — the one real
trap), the env-determinism finding (`.env` is clean → defaults safe; stub explicitly + add
`afterEach(unstubAllEnvs)` for robustness), and the typecheck gate (S3 clears the last 5 TS2554) are all below.

### Documentation & References
```yaml
# MUST READ — copy-ready call-site edits + import table + the per-file test strategy + the validation-mock GOTCHA
- docfile: plan/013_3f31aa2b81b7/P1M1T3S3/research/call-sites-and-tests.md
  section: "1. Inventory", "2. Import edits", "3. call-site edits", "4. Test strategy", "5. independence test"
  why: The exact before/after for every edit, which files mock constants.js (and the importOriginal fix),
        copy-ready assertions for all 4 test files, the env-determinism + afterEach hygiene finding.
  critical: validation-workflow.test.ts MOCKS constants.js whole-module → MUST convert to importOriginal or
        getReasoningValidation is undefined and every generateScript test breaks. The other 3 files do NOT
        mock constants.js → real getters run; just vi.stubEnv + afterEach(unstubAllEnvs).

# MUST READ — the architecture spec for this exact task (S3 = §E)
- docfile: plan/013_3f31aa2b81b7/architecture/integration-points.md
  section: "E. The four createQAAgent call sites — pass resolved getter"
  why: Pins every call-site target + the research-leaning designation for delta-analysis/change-classifier.
  critical: §D (commit-message-agent) + §C (factories) are S2; §F/§G/§H are other tasks. S3 owns ONLY §E.

# PREDECESSOR (read as a CONTRACT) — what S2 produces (the required-param signature + the deliberate breakage)
- docfile: plan/013_3f31aa2b81b7/P1M1T3S2/PRP.md
  section: "Goal" / "Integration Points → DOWNSTREAM CONSUMERS"
  why: S2 changes createQAAgent to (reasoningLevel: ReasoningLevel): Agent and DELIBERATELY leaves the 5
        production call sites as TS2554 — S3 closes them. The "DOWNSTREAM CONSUMERS" block lists exactly
        the 4 files / 5 lines S3 must edit.
  critical: Do NOT re-edit agent-factory.ts / createBaseConfig / ROLE_CONFIG (S1+S2 regions). After S2 lands
        the signature is final; S3 only supplies the now-required argument at each call site.

# INPUT — the 5 getters (T1.S2, Complete) — names, env vars, defaults (VERIFIED in source)
- file: src/config/constants.ts
  section: getReasoningBugFinder (:1737, env PRP_REASONING_BUG_FINDER_AGENT, default high),
           getReasoningValidation (:1765, env PRP_REASONING_VALIDATION_AGENT, default high),
           getReasoningAgent (:1681, env PRP_REASONING_AGENT, default high)
  why: S3 consumes bug-finder + validation at the QA call sites, and the AGENT (research) level at the
        research-leaning sites. All route through resolveReasoningLevel: pure process.env read at call time,
        case-insensitive, empty→default, invalid→throw.
  gotcha: In unit tests the hack-config loader does NOT run, so getters read ONLY process.env (incl. values
        loaded from .env by tests/setup.ts). .env is clean of PRP_REASONING_* → defaults are 'high' (safe).

# EDIT TARGETS — the 4 call-site files
- file: src/workflows/bug-hunt-workflow.ts
  section: import L39 (getBugFinderAgent); call L273 (createQAAgent() inside generateReport)
  why: Add getReasoningBugFinder to the import; pass it as the createQAAgent arg.
  pattern: existing 'PATTERN: Create QA agent' comment block — extend, don't replace.
- file: src/workflows/validation-workflow.ts
  section: import L51-54 (getValidationAgent, getValidationTimeoutSeconds); call L235 (inside generateScript)
  why: Add getReasoningValidation to the import; pass it as the createQAAgent arg.
  gotcha: leave getValidationAgent()/getValidationTimeoutSeconds() usages (logging L224, timeout budget) UNCHANGED.
- file: src/workflows/delta-analysis-workflow.ts
  section: imports ~L24-26 (NO constants import today); call L121 (inside analyzeDelta)
  why: ADD a new import line for getReasoningAgent; pass it + a research-leaning comment.
- file: src/core/change-classifier.ts
  section: import L48 (getClassifierRetryMax); calls L112 (classifyChange) + L161 (classifyArtifact)
  why: Add getReasoningAgent to the import; pass it + a research-leaning comment at BOTH calls.

# TEST FILES being extended
- file: tests/unit/workflows/bug-hunt-workflow.test.ts
  section: mock block L19 + L51-57; existing 'should call createQAAgent to get agent' (L310) is the SETUP template
  why: NEW describe asserting createQAAgent receives getReasoningBugFinder()'s level + independence vs validation.
  gotcha: does NOT mock constants.js → real getter; add afterEach(unstubAllEnvs); existing call-COUNT assertion stays GREEN.
- file: tests/unit/workflows/validation-workflow.test.ts
  section: constants.js mock L53-56 (WHOLE MODULE — the trap); beforeEach L66+ sets mockCreateQAAgent return
  why: CONVERT the constants mock to importOriginal spread (getReasoningValidation REAL); NEW describe for level + independence.
  critical: WITHOUT the conversion, getReasoningValidation is undefined → every generateScript test red-errors.
- file: tests/unit/workflows/delta-analysis-workflow.test.ts
  section: mock block L19+L31-35; existing 'should call createQAAgent to get agent' (L137) is the SETUP template
  why: NEW it() asserting createQAAgent receives getReasoningAgent()'s level (default + PRP_REASONING_AGENT override).
  gotcha: does NOT mock constants.js → real getter; add afterEach(unstubAllEnvs).
- file: tests/unit/core/change-classifier.test.ts
  section: mock block L23+L38-51; existing classifyChange/classifyArtifact tests (L180, L334) are SETUP templates
  why: NEW it()s asserting BOTH classifiers pass getReasoningAgent()'s level (default + override).
  gotcha: does NOT mock constants.js → real getter; the empty-content guard in classifyArtifact runs BEFORE createQAAgent
        (L155-158) — pass non-empty content so the agent IS created, or the call-count/arg assertion sees 0 calls.

# CONSUMERS (none beyond these 4 files — S3 is the LAST consumer of createQAAgent's new signature)
- none. After S3, every createQAAgent call in src/ passes a level; typecheck is fully clean.
```

### Current Codebase tree (edit surface)
```bash
src/workflows/bug-hunt-workflow.ts        # EDIT: import L39 (+getReasoningBugFinder); call L273 (+arg)
src/workflows/validation-workflow.ts      # EDIT: import L51-54 (+getReasoningValidation); call L235 (+arg)
src/workflows/delta-analysis-workflow.ts  # EDIT: NEW import (+getReasoningAgent); call L121 (+arg +comment)
src/core/change-classifier.ts             # EDIT: import L48 (+getReasoningAgent); calls L112+L161 (+arg +comment each)
src/config/constants.ts                   # READ-ONLY (getters — T1.S2, Complete)
tests/unit/workflows/bug-hunt-workflow.test.ts        # EDIT: + reasoning-wiring describe (real getter)
tests/unit/workflows/validation-workflow.test.ts      # EDIT: convert constants mock + reasoning-wiring describe
tests/unit/workflows/delta-analysis-workflow.test.ts  # EDIT: + reasoning-level it() (real getter)
tests/unit/core/change-classifier.test.ts             # EDIT: + reasoning-level it()s for both classifiers
```

### Desired Codebase tree with files to be changed
```bash
src/workflows/bug-hunt-workflow.ts        # EDIT — import + call-site arg
src/workflows/validation-workflow.ts      # EDIT — import + call-site arg
src/workflows/delta-analysis-workflow.ts  # EDIT — new import + call-site arg + comment
src/core/change-classifier.ts             # EDIT — import + 2 call-site args + 2 comments
tests/unit/workflows/bug-hunt-workflow.test.ts        # EDIT — new describe + afterEach
tests/unit/workflows/validation-workflow.test.ts      # EDIT — constants mock conversion + new describe + afterEach
tests/unit/workflows/delta-analysis-workflow.test.ts  # EDIT — new it() + afterEach
tests/unit/core/change-classifier.test.ts             # EDIT — new it()s + afterEach
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (validation-workflow.test.ts mocks constants.js WHOLE-MODULE): after S3, validation-workflow.ts
//   imports getReasoningValidation from constants.js. The existing vi.mock('.../constants.js', () => ({
//   getValidationAgent:…, getValidationTimeoutSeconds:… })) REPLACES the module → getReasoningValidation is
//   undefined → createQAAgent(getReasoningValidation()) throws at runtime, breaking every generateScript test.
//   FIX: convert to vi.mock(path, async (importOriginal) => ({ ...await importOriginal(),
//   getValidationAgent: vi.fn().mockReturnValue('pizr'), getValidationTimeoutSeconds: vi.fn().mockReturnValue(7200) })).
//   This keeps the 2 existing fakes AND makes getReasoningValidation REAL (reads process.env) → the env-independence
//   test is faithful. (research §4b.)

// CRITICAL (the other 3 test files do NOT mock constants.js): bug-hunt / delta-analysis / change-classifier
//   tests let the REAL getter run. So vi.stubEnv('PRP_REASONING_*') flows straight through to the workflow's
//   createQAAgent(getReasoning*()) arg. Assert via toHaveBeenCalledWith(<level>).

// CRITICAL (vi.stubEnv does NOT auto-restore here): vitest.config.ts has no unstubEnvs/unstubGlobals, and NONE
//   of the 4 test files define afterEach. A stubbed level LEAKS into sibling tests (e.g. a stubbed 'low' would
//   make a later "default" assertion see 'low' instead of 'high'). FIX: add afterEach(() => vi.unstubAllEnvs())
//   to every describe/file that newly uses vi.stubEnv.

// GOTCHA (env determinism is safe today): tests/setup.ts loads .env into process.env before tests, but the repo
//   .env does NOT set any PRP_REASONING_* (only .env.example documents them, commented). So real getters return
//   the 'high' default with no stub → default-level assertions are safe. For ROBUSTNESS against future .env edits,
//   stub explicitly in every new it() (default case stubs 'high'; override case stubs the override value).

// GOTCHA (classifyArtifact empty-content guard runs BEFORE createQAAgent): src/core/change-classifier.ts:155-158
//   throws AgentError for empty/whitespace content BEFORE creating the agent. In change-classifier.test.ts, pass
//   NON-EMPTY content to the classifyArtifact test (the existing tests already do), or createQAAgent is never
//   called and the arg assertion sees 0 calls.

// GOTCHA (locate by grep, not line number): S2 (parallel) may shift line numbers. Grep for `createQAAgent()` and
//   for each `import … from '../config/constants.js'` rather than trusting L273/L235/L121/L112/L161.

// GOTCHA (do NOT widen scope): S3 touches ONLY the 5 call sites + 4 imports + 3 comments + 4 test files. Do NOT
//   edit agent-factory.ts / createBaseConfig / ROLE_CONFIG (S1+S2 regions), the prompts/*.ts doc examples, or
//   PRD.md/spec/**/tasks.json/prd_snapshot.md. The 2 in-code JSDoc mentions (change-classifier.ts:99,
//   validation-workflow.ts:209) are OPTIONAL doc-accuracy polish — not success criteria.
```

## Implementation Blueprint

### Data models and structure
No new data models. `ReasoningLevel` and the 5 getters exist (T1.S2). The call sites change from no-arg
to passing a `ReasoningLevel`; nothing else about the agent config or workflow logic changes.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT src/workflows/bug-hunt-workflow.ts — import + call-site arg
  - import L39: `import { getBugFinderAgent, getReasoningBugFinder } from '../config/constants.js';`
  - call L273: `const qaAgent = createQAAgent(getReasoningBugFinder());` (keep the surrounding 'PATTERN:
    Create QA agent' comment; optionally append "— reasoning resolved per-role per PRD §9.2.9").
  - DO NOT: change getBugFinderAgent() usage, generateReport logic, logger, or any other line.

Task 2: EDIT src/workflows/validation-workflow.ts — import + call-site arg
  - import L51-54: add `getReasoningValidation` to the `getValidationAgent, getValidationTimeoutSeconds`
    named import from '../config/constants.js'.
  - call L235: `const agent = createQAAgent(getReasoningValidation());` (+ a one-line comment: validation
    level, independent of bug-finder per §9.2.9).
  - DO NOT: change getValidationAgent() (logging L224) or getValidationTimeoutSeconds() (budget) usages.

Task 3: EDIT src/workflows/delta-analysis-workflow.ts — NEW import + call-site arg + comment
  - ADD import (after the agent-factory import ~L24): `import { getReasoningAgent } from '../config/constants.js';`
  - call L121: `const qaAgent = createQAAgent(getReasoningAgent());` + research-leaning comment
    (research §3 — names §9.2.9, explains analysis-not-bug-finding, notes bug-finder/validation resolve own).
  - DO NOT: change analyzeDelta logic, retryAgentPrompt, or the prompt call.

Task 4: EDIT src/core/change-classifier.ts — import + 2 call-site args + 2 comments
  - import L48: `import { getClassifierRetryMax, getReasoningAgent } from '../config/constants.js';`
  - call L112 (classifyChange): `const agent: Agent = createQAAgent(getReasoningAgent());` + research-leaning comment.
  - call L161 (classifyArtifact): `const agent: Agent = createQAAgent(getReasoningAgent());` + research-leaning comment.
  - (Identical comment at both — sibling classifiers of the same kind.)
  - DO NOT: change the AgentError throws, the bare agent.prompt call, the empty-content guard, or retry wiring.

Task 5: EDIT tests/unit/workflows/bug-hunt-workflow.test.ts — reasoning-wiring describe (real getter)
  - ADD `afterEach(() => vi.unstubAllEnvs())` to the new describe (file has none today).
  - NEW `describe('createQAAgent reasoning wiring (PRD §9.2.9 / P1.M1.T3.S3)')`:
    (a) default 'high' — vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT','high'); run generateReport (reuse the
        L310 SETUP: mockCreateQAAgent.mockReturnValue(mockAgent) + mockCreateBugHuntPrompt.mockReturnValue({}));
        assert toHaveBeenCalledWith('high').
    (b) INDEPENDENCE — vi.stubEnv BOTH PRP_REASONING_BUG_FINDER_AGENT='xhigh' AND PRP_REASONING_VALIDATION_AGENT='low';
        assert toHaveBeenCalledWith('xhigh') (NOT 'low' — bug-hunt reads only its own knob).
  - PRESERVE: the existing L310 'should call createQAAgent to get agent' test (its call-COUNT assertion stays GREEN;
    S3 adds ARG assertions only in the new describe).

Task 6: EDIT tests/unit/workflows/validation-workflow.test.ts — mock conversion + reasoning-wiring describe
  - CONVERT the constants.js mock (L53-56) to the importOriginal spread form (research §4b / gotcha above) —
    preserves getValidationAgent/getValidationTimeoutSeconds fakes AND makes getReasoningValidation REAL.
  - ADD `afterEach(() => vi.unstubAllEnvs())` to the new describe.
  - NEW `describe('createQAAgent reasoning wiring (PRD §9.2.9 / P1.M1.T3.S3)')`:
    (a) default 'high' — vi.stubEnv('PRP_REASONING_VALIDATION_AGENT','high'); set sessionPath='/session';
        run generateScript; assert toHaveBeenCalledWith('high').
    (b) INDEPENDENCE — vi.stubEnv BOTH PRP_REASONING_BUG_FINDER_AGENT='xhigh' AND PRP_REASONING_VALIDATION_AGENT='low';
        assert toHaveBeenCalledWith('low') (NOT 'xhigh' — validation reads only its own knob).
  - PRESERVE: existing getValidationAgent→'pizr' / getValidationTimeoutSeconds→7200 assertions (the converted
    mock keeps those fakes → they stay GREEN). Reuse the beforeEach mock-return setup.

Task 7: EDIT tests/unit/workflows/delta-analysis-workflow.test.ts — research-leaning level it()
  - ADD `afterEach(() => vi.unstubAllEnvs())`.
  - NEW it() (inside the analyzeDelta describe): vi.stubEnv('PRP_REASONING_AGENT','medium'); run analyzeDelta
    (reuse the L137 SETUP); assert toHaveBeenCalledWith('medium'). (Override value proves it reads the AGENT knob,
    not bug-finder/validation.) Optionally also a default-'high' case with the var unset/stubbed 'high'.
  - PRESERVE: the L137 'should call createQAAgent to get agent' test.

Task 8: EDIT tests/unit/core/change-classifier.test.ts — research-leaning level it()s (BOTH classifiers)
  - ADD `afterEach(() => vi.unstubAllEnvs())`.
  - NEW it() for classifyChange: vi.stubEnv('PRP_REASONING_AGENT','medium'); run classifyChange(diffSummary)
    (reuse the L180 SETUP); assert toHaveBeenCalledWith('medium').
  - NEW it() for classifyArtifact: vi.stubEnv('PRP_REASONING_AGENT','medium'); run classifyArtifact(NON-EMPTY
    content — the empty-content guard at L155-158 runs BEFORE createQAAgent); assert toHaveBeenCalledWith('medium').
  - PRESERVE: the L180/L334 call-count tests.
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the 5 call-site edits (research §3)
// bug-finder + validation → their OWN dedicated getters (the §9.2.9 independence requirement):
const qaAgent = createQAAgent(getReasoningBugFinder());   // bug-hunt-workflow.ts:273
const agent   = createQAAgent(getReasoningValidation());  // validation-workflow.ts:235
// delta-analysis + change-classifier → the research (AGENT) level, DOCUMENTED as research-leaning:
const qaAgent = createQAAgent(getReasoningAgent());       // delta-analysis-workflow.ts:121 (+ comment)
const agent: Agent = createQAAgent(getReasoningAgent());  // change-classifier.ts:112 (+ comment)
const agent: Agent = createQAAgent(getReasoningAgent());  // change-classifier.ts:161 (+ comment)

// PATTERN: research-leaning comment (delta-analysis + change-classifier — copy-ready)
// RESEARCH-LEANING (PRD §9.2.9): this is an analysis/research task (not bug-finding or validation), so it
// reuses the AGENT (research) reasoning level via getReasoningAgent(). bug-finder + validation callers
// resolve their OWN levels independently.

// PATTERN: the validation-workflow.test.ts constants mock conversion (the ONE trap — research §4b)
vi.mock('../../../src/config/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/constants.js')>();
  return {
    ...actual, // getReasoningValidation (and all other exports) = REAL → reads process.env
    getValidationAgent: vi.fn().mockReturnValue('pizr'),           // existing fake preserved
    getValidationTimeoutSeconds: vi.fn().mockReturnValue(7200),    // existing fake preserved
  };
});

// PATTERN: the independence assertion (bug-hunt; validation mirrors with 'low')
it('bug-hunter reasoning is independent of validation', async () => {
  vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'xhigh');
  vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'low'); // set BOTH — bug-hunt must ignore this
  /* …generateReport SETUP… */
  await workflow.generateReport();
  expect(mockCreateQAAgent).toHaveBeenCalledWith('xhigh'); // NOT 'low'
});

// GOTCHA (above): vi.stubEnv needs afterEach(unstubAllEnvs) — none of the 4 files define it today.
// GOTCHA (above): classifyArtifact's empty-content guard throws BEFORE createQAAgent — pass non-empty content.
// GOTCHA (above): the other 3 test files do NOT mock constants.js → real getters; only validation needs the conversion.
```

### Integration Points
```yaml
IMPORTS (4 files, all from '../config/constants.js'):
  - bug-hunt-workflow.ts:39        + getReasoningBugFinder   (extend existing getBugFinderAgent import)
  - validation-workflow.ts:51-54   + getReasoningValidation  (extend existing 2-name import)
  - delta-analysis-workflow.ts ~L24 + getReasoningAgent      (NEW import statement — file has none today)
  - change-classifier.ts:48        + getReasoningAgent       (extend existing getClassifierRetryMax import)

CALL SITES (5 — each gains the getter as the now-required createQAAgent arg):
  - bug-hunt-workflow.ts:273 / validation-workflow.ts:235 / delta-analysis-workflow.ts:121 /
    change-classifier.ts:112 / change-classifier.ts:161

TEST MOCKS:
  - validation-workflow.test.ts:53-56  CONVERT constants.js mock → importOriginal spread (getReasoningValidation REAL)
  - (bug-hunt / delta-analysis / change-classifier tests): constants.js NOT mocked → real getters; no mock change

NONE OF: agent-factory.ts / createBaseConfig / ROLE_CONFIG / ThinkingLevel (S1+S2 regions), prompts/*.ts doc
         examples, getValidationAgent/getValidationTimeoutSeconds/getBugFinderAgent/getClassifierRetryMax usages,
         PRD.md / spec/** / tasks.json / prd_snapshot.md, src/config/hack-config.ts (T2), src/index.ts (T4).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run lint            # eslint . --ext .ts — clean on the 4 edited src + 4 test files
npm run format:check    # prettier --check — clean (run `npm run format` if it flags)
# Expected: zero errors on the edited files.
```

### Level 2: Unit Tests (the PRIMARY runtime gate)
```bash
npx vitest run tests/unit/workflows/bug-hunt-workflow.test.ts tests/unit/workflows/validation-workflow.test.ts tests/unit/workflows/delta-analysis-workflow.test.ts tests/unit/core/change-classifier.test.ts
# EXPECTED: GREEN.
#   - New bug-hunt + validation 'reasoning wiring' describes pass: default 'high' AND independence
#     (bug-hunt sees xhigh, validation sees low, when BOTH role-vars are set to distinct values).
#   - New delta-analysis + change-classifier it()s pass: research-leaning callers thread getReasoningAgent()
#     (honors a PRP_REASONING_AGENT override).
#   - EXISTING tests stay GREEN: validation's getValidationAgent→'pizr' / getValidationTimeoutSeconds→7200
#     assertions still hold (the converted mock preserves those fakes); all call-COUNT assertions unchanged.
# If a default-level assertion fails, check vi.stubEnv was set BEFORE the workflow call AND that an earlier
#   stub didn't leak (afterEach(unstubAllEnvs) missing). If validation tests red-error with 'getReasoningValidation
#   is not a function', the constants mock was NOT converted to importOriginal.
```

### Level 3: The Typecheck Gate (the end-to-end "QA split complete" signal)
```bash
npm run typecheck 2>&1 | grep "error TS2554"
# EXPECTED: EMPTY (no output) — all 5 S2-left createQAAgent call sites now pass the required arg.
# This is the definitive signal: S1 (decouple) + S2 (factories) + S3 (call sites) = QA split complete, type-clean.
npm run typecheck 2>&1 | grep -E "createQAAgent" || echo "OK: no createQAAgent type errors"
# EXPECTED: "OK: no createQAAgent type errors". (S3 touches no factory/base-config region, so a clean typecheck
#   here means the whole QA reasoning path type-checks end to end.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Grep-gate: no bare createQAAgent() CALL remains in src/ (JSDoc/doc-example mentions are allowed).
grep -rn "createQAAgent()" src/ | grep -vE "prompts/|//|\*|@remarks|@example"
# EXPECTED: no output (the 5 call sites now pass an arg). Any hit is a missed site — wire it.
# Confirm the 3 research-leaning comments are present:
grep -n "RESEARCH-LEANING" src/workflows/delta-analysis-workflow.ts src/core/change-classifier.ts
# EXPECTED: 3 hits (delta-analysis:121 area; change-classifier:112 + :161 areas).
# Independence smoke (no agent call) — confirm each getter is independent at the source:
npx tsx -e "import('./src/config/constants.js').then(({getReasoningBugFinder,getReasoningValidation}) => { process.env.PRP_REASONING_BUG_FINDER_AGENT='xhigh'; process.env.PRP_REASONING_VALIDATION_AGENT='low'; console.log({bugfinder:getReasoningBugFinder(), validation:getReasoningValidation()}); });"
# EXPECTED: { bugfinder: 'xhigh', validation: 'low' } — the two getters are independent (the call sites just thread these).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 lint + format:check clean on the 8 edited files (4 src + 4 test).
- [ ] Level 2: 4 targeted vitest files GREEN (new reasoning cases + all existing tests).
- [ ] Level 3: `npm run typecheck` fully clean — 0 TS2554 (the 5 S2-left sites closed).
- [ ] Level 4: grep-gate confirms no bare `createQAAgent()` call in src/; 3 research-leaning comments present.

### Feature Validation
- [ ] bug-hunt passes `getReasoningBugFinder()`; validation passes `getReasoningValidation()`; delta-analysis
      + change-classifier (×2) pass `getReasoningAgent()`.
- [ ] **Independence proven:** with both role-vars set to distinct values, bug-hunt sees ONLY its own
      (xhigh) and validation sees ONLY its own (low).
- [ ] Research-leaning callers honor a `PRP_REASONING_AGENT` override (delta-analysis + both classifiers).
- [ ] validation-workflow.test.ts constants mock converted to `importOriginal` (existing fakes preserved).
- [ ] No behavior change beyond the reasoning-level arg (agent creation, prompts, retry, file-IO unchanged).

### Code Quality Validation
- [ ] Each call site locatable by grep (line numbers may shift under S2) — edits land on the right `createQAAgent()`.
- [ ] `afterEach(() => vi.unstubAllEnvs())` added wherever `vi.stubEnv` is newly used (4 files).
- [ ] Research-leaning comments are explicit + cite §9.2.9 (a future maintainer sees the decision).
- [ ] No scope creep into agent-factory.ts / createBaseConfig / prompts doc examples / PRD / tasks.json.

### Documentation & Deployment
- [ ] No docs changes in this task (P1.M2 owns changeset docs — separate milestone).
- [ ] No env-var additions (the `PRP_REASONING_*` getters already exist from T1.S2).
- [ ] (Optional, non-blocking) the 2 in-code JSDoc `createQAAgent()` mentions (change-classifier.ts:99,
      validation-workflow.ts:209) updated to show the resolved-arg form for doc accuracy.

---

## Anti-Patterns to Avoid
- ❌ Don't leave `validation-workflow.test.ts`'s constants.js mock as a plain factory — after S3 the workflow imports `getReasoningValidation`, which would be `undefined` under the whole-module mock and break every `generateScript` test. Convert to the `importOriginal` spread form.
- ❌ Don't mock `getReasoningBugFinder` / `getReasoningAgent` in the bug-hunt / delta-analysis / change-classifier tests — they don't mock constants.js, so the REAL getter runs; stub the ENV (`vi.stubEnv`) instead. Mocking the getter would not exercise the env→level path.
- ❌ Don't forget `afterEach(() => vi.unstubAllEnvs())` — vitest doesn't auto-restore env stubs in this config, and a leaked `low`/`xhigh`/`medium` flips later default-level assertions.
- ❌ Don't widen scope — S3 is ONLY the 5 call sites + 4 imports + 3 comments + 4 test files. No agent-factory.ts, no createBaseConfig, no prompts doc examples, no PRD/spec/tasks.json.
- ❌ Don't pass empty/whitespace content to `classifyArtifact` in its reasoning test — the empty-content guard (change-classifier.ts:155-158) throws BEFORE `createQAAgent` is created, so the arg assertion would see 0 calls. Use the existing non-empty fixture.
- ❌ Don't trust line numbers (L273/L235/L121/L112/L161) — S2 (parallel) may shift them. Grep for `createQAAgent()` and each constants import.
- ❌ Don't change the existing call-COUNT assertions — they stay valid (S3 adds ARGUMENT assertions only); tampering with them risks regressions unrelated to reasoning.
- ❌ Don't conflate "4 call sites" with 4 calls — change-classifier has TWO (`classifyChange` + `classifyArtifact`); both must pass `getReasoningAgent()` and both get a comment. That's 5 edits in 4 files.

---

## Confidence Score
**9 / 10** — one-pass success. The 5 call-site edits and 4 import edits are mechanical and unambiguous;
the getter contract (T1.S2, verified in source) and S2's required-`reasoningLevel` signature are fixed
inputs. The single non-obvious trap — `validation-workflow.test.ts` mocking `constants.js` whole-module
— is fully specified (convert to `importOriginal`, preserving the 2 existing fakes). The independence test
is copy-ready. Residual risk is low and bounded: line-number drift under S2 (mitigated by grep-gate) and
env-stub leakage (mitigated by `afterEach(unstubAllEnvs)`, explicitly required). The typecheck gate
gives a definitive green light: a fully clean `tsc` means the entire QA reasoning path type-checks end
to end (S1+S2+S3).