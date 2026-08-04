# Action-on-DIRTY decision + decomposePRD test scaffolding

Authoritative reference for P1.M2.T2.S1. Locks the ambiguous action-on-DIRTY
against PRD §4.3, pins the exact insertion point, and maps the unit-test
scaffolding (which mocks to extend + how to build a delta session).

## 1. PRD §4.3 — the EXACT contract (verified, PRD.md:78-84)

§4.3 step 1 "Change Classification" states verbatim:
> "A parallel **CLEAN/DIRTY** classifier guards generated artifacts (e.g., the
> delta PRD). … On exhaustion they MUST fail to the **protective/conservative
> default** (treat as SUBSTANTIVE / DIRTY) — **never silently fall through to
> 'could not classify' and proceed unprotected** through a SUBSTANTIVE change."

**What §4.3 DOES say:** the classifier *guards* generated artifacts; on
exhaustion → DIRTY (protective default); the governing principle is **"never …
proceed unprotected."**

**What §4.3 does NOT say:** the exact mechanism for a DIRTY verdict (abort vs
warn-and-proceed). The bug report requires "protection" but quotes no mechanism.

## 2. ACTION-ON-DIRTY DECISION: ABORT (logger.warn + throw) — verified against §4.3

**Decision: `this.logger.warn(...)` + `throw new Error(...)` → the decomposePRD
outer catch treats it as NON-FATAL → `#trackFailure` + `currentPhase =
'prd_decomposition_failed'` (architect NEVER called).**

**Why abort (not warn-and-proceed):**
- §4.3's governing principle is "never … proceed unprotected." Warn-and-proceed
  would feed a DIRTY/malformed `delta_prd.md` to the architect unprotected — a
  direct violation. ABORT is the only action consistent with the protective
  principle. (This rules out the alternative the architecture doc flagged.)
- **Mirrors two existing aborts in the SAME function:**
  - `loadDeltaPRD` missing → `throw new Error('… re-run to regenerate it via the
    delta spawn path')` (prp-pipeline.ts ~1297-1301, the `if (isDelta) try/catch`).
  - `result.status === 'error'` → `throw new Error('Architect agent failed: …')`
    (~1318). Both are plain Errors inside the try → caught NON-fATAL → tracked +
    `prd_decomposition_failed`. The DIRTY throw is byte-identical in handling.
- **No infinite loop (verified):** the classifier's exhaustion default is DIRTY,
  so classifier-down → DIRTY → abort → next run. On resume, the **delta spawn
  path (DeltaAnalysisWorkflow) regenerates `delta_prd.md` fresh** and the guard
  re-classifies the new content. Fresh input each run ⇒ terminates.

**Why the throw is caught NON-FATAL (not propagated):**
- `decomposePRD`'s outer `catch` (prp-pipeline.ts ~1366-1383) calls
  `isFatalError(error, this.#continueOnError)`. `#continueOnError` defaults to
  `false` (constructor ~399). `isFatalError` (errors.ts:835) classifies a plain
  `Error` as **NON-fatal** ("All standard Error types … are non-fatal"). So the
  throw → `#trackFailure('decomposePRD', error)` + `logger.warn` +
  `currentPhase = 'prd_decomposition_failed'` + method **resolves** (no re-throw).
- This is IDENTICAL to the existing "Architect agent failed" throw — consistent,
  no caller-behavior change, no scope creep into fatal-error types.

**Testable contract (item MOCKING §5):** "assert architect NOT called, error
thrown/warn logged" → for a plain-Error abort this is: `mockCreateArchitectAgent`
NOT called + `currentPhase === 'prd_decomposition_failed'` + `logger.warn`
called (prominent). (Do NOT assert `decomposePRD()` rejects — it resolves via
the non-fatal catch. This mirrors how the existing architect-failed path is
observed.)

## 3. decomposePRD structure + exact insertion point (prp-pipeline.ts:1231-1318)

