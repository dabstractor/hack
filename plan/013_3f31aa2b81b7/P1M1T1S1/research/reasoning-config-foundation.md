# Research — P1.M1.T1.S1 (ReasoningLevel type, vocabulary, ReasoningConfigError, validator)

Foundation for PRD §9.2.9 (Per-Role Reasoning Level). S1 = the type, the vocabulary
array, the 5 env-name constants + 5 defaults, the shared `resolveReasoningLevel`
validator, and the `ReasoningConfigError` typed error. Consumed by S2 (getters), T2
(.hack), T3 (factories), T4 (startup fail-fast).

## 1. Vocabulary alignment (verified — pi SDK == §9.2.9)

pi SDK `node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js:6`:
```js
const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
```
**IDENTICAL** to PRD §9.2.9 #2 (external-deps.md §2 confirms). So S1's `ReasoningLevel`
= `'off'|'minimal'|'low'|'medium'|'high'|'xhigh'` matches the pi SDK exactly. This is
why the agent-factory `ThinkingLevel` (S3) will later ADD `minimal` and DROP `max`
(today it diverges: `'off'|'low'|'medium'|'high'|'xhigh'|'max'`). S1 does NOT touch
agent-factory — it just defines the canonical `ReasoningLevel` S3 will alias to.

## 2. Patterns to mirror (verified file:line)

**Free-string getter** (`getValidationAgent`, constants.ts ~993-1004):
```ts
const raw = process.env[KEY];
if (raw === undefined) return DEFAULT;
const trimmed = raw.trim();
return trimmed === '' ? DEFAULT : trimmed;   // NO validation — free string
```
S1's `resolveReasoningLevel` ADDS: lowercase + vocabulary validation + hard-throw.
(The 5 per-role GETTERS in S2 will each be one-line wrappers around this validator.)

**Typed error** (`AuthPreflightError`, types.ts:219-237 + helper `buildPreflightMessage` :260):
```ts
export class AuthPreflightError extends Error {
  readonly harness: string; readonly provider: string; readonly model: string;
  constructor(opts: {...}) { super(buildPreflightMessage(opts)); this.name = 'AuthPreflightError'; ... }
}
```
`ReasoningConfigError` mirrors this: `this.name='ReasoningConfigError'`, readonly
`key`+`value`, message via a module-local `buildReasoningErrorMessage` helper.
`HackConfigError` (types.ts:241) is the simpler `extends Error { this.name=… }` form —
use the richer AuthPreflightError form (it carries the offending key+value fields).

## 3. ⚠️ Import direction (verified cycle-free)

- `constants.ts` does NOT import `types.ts` today; `types.ts` does NOT import `constants.ts`.
  They are independent.
- S1 makes `constants.ts` import `ReasoningConfigError` from `types.ts` (one-directional).
  This is SAFE — `types.ts` does not import `constants.ts`, so NO cycle. (The established
  "getter-that-throws" module is `harness.ts`, which imports both — but the contract puts
  `resolveReasoningLevel` in `constants.ts`, so constants.ts gains the types.ts import.)

## 4. The new symbols (verbatim shapes)

**constants.ts — new `// Reasoning Configuration (PRD §9.2.9)` section:**
```ts
import { ReasoningConfigError } from './types.js';   // NEW one-directional import (cycle-free)

export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export const PRP_REASONING_AGENT = 'PRP_REASONING_AGENT';
export const PRP_REASONING_BREAKDOWN_AGENT = 'PRP_REASONING_BREAKDOWN_AGENT';
export const PRP_REASONING_BUG_FINDER_AGENT = 'PRP_REASONING_BUG_FINDER_AGENT';
export const PRP_REASONING_VALIDATION_AGENT = 'PRP_REASONING_VALIDATION_AGENT';
export const PRP_REASONING_IMPL_AGENT = 'PRP_REASONING_IMPL_AGENT';

export const DEFAULT_REASONING_AGENT = 'high' as const;
export const DEFAULT_REASONING_BREAKDOWN_AGENT = 'high' as const;
export const DEFAULT_REASONING_BUG_FINDER_AGENT = 'high' as const;
export const DEFAULT_REASONING_VALIDATION_AGENT = 'high' as const;
export const DEFAULT_REASONING_IMPL_AGENT = 'off' as const;

export function resolveReasoningLevel(
  raw: string | undefined,
  envKey: string,
  defaultLevel: ReasoningLevel
): ReasoningLevel {
  if (raw === undefined) return defaultLevel;
  const trimmed = raw.trim();
  if (trimmed === '') return defaultLevel;
  const lowered = trimmed.toLowerCase();
  if (!(REASONING_LEVELS as readonly string[]).includes(lowered)) {
    throw new ReasoningConfigError({ key: envKey, value: raw });
  }
  return lowered as ReasoningLevel;
}
```

**types.ts — new error class + helper:**
```ts
export class ReasoningConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(opts: { key: string; value: string }) {
    super(buildReasoningErrorMessage(opts));
    this.name = 'ReasoningConfigError';
    this.key = opts.key;
    this.value = opts.value;
  }
}

function buildReasoningErrorMessage(opts: { key: string; value: string }): string {
  return `Invalid reasoning level for '${opts.key}': '${opts.value}'. Accepted (case-insensitive): off, minimal, low, medium, high, xhigh.`;
}
```

## 5. S1 scope boundary (do NOT do these — sibling subtasks)

- S2: the 5 per-role getters (`getReasoningAgent()` etc.) — one-line wrappers around
  `resolveReasoningLevel(process.env[KEY], KEY, DEFAULT_REASONING_*)`.
- S3: agent-factory `ThinkingLevel` reconcile (alias `ReasoningLevel`, add `minimal`, drop `max`).
- T2: `.hack` schema wiring (5 `[reasoning]` SCHEMA_MAP entries).
- T4: startup `validateAllReasoningLevels()` + `main().catch` ReasoningConfigError arm.
- S4: `.env.example` Reasoning Levels subsection.
S1 = type + vocabulary + 5 env names + 5 defaults + validator + error class + tests ONLY.

## 6. Tests (TDD, in tests/unit/config/constants.test.ts per contract)

Cases (cover every branch for 100% coverage):
- `resolveReasoningLevel(undefined, KEY, 'high')` → `'high'` (unset → default).
- `resolveReasoningLevel('', KEY, 'high')` → `'high'` (empty → default).
- `resolveReasoningLevel('   ', KEY, 'high')` → `'high'` (whitespace → default).
- `resolveReasoningLevel('high', KEY, 'high')` → `'high'`.
- `resolveReasoningLevel('HIGH', KEY, 'high')` → `'high'` (case-insensitive accept).
- `resolveReasoningLevel('xHigh', KEY, 'off')` → `'xhigh'` (case-fold + non-default defaultLevel).
- `resolveReasoningLevel('ultra', KEY, 'high')` → throws `ReasoningConfigError`; assert
  `instanceof Error`, `.name === 'ReasoningConfigError'`, `.key === KEY`, `.value === 'ultra'`,
  message contains KEY + 'ultra' + the accepted-levels list.
- `resolveReasoningLevel('yes', KEY, 'high')` → throws (another invalid token).
- `REASONING_LEVELS` equals the 6 expected lowercase tokens.
- `ReasoningConfigError` direct construction: carries key+value, name set.

## 7. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean (the new constants→types
  import is cycle-free; `as ReasoningLevel`/`as readonly string[]` casts satisfy the tuple type).
- `npm run lint && npm run format:check` — clean (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/config/constants.test.ts` — green; new branches at 100%.
- Existing config tests unaffected (S1 is additive — no change to existing getters/types).