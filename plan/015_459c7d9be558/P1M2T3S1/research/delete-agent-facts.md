# Research — P1.M2.T3.S1: Delete `commit-message-agent.ts` + remove imports/factory wiring

> Load-bearing facts for a small, surgical **deletion** subtask in delta 015.
> Captured 2026-08-12 by direct inspection of the hacky-hack repo.

## 1. What `commit-message-agent.ts` exports (so we know what dies)

`src/agents/commit-message-agent.ts` (385 lines) exports exactly **two** symbols
(grep-verified):

| Line | Export | Role |
| ---- | ------ | ---- |
| 303  | `export function buildCommitMessageSystemPrompt(...)` | builds the 4-style-mode system prompt |
| 363  | `export function createCommitMessageAgent(systemPrompt?): Agent` | factory; uses `createBaseConfig` from agent-factory |

Plus module-internal (NOT exported): the 4 style-mode system-prompt constants +
the gitmoji reference table. All of it dies with the file. **No other production
symbol is exported from this file**, so deleting it cannot orphan a re-export.

## 2. Every reference to the module across the repo (the deletion map)

`grep -rn "commit-message-agent" src/ tests/` yields:

### PRODUCTION (`src/`) — S1 owns ALL of these
| File | Line(s) | Kind | S1 action |
| ---- | ------- | ---- | --------- |
| `src/agents/commit-message-agent.ts` | whole file | the module | **DELETE** |
| `src/utils/git-commit.ts` | 47–49 (import block) | `import { createCommitMessageAgent, buildCommitMessageSystemPrompt } from '../agents/commit-message-agent.js'` | **VERIFY GONE** — T2.S1 already removed it (see §3). Grep must return 0. |
| `src/utils/git-commit.ts` | 381–382 (OLD body) | usage in the OLD `generateCommitMessage` | **VERIFY GONE** — T2.S1 rewrote the body to the stagecoach binary. Grep must return 0. |

**Production has exactly ONE importer (`git-commit.ts`) and T2.S1 already cut
that import.** No other `src/` file imports the module. After S1 deletes the
file, `grep -rn commit-message-agent src/` returns ZERO.

### TESTS (`tests/`) — S2 owns ALL of these (S1 does NOT touch them)
| File | Line(s) | Kind | Breaks S1? |
| ---- | ------- | ---- | ---------- |
| `tests/unit/agents/commit-message-agent.test.ts` | 43 (typed import), 48 (describe) | the agent's OWN test | **YES — typecheck(vitest collection) + test:run** (imports the deleted module) |
| `tests/integration/git-commit-generate.test.ts` | 27–30 (vi.mock + `typeof import`), 44 (typed `import { createCommitMessageAgent }`) | integration test | **YES — test:run** (collection import @44 + `vi.importActual` @28 of the deleted module) |
| `tests/unit/protected-files.test.ts` | 31 (comment), 33 (`vi.mock(..., () => ({...}))` factory) | tests the (now-gone) import chain | **NO break** — vi.mock with a factory does NOT require the real file; the mock becomes a dead no-op (premise stale). S2 removes the dead vi.mock. |
| `tests/unit/agents/cleanup-agent.test.ts` | 9, 12, 26, 111 | COMMENT-only references (comparing cleanup-agent to the commit agent) | **NO break** — comments only. Stale prose; optional S2/doc cleanup. |

**Net:** after S1, exactly **2 test files** (`commit-message-agent.test.ts`,
`git-commit-generate.test.ts`) break `npm run test:run`. Both are S2's explicit
domain (S2 = "Rewire test mocks + delete commit-message-agent.test.ts").

## 3. The T2.S1 contract (what `git-commit.ts` looks like when S1 implements)

Per the parallel `P1M2T2S1/PRP.md` (treat as a CONTRACT — it lands before S1):
T2.S1 **already removes** the 6 now-unused imports from `git-commit.ts`:
`createCommitMessageAgent`, `buildCommitMessageSystemPrompt`, `createPrompt` (groundswell),
`z` (zod), `getRecentCommitMessages`, `getPrpCommitStyleExamples`. It **KEEPS**
`getPrpCommitStyle` and **ADDS** `spawn`/`resolveStagecoachBinary`/`getModel`/
`PRP_AGENT_HARNESS`+`DEFAULT_HARNESS`. It rewrites `generateCommitMessage` to the
stagecoach binary exec and **rewires `git-commit.test.ts`** (removes its
`vi.mock('.../commit-message-agent.js')` + the `createCommitMessageAgent` import +
the dead `mockCreateCommitMessageAgent` handle — lint-forced).

**Consequence for S1's work-item clauses:**
- Clause (b) "remove imports from git-commit.ts" → **already done by T2.S1**. S1's
  job is a **VERIFY grep** (expect 0); remove a stray line ONLY if T2.S1 left one.
- Clause (d) "remove `getRecentCommitMessages` import if only used by auto-style" →
  **already done by T2.S1** (it was one of the 6 unused). VERIFY grep. (`getRecentCommitMessages`
  is DEFINED in `src/tools/git-mcp.ts` and may still be used there/elsewhere — do NOT
  touch its definition; only confirm git-commit.ts no longer imports it.)
