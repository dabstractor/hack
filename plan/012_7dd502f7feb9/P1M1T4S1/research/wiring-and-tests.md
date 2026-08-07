# Research Notes — P1.M1.T4.S1

## Wire Style Resolution into `generateCommitMessage`

The final wiring subtask of the Commit Message Style Layer. Closes the data path:
`PRP_COMMIT_STYLE` env → `getPrpCommitStyle()` → (if auto) `getRecentCommitMessages(N)`
→ `buildCommitMessageSystemPrompt(style, examples)` → `createCommitMessageAgent(system)`.

---

## 1. Exact current state of `generateCommitMessage` (src/utils/git-commit.ts ~L290–328)

```ts
export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff || !diff.trim()) {
    throw new AgentError(
      'stagecoach commit-message generation failed: empty staged diff'
    );
  }
  const agent = createCommitMessageAgent();          // ← L321, the line that changes
  const prompt = createPrompt({
    user: buildCommitMessageUserPrompt(diff),
    responseFormat: z.string(),
  });
  const r = await agent.prompt(prompt);
  if (r.status === 'error') {
    throw new AgentError(
      `stagecoach commit-message generation failed: ${r.error?.message ?? 'unknown agent error'}`
    );
  }
  const message = (r.data ?? '').trim();
  if (!message || message === 'skip') {
    throw new AgentError(
      'stagecoach commit-message generation failed: empty agent output'
    );
  }
  return message;
}
```

**Everything AFTER the `const agent = …` line is UNCHANGED.** Only the block
between the empty-diff guard and `const prompt = …` is inserted (style resolution),
plus the `createCommitMessageAgent()` → `createCommitMessageAgent(system)` arg.

## 2. Exact current imports (src/utils/git-commit.ts L23–44)

```ts
import {
  gitStatus,
  gitAdd,
  gitCommit,
  gitDiff,
  gitListStagedDeletions,
  gitRestoreFileFromHead,
  gitUnstagePath,
} from '../tools/git-mcp.js';
import { basename } from 'node:path';
import { getLogger, type Logger } from './logger.js';
import { AgentError, isAgentError, toErrorMessage } from './errors.js';
import { createPrompt } from 'groundswell';
import { z } from 'zod';
import { createCommitMessageAgent } from '../agents/commit-message-agent.js';
import { retry, createDefaultOnRetry } from './retry.js';
import {
  getCommitRetryMax,
  getCommitRetryDelayMs,
  getCommitRetryDelayCapMs,
  getPrpCommitFormat,
} from '../config/constants.js';
```

**Three import edits required:**
1. Add `getRecentCommitMessages` to the git-mcp import (L23–31).
2. Add `buildCommitMessageSystemPrompt` to the commit-message-agent import (L37).
3. Add `getPrpCommitStyle, getPrpCommitStyleExamples` to the constants import (L39–44),
   PLUS a new `import type { PrpCommitStyle } from '../config/constants.js';`.

## 3. Input contracts (all VERIFIED to exist in working tree)

| Symbol | Source file | Verified signature |
|--------|-------------|--------------------|
| `getPrpCommitStyle()` | `src/config/constants.ts:851` | `(): PrpCommitStyle` — reads `process.env.PRP_COMMIT_STYLE` case-insensitively, defaults `'auto'` |
| `getPrpCommitStyleExamples()` | `src/config/constants.ts:919` | `(): number` — reads `process.env.PRP_COMMIT_STYLE_EXAMPLES`, allows `0`, defaults `5` |
| `PrpCommitStyle` (type) | `src/config/constants.ts:828` | `'auto' \| 'plain' \| 'conventional' \| 'gitmoji'` |
| `getRecentCommitMessages(count, repoPath?)` | `src/tools/git-mcp.ts:583` | `(count: number, repoPath?: string): Promise<string[]>` — `count===0` → `[]` (no git call); returns full messages newest-first |
| `buildCommitMessageSystemPrompt(style, examples?)` | `src/agents/commit-message-agent.ts` (T3.S1, COMPLETE) | `(style: PrpCommitStyle, examples?: readonly string[]): string` — pure; `auto` with `length>1` → META block, else → plain contract; explicit modes ignore examples |
| `createCommitMessageAgent(systemPrompt?)` | `src/agents/commit-message-agent.ts` (T3.S2, IN PROGRESS) | `(systemPrompt?: string): Agent` — `system: systemPrompt ?? COMMIT_MESSAGE_SYSTEM`. **Treat as a CONTRACT: assume T3.S2 lands exactly as specified.** |

