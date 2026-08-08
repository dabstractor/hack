# Research — P1.M1.T3.S3: Wire the `createQAAgent` call sites to pass resolved reasoning levels

PRD §9.2.9 (Per-Role Reasoning Level) + §9.2.3 (Model Selection). Architecture spec:
`plan/013_3f31aa2b81b7/architecture/integration-points.md §E`. This task is the **call-site half** of
the QA split: S2 gave `createQAAgent` the signature `createQAAgent(reasoningLevel: ReasoningLevel)` and
deliberately left the **production call sites** as TS2554 (the S3 hand-off, mirroring S1→S2). **S3 closes
them**: each caller resolves its OWN reasoning getter and passes it. The core §9.2.9 requirement —
**bug-finder and validation resolve INDEPENDENT levels** — is realized here.

---

## 1. Inventory — ALL `createQAAgent` production call sites (grep-verified)

```
src/workflows/bug-hunt-workflow.ts:273       const qaAgent = createQAAgent();        → createQAAgent(getReasoningBugFinder())
src/workflows/validation-workflow.ts:235     const agent = createQAAgent();          → createQAAgent(getReasoningValidation())
src/workflows/delta-analysis-workflow.ts:121 const qaAgent = createQAAgent();        → createQAAgent(getReasoningAgent())   [research-leaning]
src/core/change-classifier.ts:112  classifyChange     const agent = createQAAgent(); → createQAAgent(getReasoningAgent())   [research-leaning]
src/core/change-classifier.ts:161  classifyArtifact   const agent = createQAAgent(); → createQAAgent(getReasoningAgent())   [research-leaning]
```

That is **4 files, 5 call sites**. The item title says "4" (grouped by role/location); change-classifier
contributes 2 (one per exported classifier). Every other `createQAAgent(` hit in `src/` is a **JSDoc**
reference (not a call): `change-classifier.ts:99`, `validation-workflow.ts:209`, and doc examples in
`src/agents/prompts/{bug-hunt,validation,change-classifier}-prompt.ts`. S3 touches only the 5 CALL sites
above (the 2 in-code JSDoc mentions at change-classifier.ts:99 + validation-workflow.ts:209 are optional
doc-accuracy polish — §6).

No call site is missed and none is extra. S2 is the ONLY producer of `createQAAgent`; S3 is the ONLY
consumer-set changer.

---

## 2. Import edits per file (the `import … from '../config/constants.js'` line)

| File | CURRENT constants import | EDIT |
| ---- | ------------------------ | ---- |
| `bug-hunt-workflow.ts:39` | `import { getBugFinderAgent } from '../config/constants.js';` (separate stmt) | extend → `import { getBugFinderAgent, getReasoningBugFinder } from '../config/constants.js';` |
| `validation-workflow.ts:51-54` | `import { getValidationAgent, getValidationTimeoutSeconds } from '../config/constants.js';` | extend → add `getReasoningValidation` to the same named-import list |
| `delta-analysis-workflow.ts` | **NONE** (no constants import today) | ADD → `import { getReasoningAgent } from '../config/constants.js';` (after the agent-factory import, L24-25 area) |
| `change-classifier.ts:48` | `import { getClassifierRetryMax } from '../config/constants.js';` | extend → `import { getClassifierRetryMax, getReasoningAgent } from '../config/constants.js';` |

All four import the getter **from `'../config/constants.js'`** (workflows are one level deeper →
`'../../../src/config/constants.js'` only inside tests; src files use the 2-dot relative path shown).

---

## 3. The call-site edits (copy-ready)

### bug-hunt-workflow.ts:273  (bug-finder → its OWN level)
```ts
      // PATTERN: Create QA agent — reasoning resolved per-role per PRD §9.2.9 (bug-finder level).
      const qaAgent = createQAAgent(getReasoningBugFinder());
```
(The existing `// PATTERN: Create QA agent` comment at L271 stays; this just adds the getter arg.)

