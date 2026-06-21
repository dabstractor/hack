# Research — P1.M1.T1.S1 (harness/provider constants & types)

Curated findings that back the PRP. Read-only reference for the implementer.

## 1. Groundswell source-of-truth types (verified)

File: `~/projects/groundswell/src/types/harnesses.ts` (also summarized in
`plan/004_439241a82c24/architecture/external_deps.md §1`).

```ts
export type HarnessId = 'pi' | 'claude-code';

export type ModelProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'zai'
  | (string & {}); // OPEN SET — `(string & {})` idiom enables autocomplete + arbitrary strings
```

- `HarnessId` is closed: exactly `'pi' | 'claude-code'`.
- `ModelProviderId` is OPEN via the `(string & {})` idiom. The work-item contract specifies
  a narrower local mirror `ModelProvider = 'zai' | 'anthropic' | (string & {})` (zai first).
  Follow the contract literally — do not copy Groundswell's full union.

## 2. Existing config conventions (verified in src/config/)

- `constants.ts` uses `as const` to preserve literal types, plus JSDoc (`@remarks`, `@example`).
  Existing exports: `DEFAULT_BASE_URL`, `MODEL_NAMES`, `MODEL_ENV_VARS`, `REQUIRED_ENV_VARS`.
- `types.ts` exports `type ModelTier`, `interface EnvironmentConfig`, and
  `class EnvironmentValidationError extends Error` with:
  - `readonly missing: string[]`
  - `this.name = 'EnvironmentValidationError'`
  - JSDoc + `@example`.
- `environment.ts` RE-EXPORTS for convenience:
  `export type { ModelTier, EnvironmentConfig } from './types.js';`
  `export { EnvironmentValidationError } from './types.js';`
  → No native extends-Error prototype fixup needed (esnext target, Node 20+).

## 3. Test conventions (verified in tests/unit/config/environment.test.ts)

- Framework: vitest, `globals: true`, ESM `.js` import specifiers.
- Pattern: `describe`/`it`, SETUP/EXECUTE/VERIFY comment blocks, env via `vi.stubEnv`/`vi.unstubAllEnvs`.
- Error-class testing: `expect(() => fn()).toThrow(Cls)` + `instanceof` + read fields.
- vitest.config.ts enforces **100% coverage** (statements/branches/functions/lines) on `src/**/*.ts`
  → every new constructor line MUST be exercised by a test (instantiate the error class).

## 4. Validation gates (verified executable)

- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck`.
- `npm run test:run -- config` runs the `tests/unit/config/` suite (path substring filter).
- ESLint: NO `eslint-plugin-jsdoc` (JSDoc is convention, not enforced).
  `prettier/prettier: error` IS enforced → run `npm run format` / `npm run fix`.
  `@typescript-eslint/no-explicit-any: warn` (won't fail; the `(string & {})` idiom avoids `any` anyway).

## 5. Scope boundaries (from delta_impact.md)

- This subtask ONLY adds constants + types + error class + their unit tests. No env read,
  no `configureHarnesses()` call (that is S2), no model qualification (that is M1.T2).
- `HarnessProviderMismatchError` is DEFINED here but THROWN in S2 (agent-factory startup guard).
  Test only that the class carries the fields — do not wire it into any startup path here.
- Keep ALL existing exports in `constants.ts` and `types.ts` intact (append-only).