- Clause (c) "search for any other importers" → **production has none** beyond
  git-commit.ts (already cleaned). The only remaining importers are the TEST files = S2.
- Clause (e) "confirm no remaining references" → **true for `src/`** after the delete;
  the only remaining references are the S2-owned test files.

So S1's REAL work is small: **(1) delete the file, (2) augment the
`generateCommitMessage` JSDoc with the "Supersedes the in-process agent" note
(the DOCS contract), (3) grep-verify production is clean, (4) document the S2
test boundary.**

## 4. `createBaseConfig` is NOT orphaned (no lint fallout in agent-factory)

`commit-message-agent.ts` consumes `createBaseConfig` from `agent-factory.ts`.
Deleting the consumer does NOT orphan it — `createBaseConfig` is used by the
architect / coder / researcher / qa / bug-finder personas
(`agent-factory.ts` lines 370, 408, 447, 494, 548). **No lint error in
agent-factory after the delete.** (Verified by grep.)

## 5. The validation gate — precise GREEN/RED map after S1

Confirmed by reading `tsconfig.json` / `tsconfig.build.json` / `.eslintrc.json` /
`vitest.config.ts`:

| Gate | Command | After S1 | Why |
| ---- | ------- | -------- | --- |
| typecheck | `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json` | **GREEN** | `tsconfig.build.json` `include: ["src/**/*"]`, `exclude: [..., "tests"]` → typechecks ONLY `src/`. No `src/` file references the deleted module (T2.S1 cleaned git-commit.ts). |
| lint | `npm run lint` = `eslint . --ext .ts` | **GREEN** | `.eslintrc.json` has **no `import/no-unresolved`** rule; the test-override turns off `no-unused-vars` for tests. Dangling test imports of the deleted module are NOT flagged. No unused import is INTRODUCED by S1. |
| format | `npm run format:check` | **GREEN** | deleting a file + adding one JSDoc line doesn't break prettier (run `npm run fix` first). |
| **test:run** | `npm run test:run` = `vitest run` | **RED (expected)** | vitest `include: ['tests/**/*.{test,spec}.ts']` collects the 2 breaker test files which import the deleted module → collection/runtime error. **Owned by S2.** |
| validate | `npm run validate` = `lint && format:check && typecheck && test:run` | **RED (only the final test:run step)** | the first 3 steps pass; test:run (last) fails on the 2 S2-owned files. |

**S1's achievable GREEN gate** (production-source, doesn't depend on S2):
```bash
npm run fix                                   # prettier --write (in case the JSDoc line reflows)
npm run lint && npm run format:check && npm run typecheck   # ALL GREEN
grep -rn "commit-message-agent" src/          # ZERO (production clean)
grep -rn "createCommitMessageAgent\|buildCommitMessageSystemPrompt" src/utils/git-commit.ts   # ZERO (T2.S1 cut them)
```
**Expected RED (S2's domain — do NOT "fix"):**
```bash
npm run test:run   # RED on tests/unit/agents/commit-message-agent.test.ts +
                   #      tests/integration/git-commit-generate.test.ts (import the deleted module).
                   # These are rewired/deleted by the immediately-following P1.M2.T3.S2.
                   # T3 (S1+S2) is validated as a unit for the full `npm run validate`.
```
S1 MAY run a scoped confirmation that the production-adjacent suite is unaffected:
`npx vitest run tests/unit/utils/git-commit.test.ts` (T2.S1 rewired it → green).

## 6. The DOCS contract — the "Supersedes" JSDoc note

S1 must add to `generateCommitMessage`'s JSDoc (which T2.S1 rewrote for §9.10.1)
the verbatim note from the work item's DOCS clause:
> "Supersedes the in-process agent — the previous `commit-message-agent.ts` and
> its style-learning machinery are removed in favor of stagecoach delegation (§9.10.1)."

Add it as a `@remarks` line (T2.S1's JSDoc already has a `@remarks` block describing
binary delegation — augment it, don't duplicate). Placement: inside the existing
`generateCommitMessage` JSDoc `@remarks`, near the §9.10.1 citation. T2.S1 lands
first (sequential), so S1 edits the JSDoc T2.S1 wrote — no merge conflict.

## 7. Out of scope (hard boundary — S2 / other items own these)

- `commit-message-agent.test.ts` deletion (S2).
- Rewiring `git-commit-generate.test.ts` + `protected-files.test.ts` mocks (S2).
- The stale comments in `cleanup-agent.test.ts` (optional; not S1).
- `getRecentCommitMessages`'s DEFINITION in `git-mcp.ts` (leave it; only confirm
  git-commit.ts stopped importing it — T2.S1's job, already done).
- `agent-factory.ts` (untouched — `createBaseConfig` stays; not orphaned).
- `stagecoach-resolver.ts`, the `generateCommitMessage` body, smartCommit,
  `formatCommitMessage` (all T2.S1's / unchanged).
- `docs/*.md` (DOCS = Mode A — the JSDoc note is the only doc artifact).