### validation-workflow.ts:235  (validation → its OWN level)
```ts
      // Reasoning resolved per-role per PRD §9.2.9 (validation level — independent of bug-finder).
      const agent = createQAAgent(getReasoningValidation());
```

### delta-analysis-workflow.ts:121  (research-leaning — DOCUMENTED)
```ts
      // RESEARCH-LEANING (PRD §9.2.9): delta-analysis is an analysis/research task, not a bug-finder or
      // validation step, so it reuses the AGENT (research) reasoning level via getReasoningAgent().
      // (bug-finder + validation callers resolve their OWN levels independently.)
      const qaAgent = createQAAgent(getReasoningAgent());
```

### change-classifier.ts:112 (classifyChange) + :161 (classifyArtifact)  (research-leaning — DOCUMENTED at both)
```ts
  // RESEARCH-LEANING (PRD §9.2.9): change/artifact classification is an analysis task, not bug-finding or
  // validation, so it uses the AGENT (research) reasoning level via getReasoningAgent().
  const agent: Agent = createQAAgent(getReasoningAgent());
```
(Identical comment + call at BOTH :112 and :161 — they are sibling classifiers of the same kind.)

---

## 4. Test strategy — the per-file picture (THE key research)

Every call-site test file **mocks the whole `agent-factory.js` module** with `createQAAgent: vi.fn()`
and reads the call via `const mockCreateQAAgent = createQAAgent as any;`. After S3, the workflow calls
`createQAAgent(getReasoning*())` — the ARGUMENT is the resolved level, and `getReasoning*()` runs in the
WORKFLOW module (real or mocked depending on the file). The new tests assert the **argument**:
`expect(mockCreateQAAgent).toHaveBeenCalledWith(<level>)`.

### 4a. Whether `constants.js` is mocked in each file (CRITICAL — determines the strategy)

```
bug-hunt-workflow.test.ts        → does NOT mock constants.js  → getReasoningBugFinder is REAL (reads process.env)
delta-analysis-workflow.test.ts  → does NOT mock constants.js  → getReasoningAgent is REAL (reads process.env)
change-classifier.test.ts        → does NOT mock constants.js  → getReasoningAgent is REAL (reads process.env)
validation-workflow.test.ts      → MOCKS constants.js (whole module) → ⚠ getReasoningValidation WOULD BE undefined
```

### 4b. The validation-workflow.test.ts GOTCHA (the one real trap)

`validation-workflow.test.ts:53-56` replaces the entire constants module:
```ts
vi.mock('../../../src/config/constants.js', () => ({
  getValidationAgent: vi.fn().mockReturnValue('pizr'),
  getValidationTimeoutSeconds: vi.fn().mockReturnValue(7200),
}));
```
After S3, `validation-workflow.ts` does `import { …, getReasoningValidation } from '../config/constants.js'`.
With the whole-module mock above, `getReasoningValidation` is **undefined** → the workflow throws
`getReasoningValidation is not a function` at the `createQAAgent(getReasoningValidation())` line. **Every
`generateScript` test red-errors.**

**FIX (recommended — keeps `getReasoningValidation` REAL so the env-independence test is faithful):**
convert the mock to spread `importOriginal` so the 2 existing fakes stay, and everything else (incl.
`getReasoningValidation`) is the real getter that reads `process.env`:
```ts
vi.mock('../../../src/config/constants.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/config/constants.js')>();
  return {
    ...actual, // getReasoningValidation (and all other exports) = REAL
    getValidationAgent: vi.fn().mockReturnValue('pizr'),
    getValidationTimeoutSeconds: vi.fn().mockReturnValue(7200),
  };
});
```
- The 2 existing fakes are preserved (tests that assert `'pizr'` / `7200` stay GREEN).
- `getReasoningValidation` is the REAL getter → `vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'low')`
  flows through identically to bug-hunt's real getter → the **independence proof is apples-to-apples**.

