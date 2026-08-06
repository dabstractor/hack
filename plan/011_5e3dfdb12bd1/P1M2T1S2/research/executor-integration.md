# Research: Integrate the detector into #runValidationGates (P1.M2.T1.S2)

Session 011, **PRD §9.9 REQ-G2 runtime layer** — the executor integration slice.
Verified against the working tree on 2026-08-06. All line numbers from the live tree.

## 1. S1 is COMPLETE — the detector exists + is green

`isNegatedFileExistenceGate(command: string): boolean` is exported from
**`src/agents/gate-semantics.ts:37`** (zero-dependency pure predicate; two anchored
regexes `LEADING_NEGATED_EXISTENCE` / `INNER_NEGATED_EXISTENCE`). Its table-driven
unit test `tests/unit/agents/gate-semantics.test.ts` is green (14/14). **S2 imports
it** — `import { isNegatedFileExistenceGate } from './gate-semantics.js';` — and does
NOT touch gate-semantics.ts. The detector returns `true` ONLY for the unambiguous
negated-existence forms (`! test -f|-e|-d X`, `test ! -f|-e|-d X`, `[ ! -f … ]`,
`! [ -f … ]`); `false` for negated content (`! grep …`), positive checks, ambiguous
(`test -n foo`), compound, and wrapped. (G2.2/G2.3 — conservative.)

## 2. The exact insertion site — `#runValidationGates` (prp-executor.ts:518-593)

```
for (const gate of sortedGates) {
  if (gate.manual || gate.command === null) {          // L528 — manual/null skip
    results.push({ …success:true, skipped:true, exitCode:null, timedOut:false… }); continue;
  }
  // ← INSERT NEUTRALIZATION BRANCH HERE (after L542, before L548)
  const result = await this.#bashMCP.execute_bash({ command: gate.command, cwd: process.cwd(), timeout:120000 }); // L548
  …gateResult…; results.push(gateResult);              // L554-564
  if (!gateResult.success) { break; }                  // L568 — stop on first failure
}
```

**Type-safety fact:** after the manual/null skip block (`if (gate.manual || gate.command === null) { … continue; }`),
TS narrows `gate.command` from `string | null` to **`string`** (the null case is
excluded). So `isNegatedFileExistenceGate(gate.command)` typechecks with NO cast —
place the branch AFTER the skip block, BEFORE `execute_bash`.

**The neutralization result MUST mirror the manual-skip shape EXACTLY** (L530-540):
`{ level, description, success:true, command:gate.command, stdout:'', stderr:'',
exitCode:null, skipped:true, timedOut:false }`. Identical shape ⇒ the existing
`allPassed = validationResults.every(r => r.success || r.skipped)` aggregation
(L421, L445) counts it as passed with **NO change to aggregation**.

## 3. The logger call — exact in-repo pattern

`this.#logger: Logger` (field L232; `getLogger('PRPExecutor')` at L261). The Logger
interface has `info(obj, msg?, ...args)` (logger.ts:91). The exact pattern is already
used at **prp-executor.ts:331**: `this.#logger.info({ prpTaskId: prp.taskId }, 'Starting PRP execution')`.
So the neutralization log is:
```ts
this.#logger.info(
  { level: gate.level, description: gate.description, command: gate.command },
  'non-monotonic negative-existence gate neutralized — file existence is owned by the task graph / is a cleanup step, not a terminal-state assertion (§9.9)'
);
```
(`info` not `warn` — neutralization is intended behavior, not a problem. The contract
allows "info/warn"; `info` matches the L331 precedent.)

## 4. No existing test breaks + coverage stays 100%

- The existing tests run REAL commands (`npm run lint`, `npm test`, …).
  `isNegatedFileExistenceGate('npm run lint')` → `false` → falls through to
  `execute_bash` unchanged. **Zero behavior change for non-negated commands.**
- Coverage: the new `if (isNegatedFileExistenceGate(...))` branch's TRUE side is
  exercised by the new G2.1 test; its FALSE side is exercised by EVERY existing test
  that runs a real gate (happy-path, manual-skip, sequential-order, stop-on-failure).
  So prp-executor.ts stays at 100% coverage as long as the G2.1 test runs.

## 5. Test mocking — mirror the existing suite EXACTLY

`tests/unit/agents/prp-executor.test.ts`:
- Top-of-file: `vi.mock('../../../src/tools/bash-mcp.js', () => ({ BashMCP: vi.fn().mockImplementation(() => ({ execute_bash: vi.fn() })) }))` (L36).
- `const mockBashMCP = BashMCP as any;` (L51).
- `beforeEach`: `mockExecuteBash = vi.fn(); mockBashMCP.mockImplementation(() => ({ execute_bash: mockExecuteBash }));` (L142-145).
- PRP factory: `createMockPRPDocument(taskId): PRPDocument` (L92) — 4 gates (L1 npm run lint, L2 npm test, L3 npm run test:integration, L4 manual/null).
- **Do NOT mock `gate-semantics.js`** — the REAL detector must classify the test commands (it's pure; no I/O). The executor imports it directly; vitest runs the real fn.

For the new tests, build custom PRPs by spreading the factory + overriding `validationGates`:
```ts
const prp: PRPDocument = { ...createMockPRPDocument('P1.M3.T1.S1'), validationGates: [ { level:1, description:'…', command:'! test -f src/hooks/index.ts', manual:false } ] };
```
Assert "execute_bash was/wasn't called for command X" via:
```ts
const calledCommands = mockExecuteBash.mock.calls.map(([args]: any) => args.command);
expect(calledCommands).not.toContain('! test -f src/hooks/index.ts');   // G2.1: NOT called
expect(calledCommands).toContain('! grep -q TODO src/x.ts');            // G2.2: IS called
```

## 6. The 3 required integration tests (contract item 4)

- **(a) G2.1 — neutralization:** PRP with a `! test -f src/hooks/index.ts` gate (+ a
  real gate so execute_bash is exercised). Coder success; execute_bash success.
  Assert: `outcome:'success'`; the negated gate's result is `skipped:true / success:true /
  exitCode:null`; `mockExecuteBash` was NOT called with that command; the real gate WAS called.
- **(b) G2.2 — negated content executes:** PRP with `! grep -q TODO src/x.ts`.
  Assert `mockExecuteBash` WAS called with it (executes normally; not neutralized).
- **(c) G2.3 — ambiguous executes:** PRP with `test -n foo`.
  Assert `mockExecuteBash` WAS called with it (executes normally).

## 7. Disjointness + scope

- S2 edits ONLY `src/agents/prp-executor.ts` (the import + the neutralization branch)
  + `tests/unit/agents/prp-executor.test.ts` (the 3 integration tests).
- S2 does NOT touch: `src/agents/gate-semantics.ts` (S1 — read-only import), `src/core/models.ts`
  (ValidationGate — NO schema change; the neutralization is runtime-only), `src/agents/prompts.ts`
  (REQ-G1 — P1.M1.*, Complete), the watchdog/terminal-abort logic (§9.3.2 — already correct),
  the pass/fail aggregation (`allPassed` — unchanged), or any `docs/*.md` (DOCS: none — the
  §9.9 contract is covered by Mode B in P1.M3.T1.S1).