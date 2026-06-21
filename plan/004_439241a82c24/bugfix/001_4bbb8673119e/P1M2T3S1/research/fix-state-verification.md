# Research Note — P1.M2.T3S1 Starting State Verification

> Captured during PRP research. Confirms all four bugfix issues already have their code-level
> fixes present in the tree (P1.M1.T1/T2 + P1.M2.T1/T2 marked Complete). This task's job is to
> RUN the gates and prove them green — NOT to re-implement.

## Verification snapshots (as of PRP authoring)

### Issue 1 — PiHarness registration (src/config/harness.ts, Step 4.5)
```ts
const registry = HarnessRegistry.getInstance();
if (!registry.has('pi')) {
  registry.register(new PiHarness());
}
```
- Import present: `import { configureHarnesses, PiHarness, HarnessRegistry } from 'groundswell';`
- Idempotent `has()` guard present (prevents "Provider 'pi' is already registered" on re-entry).

### Issue 2 — Resolved-provider guard (src/config/harness.ts, Step 4)
```ts
const resolvedProvider = getModel('sonnet').split('/')[0];
if (harness === 'claude-code' && resolvedProvider === 'zai') {
  throw new HarnessProviderMismatchError(harness, resolvedProvider);
}
```
- Replaces the old `DEFAULT_MODEL_PROVIDER === 'zai'` constant check.
- `getModel` imported from `./environment.js` (no circular import — environment.ts does not import harness.ts).

### Issue 4a — ToolExecutor adapters (9 call sites total)
| File | Lines | Count |
| --- | --- | --- |
| src/tools/bash-mcp.ts | 272 | 1 |
| src/tools/filesystem-mcp.ts | 516, 521, 526, 531 | 4 |
| src/tools/git-mcp.ts | 505, 508, 511, 514 | 4 |
Pattern at each site: `async (input: unknown) => fn(input as FooInput)` — assignable to
`MCPHandler`'s `(input: unknown) => Promise<unknown>`, no `as ToolExecutor` cast needed.

### Issue 4b — .prettierignore
Contains both `artifacts/` and `plan/` lines (verified via `grep -E '^(artifacts|plan)/$'`).

### Issue 3 — docs:lint toolchain
- `package.json` devDependencies: `"markdownlint-cli": "^0.49.0"` ✓
- `docs:lint` script: `markdownlint "docs/**/*.md"` ✓
- Binary installed: `node_modules/.bin/markdownlint` exists ✓
- `.markdownlint.json`: `{ default:true, MD013:false, MD024:{siblings_only:true}, MD036:false }` ✓
- `.markdownlintignore`: `docs/api/` ✓

### Prerequisites confirmed
- `.env` present (185 bytes, loaded by tests/setup.ts).
- `tsconfig.build.json`: `include:["src/**/*"]`, `exclude:["node_modules","dist","tests"]`.
- `vitest.config.ts`: coverage thresholds 100/100/100/100 on `src/**/*.ts`; groundswell alias → sibling checkout.

## Conclusion

All code-level fixes are in place. The remaining work is purely operational: run the six gates
in order, capture exit codes + signatures, write VALIDATION_EVIDENCE.md. No source edits should
be required. If any gate is red, see the PRP's "Validation Loop" table for the loopback target —
do not suppress.

## What was NOT verified (deliberately, to preserve the implementer's gate-of-record run)
- Did NOT run `npm run test:run` / `typecheck` / `lint` / `format:check` / `docs:lint` / `validate`
  during research. Running them here would (a) consume time, and (b) risk the implementer treating
  a research-pass output as the official evidence. The official green signatures must come from the
  implementer's captured run, written into VALIDATION_EVIDENCE.md.