**Alternative (lower-fidelity, NOT recommended):** add `getReasoningValidation: vi.fn().mockReturnValue('high')`
to the existing mock and drive the override via `.mockReturnValue('low')`. Works but does not exercise the
real env→getter path; the independence story is weaker. Prefer the `importOriginal` form above.

### 4c. Env determinism (verified safe — but stub explicitly for robustness)

- `tests/setup.ts` loads `.env` via dotenv into `process.env` before tests. **Checked:** the repo `.env`
  does NOT set any `PRP_REASONING_*` (only `.env.example` documents them, commented out). So the real
  getters return the built-in defaults (`high`) with no stub. → Default-level assertions
  (`toHaveBeenCalledWith('high')`) are SAFE today.
- **For robustness against future `.env` edits**, every reasoning test should **explicitly** set its env
  var via `vi.stubEnv(...)` before invoking the workflow (the default case stubs `'high'`; the override
  case stubs the override value). `resolveReasoningLevel` reads `process.env[KEY]` at call time, so a
  stubbed value is honored immediately.
- **Hygiene:** NONE of the 4 test files currently define `afterEach`. `vi.stubEnv` does NOT auto-restore
  (vitest only auto-restores if `unstubGlobals`/`unstubEnvs` is set — it is NOT in `vitest.config.ts`).
  → Each file that newly uses `vi.stubEnv` MUST add `afterEach(() => vi.unstubAllEnvs())` so a stubbed
  level does not leak into sibling tests (e.g. a stubbed `low` must not make a "default" assertion see `low`).

### 4d. Existing assertions that stay valid (no breakage)

None of the 4 files currently assert `createQAAgent`'s ARGUMENT — they assert `toHaveBeenCalled()` /
`toHaveBeenCalledTimes(1)` only. Adding the getter arg does not change call COUNT, so **all existing
call-count assertions stay GREEN**. S3 only ADDS argument-level assertions in new `it()` cases (and the
validation-workflow mock conversion, which preserves the 2 fakes). The mock-return setup
(`mockCreateQAAgent.mockReturnValue(mockAgent)`) is unchanged — the workflow still gets back the mock
agent and proceeds exactly as before.

---

## 5. The §9.2.9 independence test (the core deliverable, copy-ready)

The headline requirement: **bug-finder and validation resolve INDEPENDENT levels.** Best demonstrated as a
dedicated `it()` in EACH of bug-hunt-workflow.test.ts and validation-workflow.test.ts that sets ONLY its
own env var to a distinct non-default value and asserts `createQAAgent` received exactly that level —
proving each workflow reads ONLY its own knob.

### bug-hunt-workflow.test.ts — new describe / it (real getter)
```ts
  describe('createQAAgent reasoning wiring (PRD §9.2.9 / P1.M1.T3.S3)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('passes the bug-finder reasoning level (default high) to createQAAgent', async () => {
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'high');
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateQAAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: { hasBugs: false, bugs: [], summary: 'ok', recommendations: [] },
          error: null, metadata: { agentId: 'qa', timestamp: Date.now() },
        }),
      });
      mockCreateBugHuntPrompt.mockReturnValue({});
      await workflow.generateReport();
      expect(mockCreateQAAgent).toHaveBeenCalledWith('high');
    });

    it('passes the bug-finder reasoning level independently of validation (xhigh)', async () => {
      // Set BOTH role vars to DIFFERENT values; bug-hunt must see ONLY its own (xhigh).
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'xhigh');
      vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'low');
      const workflow = new BugHuntWorkflow('PRD content', []);
      mockCreateQAAgent.mockReturnValue({
        prompt: vi.fn().mockResolvedValue({
          status: 'success',
          data: { hasBugs: false, bugs: [], summary: 'ok', recommendations: [] },
          error: null, metadata: { agentId: 'qa', timestamp: Date.now() },
        }),
      });
      mockCreateBugHuntPrompt.mockReturnValue({});
      await workflow.generateReport();
      expect(mockCreateQAAgent).toHaveBeenCalledWith('xhigh'); // NOT 'low' — independent
    });
  });
```