```ts
async decomposePRD(): Promise<void> {
  this.logger.info('[PRPPipeline] Decomposing PRD');
  try {
    const sessionPath = this.sessionManager.currentSession!.metadata.path;
    const isDelta = this.sessionManager.currentSession?.metadata.parentSession != null;  // 1240
    if (!isDelta) { /* non-delta hasBacklog early-return */ } else { /* log delta */ }

    const { createArchitectAgent } = await import('../agents/agent-factory.js');
    const { createArchitectPrompt } = await import('../agents/prompts/architect-prompt.js');
    const architectAgent = createArchitectAgent();   // 1282 — created ONCE

    let prdContent: string;
    if (isDelta) {
      try {
        prdContent = await loadDeltaPRD(sessionPath);   // 1295 — THE LOAD (item's anchor)
      } catch {
        throw new Error(`Delta session has no delta_prd.md … re-run to regenerate …`);
      }
    } else {
      prdContent = this.sessionManager.currentSession?.prdSnapshot ?? '';
    }

    // ◀◀◀ INSERT THE GUARD HERE (delta-only), right before createArchitectPrompt.
    const architectPrompt = createArchitectPrompt(prdContent, sessionPath);   // 1309 — architect consumption
    … retryAgentPrompt(() => architectAgent.prompt(architectPrompt), …)       // 1314 — THE architect call
  } catch (error) { … isFatalError … #trackFailure … currentPhase='prd_decomposition_failed' }
}
```

**Insertion = a delta-scoped `if (isDelta)` block immediately before
`createArchitectPrompt` (line ~1309).** This matches the item's "immediately
AFTER `loadDeltaPRD` and BEFORE building the architect prompt."

## 4. CRITICAL design decision: the guard is DELTA-ONLY

`prdContent` is EITHER the generated `delta_prd.md` (delta path) OR the
**full human-authored PRD** (non-delta path: `currentSession.prdSnapshot`).
§4.3 scopes the CLEAN/DIRTY classifier to "**generated** artifacts (e.g., the
delta PRD)". The full PRD is human-authored — classifying it would (a) be
semantically wrong and (b) block EVERY initial breakdown on classifier
availability (classifier-down → DIRTY → abort every new session). Therefore the
guard MUST be wrapped in `if (isDelta)`. This is locked by an explicit
"does NOT classify on a non-delta session" test.

## 5. classifyArtifactWithRetry signature (change-classifier.ts:257 — READ-ONLY)

```ts
export async function classifyArtifactWithRetry(content: string): Promise<'CLEAN'|'DIRTY'>;
```
- Owns its retry + exhaustion handling (catch → `return 'DIRTY'` + warn). NEVER
  throws in normal operation. (So NO pipeline-level try/catch is needed around it
  — unlike P1.M2.T1.S2's `classifyChangeWithRetry` reject test. The DIRTY path
  IS the exhaustion path.)
- **Requires PiHarness initialized** — in UNIT tests it is MOCKED, so no harness
  needed. The mock returns CLEAN/DIRTY directly.

## 6. Unit-test scaffolding (tests/unit/workflows/prp-pipeline.test.ts)

**THREE existing mocks to EXTEND (not replace):**
1. `vi.mock('../../../src/core/change-classifier.js', …)` (~56) currently returns
   `{ classifyChangeWithRetry: vi.fn() }`. **ADD** `classifyArtifactWithRetry: vi.fn()`.
   Then `import { classifyArtifactWithRetry } from '…change-classifier.js'` + a
   `const mockClassifyArtifact = classifyArtifactWithRetry as unknown as ReturnType<typeof vi.fn>;`
   handle. In `beforeEach`: `mockClassifyArtifact.mockResolvedValue('CLEAN');`
   (safe default → proceeds; mirrors S2's SUBSTANTIVE default).
2. `vi.mock('../../../src/core/session-utils.js', async importOriginal => …)`
   (~36) spreads `...actual` then overrides `resolvePRD`/`writeDeltaPRD`. **ADD**
   `loadDeltaPRD: vi.fn().mockResolvedValue('# Sample delta PRD content'),` so
   the delta path's `loadDeltaPRD(sessionPath)` returns sample content (no real
   I/O). (Spread order: `...actual` first, then the override — the override wins.)
3. `createMockSessionManager` (line ~301) — **no change** (`parentSession` lives
   on the session metadata, not the manager).

