# Research Note — P1.M2.T1.S1: Rewrite `createBaseConfig` test for provider-aware auth

Pure research (read-only). No files outside this research/ directory were modified.
HEAD at authoring time: on the D1 bugfix branch. All commands run from
`/home/dustin/projects/hacky-hack`.

## 0. THE D1 REGRESSION — exactly ONE failing test (live-confirmed)

```bash
$ npx vitest run tests/integration/agents.test.ts -t createBaseConfig
 FAIL  tests/integration/agents.test.ts > createBaseConfig > should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY
AssertionError: expected '' to be 'test-token-123' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed | 17 skipped (21)
```

**File:** `tests/integration/agents.test.ts`, inside `describe('createBaseConfig', …)` (block
starts **line 148**). The failing test is the FIRST `it(...)` in that block, **lines 154–168**:

```ts
  it('should map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-token-123');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
    const config = createBaseConfig('architect');
    expect(config.env.ANTHROPIC_API_KEY).toBe('test-token-123');   // ← FAILS: actual ''
    expect(config.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
  });
```

The **other 3** tests in the `createBaseConfig` describe block PASS (they don't assert the
API-key value — only `toHaveProperty('env')` and `maxTokens`). So the fix is to replace
**only this one `it(...)`** with the new provider-aware cases.

## 1. WHY it fails — the runtime contract changed (T2.S1 / commit a8ffac3)

`createBaseConfig()` in `src/agents/agent-factory.ts` (lines 174–176) now resolves the key
provider-aware instead of reading raw `process.env.ANTHROPIC_API_KEY`:

```ts
env: {
  ANTHROPIC_API_KEY: resolveApiKeyForProvider(getResolvedProvider()) ?? '',
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? '',
},
```

- `getResolvedProvider()` (`src/config/environment.ts:47`) = `getModel('sonnet').split('/')[0]`.
  With `ANTHROPIC_DEFAULT_SONNET_MODEL` **unset** → `getModel('sonnet')` = `'zai/glm-5.2'`
  → resolved provider = `'zai'` (the DEFAULT).
- `resolveApiKeyForProvider('zai')` (`src/config/harness.ts:67–99`) priority order:
  1. `options.override ?? process.env.PRP_API_KEY`
  2. provider-native env var → for `zai` that is `process.env.ZAI_API_KEY`
  3. `~/.pi/agent/auth.json` → deferred (returns `undefined` here)
  → it does **NOT** read `ANTHROPIC_API_KEY`.
- So stubbing only `ANTHROPIC_API_KEY='test-token-123'` (default zai provider) makes the
  resolver return `undefined` → terminal `?? ''` → `config.env.ANTHROPIC_API_KEY === ''`.

The resolver itself is correct and fully unit-tested
(`tests/unit/config/auth-resolver.test.ts`, 19 tests pass). This is **test-only churn**: the
integration test still asserts the OLD Anthropic-shell contract that T2.S1 deliberately removed.

## 2. HOW to switch the provider to `anthropic` in a test (the key mechanic)

`getResolvedProvider()` derives the provider from the resolved **sonnet** model string. To
force the `anthropic` provider, stub an already-qualified model override:

```ts
vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4');
// → getModel('sonnet') = 'anthropic/claude-sonnet-4' (qualifyModel does NOT double-prefix)
// → getResolvedProvider() = 'anthropic'
```

This is the EXACT pattern already used in `tests/unit/config/environment.test.ts` (lines 33,
47, 60, 73) and `tests/unit/config/auth-resolver.test.ts` (`getResolvedProvider` describe).
`qualifyModel()` does not double-prefix an already-qualified name, so `'anthropic/claude-sonnet-4'`
passes through unchanged.

For the `anthropic` provider, `resolveApiKeyForProvider('anthropic')` checks:
`PRP_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → auth.json. So `ANTHROPIC_API_KEY`
IS honored for the anthropic provider (but NOT for zai).

## 3. THE CANONICAL STUBBING PATTERN (mirror `auth-resolver.test.ts` exactly)

The authoritative reference is `tests/unit/config/auth-resolver.test.ts`. Its pattern:

- `afterEach(() => vi.unstubAllEnvs())` — restores `vi.stubEnv`'d values.
- Use `delete process.env.X` for vars that must be ABSENT (so the resolver's "not configured"
  branch is hit). NOTE: `vi.unstubAllEnvs()` does NOT undo `delete` — that's acceptable and is
  exactly what the reference file does.
- Use `vi.stubEnv('X', val)` for vars that must be PRESENT.
- The resolver `.trim()`s every value and treats whitespace-only / empty as "not configured"
  (`if (envVal)` is falsy for `''`). So `vi.stubEnv('ZAI_API_KEY', '')` ≡ absent for the resolver.

The relevant reference cases (from `auth-resolver.test.ts`):

```ts
// zai, env var set, no override:
vi.stubEnv('ZAI_API_KEY', 'zai-key-123');
delete process.env.PRP_API_KEY;
resolveApiKeyForProvider('zai') === 'zai-key-123'

