# Test Conventions & Backward-Compatibility Surface

## 1. `tests/unit/utils/git-commit.test.ts` mock structure (100% coverage)

- Mocks `gitStatus`, `gitAdd`, `gitCommit` from `'../../../src/tools/git-mcp.js'`
  via `vi.mock(...)`. Imports the mocked fns and aliases `vi.mocked(...)`.
- Logger mocked via `vi.hoisted` + `vi.mock('../../../src/utils/logger.js', ...)`
  returning a fixed `{ info, error, warn, debug }` object.
- Imports under test: `filterProtectedFiles, formatCommitMessage, smartCommit`.

**Adding the stagecoach path requires a NEW mock for the generator boundary.**
Since the recommended design puts the LLM call behind a pure function
`generateCommitMessage(diff)` (or an injected agent factory), the cleanest mock
that keeps the existing suite intact:

```ts
// Option A: mock the agent module the generator imports
vi.mock('../../../src/agents/commit-message-agent.js', () => ({
  createCommitMessageAgent: vi.fn(),
}));
```
Then the existing happy-path tests (which call `smartCommit(path, message)`
with NO generate option) never touch the generator → zero behavior change →
stay green unchanged. Only NEW tests exercising the `generate: true` option
need to wire the mocked `createCommitMessageAgent` to return a fake agent whose
`.prompt()` resolves `{ status: 'success', data: 'feat: add thing', error: null }`.

**Backward-compat rule (critical):** the default path (option absent) must NOT
import/instantiate the agent lazily or eagerly. The agent import must live
INSIDE the `generate` branch (dynamic import) OR the generator function must
short-circuit when generation is disabled, so existing tests never hit the
agent mock. Recommend: gate instantiation inside `generateCommitMessage`.

## 2. `tests/integration/smart-commit.test.ts`

- Mocks `'../../src/utils/git-commit.js'` wholesale: `{ smartCommit: vi.fn(),
  filterProtectedFiles: vi.fn(...), formatCommitMessage: vi.fn(...) }`.
- Because it mocks `smartCommit` entirely, **adding an optional 3rd param does
  NOT break it** — `vi.fn()` accepts any args. Assertions key off the CALL
  being made and the returned hash, not arity. Confirmed: no assertion reads
  `smartCommit.mock.calls[0].length`.
- No edit required to this file for this task.

## 3. Orchestrator call site (`src/core/task-orchestrator.ts:~1004`)

Exact call (quote):
```ts
const sessionPath = this.sessionManager.currentSession?.metadata.path;
...
const commitMessage = `${subtask.id}: ${subtask.title}`;
const commitHash = await smartCommit(sessionPath, commitMessage);
```
- This is the **single** production caller today. It builds a pre-formatted
  message from the subtask id+title.
- **This task does NOT change this call site.** Backward compatibility means
  `smartCommit(sessionPath, commitMessage)` continues to work identically
  (pre-formatted message, no LLM generation). The stagecoach generation path is
  OPT-IN via a new optional 3rd argument `options?: SmartCommitOptions`, used
  later by P3.M1.T3.S2 (the two-phase pre/post-cleanup commits) and is never
  exercised by the current single caller.
- The orchestrator's surrounding try/catch (~995-1030) is unchanged: smartCommit
  already returns `null` on failure and the orchestrator logs + continues.

## 4. `src/config/constants.ts` — no COMMIT_RETRY_* yet

Confirmed: `grep -n "COMMIT" src/config/constants.ts` returns nothing. The
env-var-constant pattern (e.g. lines 234/390) is:
```ts
export const ISSUE_RETRY_MAX = 'ISSUE_RETRY_MAX';  // the env-var NAME
// + a reader: export function getIssueRetryMax(): number { ... parseInt(process.env[ISSUE_RETRY_MAX] ?? '') ... }
```
**This task adds NO constants** — `COMMIT_RETRY_MAX`/`COMMIT_RETRY_DELAY` are
P3.M1.T4.S1's deliverable. This task only adds the generation BOUNDARY.

## 5. Message-formatting contract (prefix + trailer)

- `formatCommitMessage(message)` (git-commit.ts ~107) returns
  `[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`.
- **LLM-generated message path**: the raw LLM output (subject + optional body,
  NO prefix, NO trailer per the agent system prompt) MUST still go through
  `formatCommitMessage` so every commit keeps the `[PRP Auto]` prefix + the
  Co-Authored-By trailer. i.e. `formatCommitMessage(llmMessage)`.
- **Fallback placeholder path** (P3.M1.T4.S2, not this task): the PRD §5.1
  placeholder `chore: commit-gen failed (exit N); fallback commit` does NOT
  carry `[PRP Auto]` — but that decision belongs to P3.M1.T4.S2, not here.
  This task's `smartCommit` should STILL wrap whatever message it is given
  (generated or pre-formatted) in `formatCommitMessage` for consistency, and
  document that the fallback (when added in T4.S2) may bypass it.
- **`PROTECTED_FILES`** does NOT include `PRP.md` — confirmed. The mechanical
  `restore_critical_files` (P3.M2.T4.S2) is a SEPARATE later task; this task
  does NOT touch PROTECTED_FILES.

## 6. SmartCommitOptions shape (proposed, this task)

```ts
export interface SmartCommitOptions {
  /** When true, delegate commit-message generation to the stagecoach LLM
   *  agent (reads the staged diff). Backward compat: omitted/false → use the
   *  caller-provided `message` verbatim (current behavior). */
  readonly generateMessage?: boolean;
}
export async function smartCommit(
  sessionPath: string,
  message: string,            // KEPT — the fallback/pre-formatted message
  options?: SmartCommitOptions, // NEW optional 3rd arg
): Promise<string | null>
```
- `message` stays REQUIRED (it is the fallback when generation is off, and the
  last-resort input when generation is on but produces nothing). This preserves
  every existing caller and every existing test.
- When `options.generateMessage === true`: after `gitAdd`, call
  `gitDiff({ path: repoRoot, staged: true })`, pass `diff` to
  `generateCommitMessage(diff)`, wrap result in `formatCommitMessage`, commit.
  On generation failure, this task's contract is to THROW (so P3.M1.T4.S1's
  retry boundary catches it) — but smartCommit's outer try/catch converts any
  throw to `null` return today. **This is the key design decision** (see PRP
  Implementation Decisions D3): smartCommit must surface generation failure
  distinctly so the retry layer can act. Recommended: smartCommit returns
  `null` on generation failure (preserving the never-throws contract) AND logs
  the failure reason; P3.M1.T4.S1 wraps the INNER `generateCommitMessage` call
  (not smartCommit) with retry.