## 4. Exact logic to insert (verbatim from item contract + architecture §F1.F)

```ts
  // === STYLE RESOLUTION (PRD §5.1 — P1.M1.T4.S1) ===
  const style = getPrpCommitStyle();
  let resolvedStyle: PrpCommitStyle = style;
  let examples: string[] | undefined;
  if (style === 'auto') {
    const n = getPrpCommitStyleExamples();
    if (n > 0) {
      examples = await getRecentCommitMessages(n);
    }
    // ≤1 commit (or EXAMPLES=0) → nothing to learn → degrade to plain (PRD §5.1)
    if (!examples || examples.length <= 1) {
      resolvedStyle = 'plain';
    }
  }
  const system = buildCommitMessageSystemPrompt(resolvedStyle, examples);
  const agent = createCommitMessageAgent(system);
```

**Key semantics (trace each branch):**
- `style === 'auto'`, `n > 0`, history `length > 1` → `resolvedStyle='auto'`, examples populated → builder produces the learned-style META block.
- `style === 'auto'`, `n > 0`, history `length <= 1` (fresh repo) → `examples` set but `<=1` → `resolvedStyle='plain'`, examples stays as the short array (builder ignores examples for plain).
- `style === 'auto'`, `n === 0` (EXAMPLES=0 disables) → examples stays `undefined` → `!examples` → `resolvedStyle='plain'`. `getRecentCommitMessages` is NEVER called (n>0 gate + the helper's own count===0 short-circuit).
- `style === 'plain'|'conventional'|'gitmoji'` → skip the whole `if` → builder uses the explicit contract, examples `undefined`.

`generateCommitMessage` is ALREADY `async`, so `await getRecentCommitMessages(n)` is fine.

## 5. Retry-boundary note (architecture §F1.F)

`generateCommitMessage` is wrapped by `retry()` inside `smartCommit` (the
`generateMessage` path). The NEW `getRecentCommitMessages(n)` call happens INSIDE
that retry boundary. This is ACCEPTABLE per the research note: `git log` is a fast
local operation (not a transient API call). On retry, the diff is re-read... NO —
the diff is read ONCE outside the retry closure and captured; only the
`generateCommitMessage(diff)` boundary repeats, which now ALSO repeats the git-log
call. That's fine: git log is cheap and local. No change to the retry structure.

**Do NOT move the diff-read or restructure smartCommit.** Only `generateCommitMessage`
body changes.

## 6. TEST IMPACT — the trickiest part (MUST update the mock)

`tests/unit/utils/git-commit.test.ts` has TWO module mocks that break once
`generateCommitMessage` adds the new imports:

### 6a. git-mcp mock (L16–25) — MUST add `getRecentCommitMessages`

Current:
```ts
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
  gitListStagedDeletions: vi.fn(),
  gitRestoreFileFromHead: vi.fn(),
  gitUnstagePath: vi.fn(),
}));
```
After: add `getRecentCommitMessages: vi.fn(),`. Because `vi.mock` REPLACES THE
ENTIRE MODULE, omitting it makes the import `undefined` → `getRecentCommitMessages
is not a function` at runtime.

Default behavior: with env unset, `getPrpCommitStyle()` returns `'auto'` and
`getPrpCommitStyleExamples()` returns `5`, so EVERY existing `generateCommitMessage`
success test now calls `getRecentCommitMessages(5)`. A bare `vi.fn()` returns
`undefined`; `await undefined` → `undefined`; then `!examples` → degrade to plain.
So existing tests pass even without a return-value default — BUT set
`mockGetRecentCommitMessages.mockResolvedValue([])` in `beforeEach` for determinism
(empty array → length 0 ≤ 1 → degrade to plain → builder gets 'plain').

### 6b. commit-message-agent mock (L27–29) — MUST add `buildCommitMessageSystemPrompt`

Current:
```ts
vi.mock('../../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
}));
```
After: add `buildCommitMessageSystemPrompt: vi.fn(),`. Same reason — full-module
replacement. Without it the import is `undefined` → throw.

`createCommitMessageAgent` mock stays `vi.fn()` (after T3.S2 it accepts an optional
arg; `vi.fn()` accepts any args and the existing `mockReturnValue(makeFakeAgent(...))`
overrides ignore the arg → existing tests stay GREEN).

### 6c. New imports in the test file's real-import block (~L83–95)

Add `getRecentCommitMessages` (from git-mcp) and `buildCommitMessageSystemPrompt`
(from commit-message-agent) to the real imports so `vi.mocked(...)` works:
```ts
import { /* existing git-mcp fns */, getRecentCommitMessages } from '../../../src/tools/git-mcp.js';
import { createCommitMessageAgent, buildCommitMessageSystemPrompt } from '../../../src/agents/commit-message-agent.js';
const mockGetRecentCommitMessages = vi.mocked(getRecentCommitMessages);
const mockBuildCommitMessageSystemPrompt = vi.mocked(buildCommitMessageSystemPrompt);
```

### 6d. Default mock returns in the top-level beforeEach (~L118)

Add after the existing `mockGitListStagedDeletions.mockResolvedValue(...)` defaults:
```ts
mockGetRecentCommitMessages.mockResolvedValue([]); // empty repo → auto degrades to plain
```
This guarantees the 13 existing `generateCommitMessage` tests (env unset → auto →
empty examples → plain) behave identically to today.

### 6e. Env hygiene for NEW style-resolution tests

Pattern to copy from the existing `formatCommitMessage` describe (L313–325): a
nested `beforeEach(() => { delete process.env.PRP_COMMIT_STYLE; })` + `afterEach(()
=> vi.unstubAllEnvs())` so a stubbed `PRP_COMMIT_STYLE` can't bleed into sibling
tests. Use `vi.stubEnv('PRP_COMMIT_STYLE', 'conventional')` etc.

## 7. New test cases to ADD (describe block inside the `generateCommitMessage` group)

Use `mockBuildCommitMessageSystemPrompt.mockImplementation((style, _ex) =>
\`MOCK[\${style}]\`)` so each case asserts the RESOLVED style flowed to the factory:

| Case | env / mocks | assert |
|------|-------------|--------|
| auto + >1 examples | style unset (auto), getRecentCommitMessages → ['a','b','c'] | factory called with 'MOCK[auto]'; getRecentCommitMessages called once with 5 (default) |
| auto + ≤1 examples (fresh repo) | style unset, getRecentCommitMessages → ['only-one'] | factory called with 'MOCK[plain]' (degraded) |
| auto + EXAMPLES=0 | stubEnv PRP_COMMIT_STYLE_EXAMPLES=0 | getRecentCommitMessages NOT called; factory called with 'MOCK[plain]' |
| explicit plain | stubEnv PRP_COMMIT_STYLE=plain | getRecentCommitMessages NOT called; factory 'MOCK[plain]' |
| explicit conventional | stubEnv PRP_COMMIT_STYLE=conventional | getRecentCommitMessages NOT called; factory 'MOCK[conventional]' |
| explicit gitmoji | stubEnv PRP_COMMIT_STYLE=gitmoji | getRecentCommitMessages NOT called; factory 'MOCK[gitmoji]' |
| custom EXAMPLES count flows | stubEnv PRP_COMMIT_STYLE_EXAMPLES=3, getRecentCommitMessages → ['a','b','c'] | getRecentCommitMessages called with 3 |

Assertion shape (mirror existing factory-call assertions):
```ts
expect(mockCreateCommitMessageAgent).toHaveBeenCalledWith('MOCK[conventional]');
expect(mockGetRecentCommitMessages).not.toHaveBeenCalled();
```
Each case wires `mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent({...}))`
so `agent.prompt` resolves — same helper as existing tests.

## 8. Boundary / do-not-touch list

- `formatCommitMessage` — UNCHANGED (layers position prefix afterward; orthogonal).
- `buildFallbackCommitMessage` + the retry/fallback structure in `smartCommit` — UNCHANGED.
- `restore_critical_files` — UNCHANGED.
- `createCommitMessageAgent` factory body — UNCHANGED (T3.S2 owns the signature).
- `buildCommitMessageSystemPrompt` body — UNCHANGED (T3.S1 owns it).
- `getRecentCommitMessages` body — UNCHANGED (T2.S1 owns it).
- No docs files (P1.M3 milestone owns changeset docs). JSDoc on `generateCommitMessage`
  IS in scope (Mode A per item contract §5 DOCS).

## 9. Validation commands (verified in package.json)

```
npm run typecheck      # tsc --noEmit -p tsconfig.build.json
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
npx vitest run tests/unit/utils/git-commit.test.ts
npx vitest run tests/unit/agents/commit-message-agent.test.ts   # regression — factory + builder unchanged
```