// no credential at all:
delete process.env.ZAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.PRP_API_KEY;
delete process.env.ANTHROPIC_OAUTH_TOKEN;
resolveApiKeyForProvider('zai') === undefined

// anthropic provider, API_KEY set:
vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
delete process.env.ANTHROPIC_OAUTH_TOKEN;
delete process.env.PRP_API_KEY;
resolveApiKeyForProvider('anthropic') === 'anthropic-key'
```

## 4. THE THREE REPLACEMENT CASES (the contract (a)/(b)/(c))

Mapping the contract's three cases onto the canonical pattern. Each calls
`createBaseConfig('architect')` and asserts `config.env.ANTHROPIC_API_KEY`.

**(a) DEFAULT zai path — `ZAI_API_KEY` resolved and forwarded as the SDK key:**
```ts
delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL; // default → zai
delete process.env.PRP_API_KEY;                     // no override
vi.stubEnv('ZAI_API_KEY', 'zai-test-key');
const config = createBaseConfig('architect');
expect(config.env.ANTHROPIC_API_KEY).toBe('zai-test-key');
```
(The resolver returns `'zai-test-key'`; createBaseConfig forwards it as `ANTHROPIC_API_KEY`
 — the field name the Groundswell SDK reads.)

**(b) anthropic provider override — `ANTHROPIC_API_KEY` honored (resolver DOES check it for anthropic):**
```ts
vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropic/claude-sonnet-4'); // → provider anthropic
vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
delete process.env.ANTHROPIC_OAUTH_TOKEN; // so API_KEY wins (OAUTH has precedence)
delete process.env.PRP_API_KEY;
const config = createBaseConfig('architect');
expect(config.env.ANTHROPIC_API_KEY).toBe('anthropic-test-key');
```

**(c) no credential configured — honest `''` default (terminal `?? ''`):**
```ts
delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL; // default → zai
delete process.env.PRP_API_KEY;
delete process.env.ZAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_OAUTH_TOKEN;
const config = createBaseConfig('architect');
expect(config.env.ANTHROPIC_API_KEY).toBe('');
```

## 5. SCOPE GUARDRAILS (don't break siblings, don't widen scope)

- **Replace ONLY the one failing `it(...)` (lines 154–168).** Keep the parent
  `describe('createBaseConfig')` block, its `afterEach(() => vi.unstubAllEnvs())`, and the
  other 3 passing tests (`should include all required AgentConfig properties`,
  `should set persona-specific token limits`, etc.) **untouched**. Verified live: those 3 pass.
- **Do NOT add model-name assertions.** In case (b), `config.model` becomes
  `'anthropic/claude-sonnet-4'` (because `getModel('sonnet')` returns the override). The stale
  `GLM-4.7` model assertions elsewhere in THIS file (lines 240/286/332/378) are a SEPARATE
  pre-existing issue (Category A) owned by **P1.M3.T1.S1**. Focus only on the auth key field.
- **Do NOT touch `src/agents/agent-factory.ts`.** The implementation is correct; this is
  test-only churn (contract OUTPUT: "Runtime behavior is unchanged").
- **Do NOT touch the other ~32 failing files / ~222 other failing tests.** They are
  pre-existing (test_triage.md Categories A/B/C) and out of scope for S1.
- The edit is `tests/integration/agents.test.ts` ONLY.

## 6. VERIFICATION COMMAND

```bash
npx vitest run tests/integration/agents.test.ts -t createBaseConfig
# Expected (after fix): Test Files 1 passed (1) | Tests 4 passed (the 3 new + the 2 untouched
#   siblings — actually the -t createBaseConfig filter selects the whole describe block).
# The single D1 regression failure is gone; no new failures introduced.
```

(The full `npm run validate` gate also depends on the ~222 pre-existing failures and the
P1.M3 work — NOT green after this S1 alone. S1's acceptance is the targeted command above.)
