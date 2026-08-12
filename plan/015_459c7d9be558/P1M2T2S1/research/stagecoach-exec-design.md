# generateCommitMessage → stagecoach binary exec — design + scope map

Authoritative reference for P1.M2.T2.S1. Pins the stagecoach CLI contract, the
`--provider`-is-the-HARNESS subtlety, the repoRoot requirement, the spawn-based
impl, the import churn, the test-rewire scope, and the T3 boundary.

## 1. The stagecoach CLI contract (architecture §1.3 + system_context §5.1)

- **stagecoach reads the REPO INDEX directly** — it does NOT accept a diff via
  stdin. It snapshots the already-staged index via its own `git write-tree`
  (system_context §5.1: "the PRD's 'feed the staged diff via stdin' is a design-
  doc imprecision"). ⇒ files MUST be staged before invoking; the message comes
  back via **stdout**.
- **Invocation:** `stagecoach --dry-run --single` (+ optional `--format`,
  `--provider`, `--model`). `--dry-run` = emit message to stdout, no commit;
  `--single` (`--no-decompose`) = exactly one message, no multi-commit split.
- **The pipeline retains commit ownership** — stagecoach's stdout (the bare
  descriptive message) is fed to `formatCommitMessage` (task-prefix layer) then
  committed via the existing plumbing (`gitCommitTree` + `gitUpdateRefCAS`).
  `smartCommit`'s retry/fallback layer is UNCHANGED.

## 2. CRITICAL: stagecoach `--provider` = the HARNESS id, NOT the LLM provider

stagecoach's `--provider <name>` is "the agent/CLI to shell out to" — `pi`,
`claude-code`, opencode, cursor, … (architecture §1.3: "Stagecoach supports pi
as a provider natively"). This is the codebase's **HARNESS** (`pi` |
`claude-code`), NOT the LLM provider (`zai`/`anthropic`).

**Resolve it WITHOUT side effects** — mirror `runAuthPreflight()` (harness.ts):
```ts
const provider = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;  // 'pi' | 'claude-code'
```
Do NOT call `configureHarness()` (it has startup side effects: registers
PiHarness, calls `configureHarnesses`). Do NOT use `getResolvedProvider()`
(that returns the LLM provider `zai`/`anthropic` — WRONG flag). The env read +
DEFAULT_HARNESS fallback is the established no-side-effect pattern.

## 3. `--model` = `getModel('balanced')`; `--format` = PRP_COMMIT_STYLE forwarding

- **`--model`**: forward `getModel('balanced')` from `../config/environment.js`
  (provider-qualified, e.g. `zai/glm-5.2`). 'balanced' is the tier the OLD commit
  agent used (arch §2.5: `createBaseConfig('researcher', 'research', 'off')` →
  researcher → balanced). This keeps stagecoach on the same backend the pipeline
  uses for agent runs (PRD §9.10.1).
