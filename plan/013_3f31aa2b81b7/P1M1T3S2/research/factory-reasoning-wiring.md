# Research Note — P1.M1.T3.S2: Wire non-QA factories + `createQAAgent(level)` + commit-message-agent

## 0. Predecessor contract (S1, being implemented in parallel — read as TRUTH)

S1 changes `createBaseConfig` to `(persona, role='research', thinking: ThinkingLevel): AgentConfig` — a
**REQUIRED** `thinking` param composed onto the config INDEPENDENT of tier. S1 also strips `thinking`
from `ROLE_CONFIG` (now tier-only) and updates createBaseConfig/ROLE_CONFIG/ThinkingLevel JSDoc.
**S1 leaves 6 src call sites as deliberate TS2554 errors** — those are exactly what S2 wires:
`agent-factory.ts` (createArchitectAgent/Researcher/Coder/QA/Cleanup) + `commit-message-agent.ts:361`.

So at S2 execution time: the createBaseConfig/ROLE_CONFIG region is already S1-correct; S2's job is the
6 FACTORY/caller sites + the createQAAgent signature + JSDoc + tests.

## 1. The getters (T1.S2 — Complete, READY to consume)

All in `src/config/constants.ts`, exported. Pure env reads (no module-state caching — `resolveReasoningLevel`
reads `process.env` at CALL time), case-insensitive, empty→default. Defaults:

| Getter                  | Env var                          | Default | Used by S2          |
| ----------------------- | -------------------------------- | ------- | ------------------- |
| `getReasoningBreakdown` | `PRP_REASONING_BREAKDOWN_AGENT`  | `'high'`| createArchitectAgent|
| `getReasoningAgent`     | `PRP_REASONING_AGENT`            | `'high'`| createResearcherAgent|
| `getReasoningImpl`      | `PRP_REASONING_IMPL_AGENT`       | `'off'` | createCoderAgent    |
| `getReasoningBugFinder` | `PRP_REASONING_BUG_FINDER_AGENT` | `'high'`| S3 (call site)      |
| `getReasoningValidation`| `PRP_REASONING_VALIDATION_AGENT` | `'high'`| S3 (call site)      |

- **S2 imports only 3** into `agent-factory.ts`: `getReasoningBreakdown`, `getReasoningAgent`,
  `getReasoningImpl` (bugFinder/validation are consumed at the createQAAgent CALL SITES in S3, not in
  the factory — createQAAgent takes a level PARAMETER).
- `ReasoningLevel` type is ALREADY imported at `agent-factory.ts:34`
  (`import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';`). Add the 3 getters
  to that SAME import line.
- `ThinkingLevel === ReasoningLevel` (T1.S3 alias), so passing a `getReasoning*()` result (ReasoningLevel)
  into `createBaseConfig(..., thinking: ThinkingLevel)` is type-compatible. createQAAgent's param is typed
  `ReasoningLevel` per the item + integration-points §C.

## 2. The 6 edits (agent-factory.ts + commit-message-agent.ts)

### 2a. Import (agent-factory.ts:34)
```ts
// BEFORE:
import { getBugFinderAgent, type ReasoningLevel } from '../config/constants.js';
// AFTER:
import {
  getBugFinderAgent,
  getReasoningAgent,
  getReasoningBreakdown,
  getReasoningImpl,
  type ReasoningLevel,
} from '../config/constants.js';
```

### 2b. The 5 factories (each adds the 3rd createBaseConfig arg)
| Factory (~line)    | BEFORE                                       | AFTER                                                                  |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| createArchitectAgent (~348) | `createBaseConfig('architect', 'reasoning')` | `createBaseConfig('architect', 'reasoning', getReasoningBreakdown())`  |
| createResearcherAgent (~384)| `createBaseConfig('researcher', 'research')` | `createBaseConfig('researcher', 'research', getReasoningAgent())`      |
| createCoderAgent (~416)     | `createBaseConfig('coder', 'implementation')`| `createBaseConfig('coder', 'implementation', getReasoningImpl())`      |
| createCleanupAgent (~498)   | `createBaseConfig('cleanup', 'implementation')`| `createBaseConfig('cleanup', 'implementation', 'off')` // HARDCODE    |
| createQAAgent (~453)        | signature `(): Agent`; body `createBaseConfig('qa', 'reasoning')` | signature `(reasoningLevel: ReasoningLevel): Agent`; body `createBaseConfig('qa', 'reasoning', reasoningLevel)` |