**Building a DELTA session** — `createTestSession` (264) hardcodes
`parentSession: null`. Build a delta session inline via spread:
```ts
const base = createTestSession(createTestBacklog([]));
const deltaSession: SessionState = {
  ...base,
  metadata: { ...base.metadata, parentSession: '/plan/000_prev' }, // isDelta === true
};
```

**THREE new tests under `describe('decomposePRD')` (line 423):**
- **CLEAN (delta → proceeds to architect):** delta session;
  `mockClassifyArtifact.mockResolvedValueOnce('CLEAN')`;
  `mockCreateArchitectAgent.mockReturnValue({ prompt: vi.fn().mockResolvedValue({ status:'success', output:'' }) })`;
  `mockReadFile.mockResolvedValueOnce(JSON.stringify({ backlog: [] }))`;
  `await pipeline.decomposePRD()`; assert `mockClassifyArtifact` called with the
  sample content; `mockCreateArchitectAgent` called; `currentPhase === 'prd_decomposed'`.
  (Mirrors the existing "reuses the same single Architect agent instance" test's
  setup at line ~496 for the architect-success path.)
- **DIRTY (delta → abort, architect NOT called):** delta session;
  `mockClassifyArtifact.mockResolvedValueOnce('DIRTY')`;
  `await pipeline.decomposePRD()` resolves (non-fatal catch); assert
  `mockClassifyArtifact` called; `mockCreateArchitectAgent` NOT called;
  `currentPhase === 'prd_decomposition_failed'`; `logger.warn` called.
- **non-delta (full PRD NEVER classified):** non-delta session
  (`createTestSession(createTestBacklog([]))` → `parentSession: null` → empty
  backlog → generation path); assert `mockClassifyArtifact` NOT called (locks
  the delta-only design); `mockCreateArchitectAgent` called. (The existing
  "should call createArchitectAgent for new session" test at 448 already covers
  the non-delta path behaviorally; this test adds the explicit
  `mockClassifyArtifact` not-called assertion.)

**Coverage:** the guard's `if (isDelta)` true branch + `if (DIRTY)` both
branches are covered by the CLEAN/DIRTY tests; the `if (isDelta)` false branch
is covered by the existing non-delta decomposePRD tests (448/463) + the new
non-delta assertion. All branches exercised → no prp-pipeline.ts coverage drop.

## 7. JSDoc (Mode A) + commit-message requirement

- **Mode A doc artifact:** add/extend the JSDoc above `decomposePRD` (or a
  prominent note in the delta branch) documenting the artifact-classifier guard
  + the DIRTY action. The detailed rationale lives in the **inline comment
  block at the guard** (mirrors the existing rich inline comments in
  decomposePRD). NO `docs/*.md`.
- **Commit message MUST record** the action-on-DIRTY decision + rationale
  (per item LOGIC §3: "Record the chosen action + rationale in a code comment
  AND the commit message"): ABORT (logger.warn + throw → non-fatal catch →
  `prd_decomposition_failed`), chosen because §4.3's "never proceed unprotected"
  rules out warn-and-proceed; mirrors the loadDeltaPRD-missing +
  Architect-failed aborts; no infinite loop (delta spawn regenerates fresh).

## 8. Disjointness from siblings (verified)

- **P1.M2.T1.S2** (parallel) edits `initializeSession` (~781) + the
  `handleDelta` JSDoc (~845) + mocks `classifyChangeWithRetry`. This item edits
  `decomposePRD` (~1309) + mocks `classifyArtifactWithRetry`. DIFFERENT
  functions, DIFFERENT JSDoc, DIFFERENT classifier mock handle — but SAME two
  files (`prp-pipeline.ts` + `prp-pipeline.test.ts`). Both extend the
  `change-classifier.js` mock (S2 adds `classifyChangeWithRetry`; this adds
  `classifyArtifactWithRetry`) — a clean additive merge (no overlap). The
  session-utils mock: S2 doesn't touch it; this adds `loadDeltaPRD` — additive.
  Coordinate: both add a `mock*` handle + a beforeEach default; no conflict.
- **P1.M2.T1.S1** (Complete) added `getChangeDiffSummary`/`absorbCosmeticChange`
  to SessionManager — NOT touched here.
- **change-classifier.ts** is READ-ONLY for both (import only).