- **`--format`**: `getPrpCommitStyle()` (constants.ts) → `'auto'|'plain'|
  'conventional'|'gitmoji'`. Mapping (architecture §1.3 + contract):
  - `'auto'` (the DEFAULT when PRP_COMMIT_STYLE unset) → **OMIT** `--format`
    (stagecoach's native auto/history-learning default applies).
  - `'plain'`/`'conventional'`/`'gitmoji'` → append `--format`, `<style>`.

## 4. resolveStagecoachBinary() — the input from P1.M2.T1.S1

`resolveStagecoachBinary(): string` (from `./stagecoach-resolver.js`) returns the
absolute path to the native binary; throws `AgentError` on missing dep/binary
(never a silent fallback — §9.10.1). This item CONSUMES it: `const bin =
resolveStagecoachBinary();` then `spawn(bin, [...], {cwd, env})`.

## 5. repoRoot is REQUIRED — stagecoach needs cwd to read the index

stagecoach reads the repo index, so it MUST run with `cwd = repoRoot`. The OLD
`generateCommitMessage(diff: string)` had no repoRoot. The NEW signature is:

```ts
export async function generateCommitMessage(repoRoot: string, _diff?: string): Promise<string>
```

- `repoRoot` (1st param) → `spawn(..., { cwd: repoRoot, env: process.env })`.
  Explicit — do NOT use `process.cwd()` (fragile if repoRoot ≠ cwd under
  `--repo-root` override; stagecoach reading the wrong index = silent corruption).
- `_diff?` (2nd param, optional, UNUSED, underscore-prefixed) — retained for
  call-site compatibility. **smartCommit still reads `gitDiff({staged:true})`**
  (kept — see §8) and passes `diffResult.diff ?? ''`; generateCommitMessage
  ignores it (stagecoach reads the index itself).

**The ONE call site update** (smartCommit, ~line 970): `generateCommitMessage(
diffResult.diff ?? '')` → `generateCommitMessage(repoRoot, diffResult.diff ??
'')`. (repoRoot is smartCommit's 1st arg — already in scope.) The contract's
literal `diff?: string` signature is adjusted to `repoRoot, _diff?` because
stagecoach needs the repo's cwd — a forced, minimal, contract-faithful change
(the contract's INTENT is "diff becomes unused"; the cwd requirement is implied
by "stagecoach reads the index").

## 6. The spawn-based implementation (argv vector — NEVER sh -c)

git-commit.ts does NOT currently import `node:child_process` (only `simple-git`
+ git plumbing helpers). So `import { spawn } from 'node:child_process'` is the
SOLE child_process usage → mocking it in tests is clean (no other consumer in
the file). Reference impl:

```ts
export async function generateCommitMessage(repoRoot: string, _diff?: string): Promise<string> {
  // stagecoach reads the REPO INDEX directly (system_context §5.1); _diff is UNUSED.
  const bin = resolveStagecoachBinary();
  const argv: string[] = ['--dry-run', '--single'];

  const style = getPrpCommitStyle();
  if (style !== 'auto') argv.push('--format', style);   // explicit modes only

  argv.push('--provider', process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS);  // harness id
  argv.push('--model', getModel('balanced'));                                  // resolved model

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, { cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', (e) => reject(new AgentError(`stagecoach commit-message generation failed: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AgentError(`stagecoach commit-message generation failed (exit ${code ?? 'null'})${err ? `: ${err.trim()}` : ''}`));
        return;
      }
      resolve(out);
    });
  });

  const message = stdout.trim();
  if (!message) {
    throw new AgentError('stagecoach commit-message generation failed: empty stdout');
  }
  return message;
}
```

**Failure → AgentError** (preserves the retry/fallback contract: smartCommit's
`retry()` classifies AgentError transient; on exhaustion, the catch uses
`buildFallbackCommitMessage`). The empty-stdout + non-zero-exit + spawn-error
branches each throw AgentError → all three are retryable → all converge on the
fallback. (The OLD empty-diff guard is REMOVED — stagecoach handles an empty
index by exiting non-zero → AgentError → retry → fallback.)

## 7. Import churn in git-commit.ts (REMOVE unused; ADD new)

**REMOVE** (only user was the old generateCommitMessage body; grep-verified single
import site + single usage each):
- `createCommitMessageAgent`, `buildCommitMessageSystemPrompt` (from agent-factory)
- `createPrompt` (from `groundswell`) — import@44, usage@383
- `z` (from `zod`) — import@45, usage@385
- `getRecentCommitMessages` — import@34, usage@373
- `getPrpCommitStyleExamples` — import@57, usage@371

**KEEP:** `getPrpCommitStyle` (import@56 — used for `--format` forwarding).

**ADD:**
- `resolveStagecoachBinary` from `./stagecoach-resolver.js`
- `getModel` from `../config/environment.js`
- `PRP_AGENT_HARNESS`, `DEFAULT_HARNESS` from `../config/constants.js` (add to the existing constants import block)
- `spawn` from `node:child_process`

**JSDoc rewrite** (the block above generateCommitMessage, ~lines 300-352, references
the old agent path at 258/319-325): replace with the §9.10.1 binary-delegation
contract (--dry-run --single, provider/style forwarding, stagecoach reads the
index, throws AgentError). The contract's DOCS point requires this.

## 8. smartCommit — KEEP the gitDiff call (Option B; minimal blast radius)

Contract point (f) offers: remove the `gitDiff({staged:true})` call OR keep it.
**KEEP it.** Rationale:
- Removing it cascades into smartCommit test rewrites (the smartCommit describe
  block at git-commit.test.ts:508 mocks `mockGitDiff` extensively) — that's a
  large surface that overlaps T3.S2 ("rewire test mocks").
- Keeping it is FUNCTIONALLY CORRECT: the diff is computed + passed + IGNORED by
  generateCommitMessage (stagecoach reads the index). The gitDiff-failure guard
  (`if (!diffResult.success) return null`) stays as a pre-generation sanity check.
- **The ONLY smartCommit edit** is the call-site signature update (§5: pass
  `repoRoot` as the 1st arg). The retry layer, the fallback, the plumbing commit
  are all UNCHANGED.
- Flag in the commit message: the now-redundant gitDiff call can be removed in
  T3.S2 (or a follow-up) when smartCommit tests are rewired.

## 9. Test-rewire scope (git-commit.test.ts) — forced by the rewrite

`mockCreateCommitMessageAgent` appears at lines 113 (handle), 1139 (smartCommit
fallback test), 1184/1204/1232/1251/1263 (the `describe('generateCommitMessage')`
block @1181). The top-of-file `vi.mock('../../../src/agents/commit-message-agent.js')`
(@41) + the `createCommitMessageAgent` import (@81) back the handle.

After the rewrite, generateCommitMessage no longer calls the agent → these tests
MUST be rewired to the spawn mock or they fail (and the new branches are
uncovered → 100% gate fails). **MY item's test edits:**
1. **ADD** a hermetic binary-exec mock surface:
   - `vi.mock('../../../src/utils/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach') }))`
   - `vi.mock('node:child_process', () => ({ spawn: vi.fn() }))` — safe (sole child_process user in git-commit.ts).
2. **REWRITE the `describe('generateCommitMessage')` block** (@1181) — replace the
   agent-mock tests with spawn-mock tests: happy path (spawn → close code 0,
   stdout 'feat: x\n' → resolves 'feat: x'); non-zero exit → AgentError; empty
   stdout → AgentError; spawn `error` event → AgentError; `--format` forwarding
   (stub getPrpCommitStyle → 'conventional' → assert argv contains
   `--format`,`conventional`); `--format` OMITTED when style='auto';
   `--provider`/`--model` forwarding (assert argv contains `--provider`,`pi`,
   `--model`,`zai/glm-5.2`); the call signature is now `generateCommitMessage('/fake/repo')`.
3. **REMOVE the empty-diff-guard tests** (@1217 `generateCommitMessage('')` →
   AgentError; @1225 whitespace → AgentError) — the guard is gone; the empty-index
   case is now covered by "spawn non-zero exit → AgentError".
4. **REWRITE the smartCommit fallback test** (@1139) — it drives the generateMessage
   path via `mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent({status:'error'}))`
   to trigger the fallback. Rewire: make the spawn mock emit a non-zero close
   (→ AgentError → retry exhausts → `buildFallbackCommitMessage`). The assertion
   (placeholder flows through gitCommitTree + gitUpdateRefCAS) is UNCHANGED.
5. **REMOVE the now-dead agent-mock infra** (FORCED by lint — unused var after
   steps 2+4): the `mockCreateCommitMessageAgent` handle (@113), the
   `createCommitMessageAgent` import (@81), and the top-of-file
   `vi.mock('../../../src/agents/commit-message-agent.js')` (@41). `mockGitDiff`
   STAYS (smartCommit still calls gitDiff — §8).

**T3 boundary:** T3.S1 deletes `commit-message-agent.ts` + the
`createCommitMessageAgent`/`buildCommitMessageSystemPrompt` exports from
agent-factory. T3.S2 deletes `commit-message-agent.test.ts` (the agent's OWN
test) + confirms no stragglers. MY item handles the git-commit.test.ts rewiring
FORCED by rewriting generateCommitMessage (the function's direct tests + the one
smartCommit test that drives it + the dead agent-mock infra). Document the overlap.

## 10. Coverage branches (100% enforced — vitest.config.ts)

Every branch of the new generateCommitMessage must be hit:
- `resolveStagecoachBinary()` happy path (bin resolved) + its throw (resolver
  throws AgentError → propagates; covered by mocking the resolver to throw).
- `style !== 'auto'` true (--format pushed) + false (omitted).
- spawn `close` code===0 (resolve stdout) + code!==0 (reject AgentError).
- spawn `error` event (reject AgentError).
- `!message` (empty stdout → AgentError) + non-empty (return).
The spawn-mock tests in §9 cover all of them.

## 11. Scope boundaries (disjointness)

- **MY item:** `src/utils/git-commit.ts` (rewrite generateCommitMessage + import
  churn + JSDoc + the 1-line smartCommit call-site) + `tests/unit/utils/git-commit.test.ts`
  (rewire generateCommitMessage describe + smartCommit@1139 + remove dead agent-mock infra).
- **P1.M2.T1.S1 (parallel previous):** adds `src/utils/stagecoach-resolver.ts` +
  `package.json` (stagecoach-ai dep) + its test. MY item CONSUMES
  `resolveStagecoachBinary` (assume it landed). DIFFERENT files (resolver.ts vs
  git-commit.ts) → no merge conflict.
- **P1.M2.T3.S1 (sequenced after):** deletes `commit-message-agent.ts` + the
  agent-factory exports. MY item removes the IMPORTS from git-commit.ts (a
  consumer removal); T3 removes the provider. Clean handoff.
- **P1.M2.T3.S2 (sequenced after):** deletes `commit-message-agent.test.ts` +
  confirms test cleanup. MY item already removed the agent-mock from
  git-commit.test.ts (forced); T3 handles the agent's own test file.
- **DO NOT touch:** stagecoach-resolver.ts (T1.S1), commit-message-agent.ts (T3.S1),
  commit-message-agent.test.ts (T3.S2), the smartCommit retry/fallback/plumbing
  (unchanged), formatCommitMessage (unchanged — it still layers the prefix), any
  docs/*.md (DOCS: Mode A — JSDoc only), PRD.md, tasks.json.