- **Cleanup `→ 'off'` is HARDCODED, NOT `getReasoningImpl()`** (item: "mechanical reorg; HARDCODE 'off',
  documented — NOT coupled to PRP_REASONING_IMPL_AGENT"). Reason: cleanup is a mechanical reorg, and
  coupling it to the impl getter would make `PRP_REASONING_IMPL_AGENT=high` accidentally turn reasoning
  on for cleanup. Document this decision in the JSDoc.
- **createQAAgent** no longer calls a getter — it RECEIVES the level as a required param. The
  bug-finder-vs-validation split (which getter to pass) lives at the CALL SITES (S3). createQAAgent's
  `logger().debug({ ... bugFinderAgent: getBugFinderAgent() })` line stays UNCHANGED (observability only).
- All other config overrides in each factory (`system`, `mcps`, `enableReflection`, `enableCache`,
  `name`, `maxTokens`) are UNCHANGED.

### 2c. commit-message-agent.ts:361
```ts
// BEFORE:
const baseConfig = createBaseConfig('researcher', 'research');
// AFTER:
const baseConfig = createBaseConfig('researcher', 'research', 'off'); // single-shot commit messages (§9.2.9)
```
HARDCODE `'off'` (item: "single-shot commit messages; HARDCODE 'off', documented"). Same rationale as
cleanup — NOT coupled to `PRP_REASONING_IMPL_AGENT`.

## 3. JSDoc updates (Mode A — S2 scope = the 5 FACTORY blocks + commit-message-agent)

S2 owns the FACTORY JSDoc. S1 owns createBaseConfig/ROLE_CONFIG/ThinkingLevel JSDoc (its region). After
S1 lands, grep `xhigh` / `normal reasoning budget` — the createBaseConfig-region mentions (incl. L296
@example) are S1's; update ONLY the factory-function mentions:

- **createArchitectAgent** (~L347): "`xhigh` reasoning budget per PRD §6.1" → "`high` reasoning budget
  (default, configurable per §9.2.9 via `getReasoningBreakdown()` / `PRP_REASONING_BREAKDOWN_AGENT`)."
- **createResearcherAgent** (~L379): "normal reasoning budget per PRD §9.2.3" → "`high` reasoning budget
  (default, configurable per §9.2.9 via `getReasoningAgent()` / `PRP_REASONING_AGENT`)."
- **createCoderAgent** (~L411): "normal reasoning budget per PRD §9.2.3" → "`off` reasoning budget
  (default, configurable per §9.2.9 via `getReasoningImpl()` / `PRP_REASONING_IMPL_AGENT`)."
- **createQAAgent** (~L442-443): FULL REWRITE of the "balanced tier @ `xhigh`" / "`--thinking xhigh`" /
  "stays balanced @ `xhigh`" sentences → "The reasoning level is resolved by the CALLER per §9.2.9 and
  passed as `reasoningLevel` (the bug-finder vs validation split lives at the call sites). The balanced
  model tier is unchanged." Update the `@example` to `createQAAgent(getReasoningValidation())`.
- **createCleanupAgent** (~L478): "normal reasoning budget per PRD §9.2.3" → "`off` reasoning budget
  (hardcoded — cleanup is a mechanical reorg, NOT coupled to `PRP_REASONING_IMPL_AGENT`; documented per
  §9.2.9)."
- **commit-message-agent.ts** factory JSDoc: add a sentence noting `thinking: 'off'` is hardcoded
  (single-shot commit-message generation; not coupled to `PRP_REASONING_IMPL_AGENT`).

## 4. Test strategy — the KEY decision (config capture in agent-factory.test.ts)

### Problem
The existing `tests/unit/agents/agent-factory.test.ts` `describe('agent creation functions')` (L309) uses
the REAL `createAgent` from groundswell (NO `vi.mock('groundswell')` today). The factory tests assert
`agent.name === 'ArchitectAgent'` and `.not.toThrow()` — they do NOT capture the config object. So they
CANNOT read `config.thinking`. But the item requires "each factory's config.thinking equals its getter
default."

### Solution: a delegating `createAgent` spy
Introduce a `vi.mock('groundswell', …)` at the top of `agent-factory.test.ts` that wraps (does NOT
replace) the real `createAgent` — it records the cfg arg AND delegates to the real implementation:

```ts
vi.mock('groundswell', async importOriginal => {
  const actual = await importOriginal<typeof import('groundswell')>();
  return {
    ...actual, // preserve MCPHandler / MCPServer / etc. (agent-factory imports them)
    createAgent: vi.fn((cfg: unknown) => actual.createAgent(cfg)), // spy: capture cfg + delegate
  };
});
// near the existing imports:
import { createAgent } from 'groundswell';
const mockCreateAgent = vi.mocked(createAgent);
```

- **Why delegate (not capture-only)?** A capture-only mock (`cfg => ({ __cfg: cfg })`) would return an
  object WITHOUT `.name`, breaking the existing `agent.name === 'ArchitectAgent'` tests AND hollowing out
  the MCP-registration regression test (L321). Delegating to `actual.createAgent` preserves ALL existing
  coverage (real agent creation, `.name`, MCP registration) while ALSO recording cfg in
  `mockCreateAgent.mock.calls[i][0]`.
- This mirrors `cleanup-agent.test.ts`'s `vi.mock('groundswell', async importOriginal => ({ ...actual,
  createAgent: vi.fn(cfg => ({ __cfg: cfg })) }))` pattern — but delegates instead of stubbing, because
  agent-factory.test.ts has existing real-createAgent tests to keep green.

### New describe block in agent-factory.test.ts
```ts
describe('factory reasoning wiring (PRD §9.2.9 / P1.M1.T3.S2)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.test.com');
  });

  it('createArchitectAgent: thinking=getReasoningBreakdown() default (high), model stays balanced', () => {
    createArchitectAgent();
    const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string; model: string };
    expect(cfg.thinking).toBe('high');          // DEFAULT_REASONING_BREAKDOWN_AGENT, env unset
    expect(cfg.model).toBe('zai/glm-5.2');      // reasoning role → balanced tier (decoupling)
  });

  it('createArchitectAgent honors PRP_REASONING_BREAKDOWN_AGENT override', () => {
    vi.stubEnv('PRP_REASONING_BREAKDOWN_AGENT', 'xhigh');
    createArchitectAgent();
    const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string };
    expect(cfg.thinking).toBe('xhigh');
  });

  // same pattern for createResearcherAgent (getReasoningAgent → high / PRP_REASONING_AGENT)
  //   and createCoderAgent (getReasoningImpl → off / PRP_REASONING_IMPL_AGENT; model zai/glm-5-turbo)

  it('createCoderAgent: thinking=off default + model stays fast-tier even when PRP_REASONING_IMPL_AGENT=high (decoupling)', () => {
    vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high'); // try to turn impl reasoning on
    createCoderAgent();
    const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string; model: string };
    expect(cfg.thinking).toBe('high');          // coder honors its own getter
    expect(cfg.model).toBe('zai/glm-5-turbo');  // …but the MODEL tier is unchanged (decoupling)
  });

  it('createCleanupAgent: thinking hardcoded off — NOT coupled to PRP_REASONING_IMPL_AGENT', () => {
    vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high'); // must NOT affect cleanup
    createCleanupAgent();
    const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string; model: string };
    expect(cfg.thinking).toBe('off');           // HARDCODED
    expect(cfg.model).toBe('zai/glm-5-turbo');  // implementation tier
  });

  it('createQAAgent(reasoningLevel) stamps the passed level; model stays balanced', () => {
    createQAAgent('xhigh');
    const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { thinking: string; model: string };
    expect(cfg.thinking).toBe('xhigh');         // caller-supplied, not a getter
    expect(cfg.model).toBe('zai/glm-5.2');      // reasoning role → balanced tier
  });

  it('createQAAgent now REQUIRES a reasoningLevel arg (signature change)', () => {
    // @ts-expect-error — missing required arg (the S2 signature change)
    createQAAgent();
  });
});
```
- Read the LATEST captured cfg via `mockCreateAgent.mock.calls.at(-1)![0]` (order-independent — existing
  factory tests also populate `.mock.calls`).
- The file's existing top-level `afterEach(() => vi.unstubAllEnvs())` clears the env stubs.

### Existing factory tests that MUST be updated (signature now requires an arg)
- `agent-factory.test.ts` L326 (`createQAAgent()` in the MCP-regression test) → `createQAAgent('high')`.
- `agent-factory.test.ts` L349 (`createQAAgent()` in "should create QA agent successfully") → `createQAAgent('high')`.
- These are the ONLY existing edits to agent-factory.test.ts besides the new mock + new describe.
  (S1 owns the `createBaseConfig` + `model roles & reasoning budget` describes — do NOT touch those.)

## 5. Test strategy — commit-message-agent.test.ts + cleanup-agent.test.ts

### commit-message-agent.test.ts
It mocks the WHOLE `agent-factory.js` module (`vi.mock('…/agent-factory.js', () => ({ createBaseConfig: vi.fn(…) }))`).
The existing assertion L55-58:
```ts
expect(mockCreateBaseConfig).toHaveBeenCalledWith('researcher', 'research');
```
→ after S2 (commit-message-agent now calls `createBaseConfig('researcher', 'research', 'off')`):
```ts
expect(mockCreateBaseConfig).toHaveBeenCalledWith('researcher', 'research', 'off');
```
No other change to that file needed (the fixture returned by the mock has no `thinking`; the assertion is
on the CALL args). Optionally add a one-line it() asserting the 'off' decision is documented, but the
toHaveBeenCalledWith('off') is the load-bearing assertion.

### cleanup-agent.test.ts
It ALREADY mocks `groundswell.createAgent` to capture cfg (`mockCreateAgent.mock.calls[0][0]`). ADD one
`it()` asserting the hardcoded-off reasoning decision + decoupling:
```ts
it('should hardcode thinking off (NOT coupled to PRP_REASONING_IMPL_AGENT)', () => {
  vi.stubEnv('PRP_REASONING_IMPL_AGENT', 'high'); // must NOT affect cleanup
  mockCreateAgent.mockClear();
  createCleanupAgent();
  const cfg = mockCreateAgent.mock.calls[0][0] as { thinking: string; model: string };
  expect(cfg.thinking).toBe('off');
  expect(cfg.model).toBe('zai/glm-5-turbo');
});
```
(cleanup-agent.test.ts has no `vi.unstubAllEnvs` afterEach currently — but a single stubbed env that
leaks is low-risk; still, add `afterEach(() => vi.unstubAllEnvs())` for hygiene, OR use `vi.stubEnv`
which auto-restores under the default `unstubGlobals`. Prefer adding the afterEach to be safe. Note:
cleanup-agent.test.ts uses real `createCleanupAgent` + `createBaseConfig`, so `thinking` flows through
from the hardcoded `'off'`.)

## 6. The expected typecheck picture after S2 (analogous to S1's deliberate breakage)

- S1 left 6 TS2554 errors (createBaseConfig arity) — **S2 CLOSES all 6** (the 5 factories + commit-message).
- BUT S2 changes `createQAAgent()` → `createQAAgent(reasoningLevel)` (required arg). The ~5 PRODUCTION
  call sites (S3's scope) still call `createQAAgent()` with no args → **new TS2554 errors**, closed by S3:
  `bug-hunt-workflow.ts:273`, `validation-workflow.ts:235`, `delta-analysis-workflow.ts:121`,
  `change-classifier.ts:112` + `:161`.
- So after S2: `npm run typecheck` should be GREEN on the 6 S1 sites, and show TS2554 ONLY on the
  createQAAgent production call sites (S3). `npx vitest run` of the 3 targeted test files is GREEN (the
  test file's own createQAAgent() calls are updated to pass a level). Frame this exactly as S1 framed its
  breakage — do NOT "fix" the createQAAgent production call sites; that is S3.

## 7. Validation commands (verified in package.json)

```bash
npm run typecheck      # tsc --noEmit -p tsconfig.build.json (src-only; tests excluded)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check **/*.{ts,js,json,md,yml,yaml}
npx vitest run tests/unit/agents/agent-factory.test.ts tests/unit/agents/commit-message-agent.test.ts tests/unit/agents/cleanup-agent.test.ts
```

## 8. Risk assessment

- **Low-medium.** 6 mechanical wiring edits + 1 signature change + JSDoc + tests. The riskiest part is
  introducing the delegating `createAgent` spy in agent-factory.test.ts; mitigated by delegating to the
  real impl (preserves all existing green tests) rather than stubbing. The createQAAgent signature change
  produces expected S3-breakage at production call sites (by design, like S1→S2).
- **Confidence: 8.5/10** for one-pass success. Main residual risks: (a) the delegating spy interacting
  unexpectedly with Groundswell's real createAgent across many calls (low — existing suite already does
  this); (b) a stray `xhigh` JSDoc mention left in a factory block (grep-gated in Level 2); (c) forgetting
  to update one of the 2 existing createQAAgent() test calls (compile-gated by the new `@ts-expect-error`
  test which would itself error if createQAAgent still accepted 0 args — but it now requires an arg, so
  the bare `createQAAgent()` at L326/L349 must be fixed or vitest's esbuild will... actually esbuild
  strips types so a bare createQAAgent() RUNS with reasoningLevel=undefined → createBaseConfig gets
  undefined thinking → at runtime thinking=undefined, NOT a throw. So those 2 calls won't crash vitest but
  are semantically wrong. They MUST be updated to pass a level; gate them with grep in Level 2.)