### validation-workflow.test.ts — new describe / it (real getter, after the §4b mock conversion)
```ts
  describe('createQAAgent reasoning wiring (PRD §9.2.9 / P1.M1.T3.S3)', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('passes the validation reasoning level (default high) to createQAAgent', async () => {
      vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'high');
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      await workflow.generateScript();
      expect(mockCreateQAAgent).toHaveBeenCalledWith('high');
    });

    it('passes the validation reasoning level independently of bug-finder (low)', async () => {
      // Set BOTH role vars to DIFFERENT values; validation must see ONLY its own (low).
      vi.stubEnv('PRP_REASONING_BUG_FINDER_AGENT', 'xhigh');
      vi.stubEnv('PRP_REASONING_VALIDATION_AGENT', 'low');
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      await workflow.generateScript();
      expect(mockCreateQAAgent).toHaveBeenCalledWith('low'); // NOT 'xhigh' — independent
    });
  });
```
(The `generateScript` happy path needs `mockCreateQAAgent.mockReturnValue` + bash-mcp + the file-read
fakes already set in the file's `beforeEach`; reuse them. The existing `generateScript` "should call
createQAAgent" test at L130 is the template.)

### delta-analysis-workflow.test.ts + change-classifier.test.ts — research-leaning gets `getReasoningAgent()`
Each adds a small `it()` asserting `createQAAgent` is called with the AGENT level (default `'high'`),
honoring a `PRP_REASONING_AGENT` override. These prove the research-leaning callers thread the research
level (NOT the bug-finder/validation level):
```ts
// delta-analysis: reuse the existing analyzeDelta SETUP (mockAgent with a valid DeltaAnalysis data payload).
it('passes the research (AGENT) reasoning level to createQAAgent [research-leaning]', async () => {
  vi.stubEnv('PRP_REASONING_AGENT', 'medium'); // override → proves it reads the AGENT knob
  /* …existing analyzeDelta setup… */
  await workflow.analyzeDelta();
  expect(mockCreateQAAgent).toHaveBeenCalledWith('medium');
});
// change-classifier: same shape for classifyChange AND classifyArtifact (both call createQAAgent).
```

---

## 6. Optional doc-accuracy polish (NOT blocking; mention only)

Two **in-code JSDoc** strings still reference the old no-arg `createQAAgent()`:
- `change-classifier.ts:99` — `@remarks … invokes the QA agent (\`createQAAgent()\`) …`
- `validation-workflow.ts:209` — `@remarks … \`createQAAgent()\` → …`

Updating these to `createQAAgent(getReasoningAgent())` / `createQAAgent(getReasoningValidation())` keeps
the docs honest with zero behavior change. Cheap; bundle with the call-site edits if convenient, but they
are NOT part of the success criteria (the prompts/*.ts doc examples are NOT in scope — leave them).

---

## 7. The typecheck picture after S3 (the green-light gate)

After S2, `npm run typecheck` shows TS2554 at exactly the 5 S3 call sites (createQAAgent now requires an
arg). **S3 closes ALL of them.** The gate:
```bash
npm run typecheck 2>&1 | grep "error TS2554"   # EXPECTED: EMPTY (no output) — all 5 call sites wired
```
S3 does NOT touch `agent-factory.ts` (S2's region) or `createBaseConfig`/`ROLE_CONFIG` (S1's region). So a
clean typecheck after S3 is the definitive "QA split is complete end-to-end" signal.

Lint/format: eslint is NOT type-aware, so it was already clean during S2's deliberate breakage; S3 keeps
it clean. `npm run format:check` on the 4 src + 4 test files.