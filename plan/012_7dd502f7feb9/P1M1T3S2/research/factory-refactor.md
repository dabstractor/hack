# Research Note — P1.M1.T3.S2: Refactor `createCommitMessageAgent` to accept dynamic system prompt

## 1. The exact current state of the factory

File: `src/agents/commit-message-agent.ts`. The factory is at the END of the file.

```ts
// L108  (signature — NO params today)
export function createCommitMessageAgent(): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: COMMIT_MESSAGE_SYSTEM,                 // L113 — HARDCODED, this is what changes
    maxTokens: 512,                                // L114 — UNCHANGED
    enableReflection: false,                       // UNCHANGED
    enableCache: false,                            // UNCHANGED
    stateless: true,                               // L117 — UNCHANGED
  };
  logger().debug(
    { persona: 'researcher', model: config.model },
    'Creating commit-message agent'
  );
  return createAgent(config);
}
```

- `COMMIT_MESSAGE_SYSTEM` is the module-private `plain` contract const (the existing imperative
  system prompt, ~L64–78). It is **UNCHANGED** by this task (T3.S1 may add NEW consts above the
  factory, but `COMMIT_MESSAGE_SYSTEM` itself is untouched).
- JSDoc on the factory spans ~L87–106 (the `/** ... */` block immediately above `export function`).

## 2. The exact change (from item description + architecture §F1.E)

```ts
export function createCommitMessageAgent(systemPrompt?: string): Agent {
  const baseConfig = createBaseConfig('researcher', 'research');
  const config = {
    ...baseConfig,
    name: 'CommitMessageAgent',
    system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM,   // ← ONLY logic change
    maxTokens: 512,
    enableReflection: false,
    enableCache: false,
    stateless: true,
  };
  // ... logger + return unchanged
}
```

- The parameter is **OPTIONAL** (`systemPrompt?`). `?? COMMIT_MESSAGE_SYSTEM` means existing callers
  that pass nothing get **byte-for-byte identical behavior** (backward compatible).
- All other `config` fields (`name`, `model` via spread, `maxTokens`, `enableReflection`,
  `enableCache`, `stateless`, `env`/`harness` via spread) are UNCHANGED.

## 3. JSDoc update (Mode A — docs are part of THIS task, see item description §5 DOCS)

The factory's existing JSDoc (~L87–106) must be updated:
- Add a `@param systemPrompt` line documenting: optional custom system prompt; defaults to the
  `plain` contract (`COMMIT_MESSAGE_SYSTEM`) for backward compatibility; when provided, overrides the
  default (consumed by `generateCommitMessage` in P1.M1.T4.S1, which passes the style-resolved prompt
  from `buildCommitMessageSystemPrompt`).
- Update the `@example` block to show BOTH the no-arg form (default) AND the custom-prompt form.

## 4. Existing tests that MUST stay GREEN (backward compatibility)

File: `tests/unit/agents/commit-message-agent.test.ts`. The `describe('createCommitMessageAgent')`
block has 10 `it()` cases. **ALL call `createCommitMessageAgent()` with NO args.** After the refactor:

- `systemPrompt` is `undefined` → `system: undefined ?? COMMIT_MESSAGE_SYSTEM === COMMIT_MESSAGE_SYSTEM`.
- Every existing assertion still holds. **No existing test needs editing.** Key existing test:
  `should set a system prompt instructing a plain descriptive imperative summary` (L129) asserts
  `cfg.system` contains `'imperative'`, `'[PRP Auto]'`, `'Co-Authored-By'` and does NOT match the
  Conventional-Commit mandates — all of which are properties of `COMMIT_MESSAGE_SYSTEM`, so it stays
  GREEN untouched.

Mock setup in the test file (unchanged, works for the new test too):
- `vi.mock('../../../src/agents/agent-factory.js', …)` → `createBaseConfig` returns a fixed fixture.
- `vi.mock('groundswell', …)` → `createAgent: vi.fn((cfg) => ({ __cfg: cfg }))` — captures the config
  so tests read `mockCreateAgent.mock.calls[0][0]`.

## 5. New test to ADD

Add ONE `it()` case inside the existing `describe('createCommitMessageAgent')` block asserting the
passthrough:

```ts
it('should use a supplied systemPrompt when provided (dynamic prompt passthrough)', () => {
  const custom = 'CUSTOM PLAIN CONTRACT TEXT';
  createCommitMessageAgent(custom);
  const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { system: string };
  expect(cfg.system).toBe(custom);
});

it('should default to the plain COMMIT_MESSAGE_SYSTEM when no prompt is supplied (backward compat)', () => {
  createCommitMessageAgent();
  const cfg = mockCreateAgent.mock.calls.at(-1)![0] as { system: string };
  // The default path must equal the plain contract — assert an identifying substring, not the whole
  // (huge) const, to stay robust to cosmetic edits.
  expect(cfg.system).toContain('imperative');
  expect(cfg.system).toContain('HARD RULES');
});
```

Use `mockCreateAgent.mock.calls.at(-1)` (or `.lastCall`) so the new case does not depend on test
ordering relative to the 10 existing cases that also populate `.mock.calls`.

## 6. Backward-compat across OTHER test files (verified — no breakage)

- `tests/unit/utils/git-commit.test.ts` (L31, L64, L85): mocks the whole module with
  `{ createCommitMessageAgent: vi.fn() }` and reads `mockCreateCommitMessageAgent`. Adding an
  **optional** parameter does not change call arity for existing callers → these stay GREEN.
- `tests/unit/protected-files.test.ts` (L34): same `vi.fn()` module mock → unaffected.
- `src/utils/git-commit.ts` (L37 import, L321 call): calls `createCommitMessageAgent()` with NO args
  today → still valid (optional param). T4.S1 will change this call site to pass the resolved prompt;
  that is OUT OF SCOPE for T3.S2.

## 7. Relationship to parallel T3.S1 (read as a CONTRACT)

T3.S1 adds `buildCommitMessageSystemPrompt(style, examples?)` + several NEW module-private consts to
the SAME file, placed AFTER `COMMIT_MESSAGE_SYSTEM` and BEFORE `createCommitMessageAgent`. It does
NOT touch the factory or `COMMIT_MESSAGE_SYSTEM`. Therefore at T3.S2 execution time the factory will
sit a few lines lower in the file, but its content is identical to today. **The T3.S2 executor must
locate `createCommitMessageAgent` by its export (grep), not by stale line numbers.** T3.S2's job is
purely: signature + `system:` line + JSDoc + one test case. It consumes the OUTPUT of
`buildCommitMessageSystemPrompt` only conceptually (T4.S1 actually wires the two together).

## 8. Validation commands (verified present in package.json)

```bash
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check **/*.{ts,js,json,md,yml,yaml} — clean
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # targeted: new + 10 existing GREEN
npm run test:run       # full suite (optional sanity; T3.S2 touches only the factory + its test file)
```

## 9. Risk assessment

- **Extremely low risk.** One optional parameter + a `??` default + JSDoc + one test. The change is
  strictly backward compatible (existing no-arg callers get identical behavior by construction of `??`).
- **No new files, no new deps, no env reads, no I/O.** The factory still receives a resolved string;
  style resolution + example fetching live in T4.S1 (out of scope).
- **Confidence: 9.5/10** for one-pass success — the only residual risk is a prettier/eslint nit on the
  edited JSDoc, trivially fixed by `npm run format`.