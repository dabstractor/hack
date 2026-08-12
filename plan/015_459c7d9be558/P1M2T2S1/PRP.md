# PRP — P1.M2.T2.S1: `generateCommitMessage` → `stagecoach --dry-run --single` binary exec

> Plan 015, PRD §9.10.1 (Commit-Message Generation — stagecoach delegation, message-only) step 2.
> Rewrite `generateCommitMessage` in `src/utils/git-commit.ts` to **delegate to the real `stagecoach`
> binary** (`stagecoach --dry-run --single`) instead of the in-process LLM agent — replacing the
> re-implementation that drift-prone acquired a hardcoded `Co-Authored-By: Claude` trailer (incident 1).
> stagecoach reads the **repo index** directly (system_context §5.1), so the `diff` param becomes
> unused; `repoRoot` becomes required (stagecoach needs `cwd` to read the index). Provider (`pi`|
> `claude-code` — the **harness**), model, and `PRP_COMMIT_STYLE` are forwarded as argv flags. The
> message comes via **stdout**; non-zero exit / empty stdout → `AgentError` (preserving smartCommit's
> retry/fallback contract unchanged). **Consumes `resolveStagecoachBinary()` from P1.M2.T1.S1** (assume
> landed). P1.M2.T3 later deletes the now-dead in-process agent.

---

## Goal

**Feature Goal**: Replace the in-process commit-message agent path in `generateCommitMessage` with a
**direct exec of the `stagecoach` native binary** (`stagecoach --dry-run --single`) — argv vector
(never `sh -c`), `cwd = repoRoot`, env inherited, stdout captured. Forward the resolved provider
(the harness id `pi`|`claude-code`), model (`getModel('balanced')`), and `PRP_COMMIT_STYLE` (explicit
non-`auto` modes only) as argv flags. Throw `AgentError` on non-zero exit / spawn error / empty stdout
so smartCommit's existing retry→fallback contract is unchanged.

**Deliverable**:
1. **`src/utils/git-commit.ts`** — EDIT: (a) rewrite `generateCommitMessage` to spawn the binary
   (signature becomes `(repoRoot: string, _diff?: string)`: repoRoot required for `cwd`, diff optional/
   unused — stagecoach reads the index); (b) REMOVE the now-unused imports (`createCommitMessageAgent`,
   `buildCommitMessageSystemPrompt`, `createPrompt`, `z`, `getRecentCommitMessages`,
   `getPrpCommitStyleExamples`); (c) ADD imports (`resolveStagecoachBinary`, `getModel`,
   `PRP_AGENT_HARNESS`/`DEFAULT_HARNESS`, `spawn`); (d) update the ONE smartCommit call site to pass
   `repoRoot`; (e) rewrite the generateCommitMessage JSDoc (Mode A, §9.10.1).
2. **`tests/unit/utils/git-commit.test.ts`** — EDIT: rewire the `describe('generateCommitMessage')`
   block + the one smartCommit fallback test that drives it to mock the binary exec (spawn +
   resolveStagecoachBinary) instead of the in-process agent; remove the now-dead agent-mock infra
   (forced by lint); remove the obsolete empty-diff-guard tests.

**Success Definition**:
- `generateCommitMessage(repoRoot)` spawns `resolveStagecoachBinary()` with argv `['--dry-run',
  '--single', ...]` + `--provider <harness>` + `--model <getModel('balanced')>` + (only for explicit
  non-auto `PRP_COMMIT_STYLE`) `--format <style>`, `cwd: repoRoot`, `env: process.env`, NO shell.
- stdout (trimmed) is returned; non-zero exit / spawn `error` / empty stdout → `throw new AgentError(...)`.
- smartCommit's retry→fallback→plumbing-commit path is UNCHANGED (the retry still wraps
  generateCommitMessage; AgentError is still classified transient; exhaustion still hits
  `buildFallbackCommitMessage` → `gitCommitTree`/`gitUpdateRefCAS`).
- The in-process agent imports are gone from git-commit.ts; `commit-message-agent.ts` itself is left
  for P1.M2.T3.S1 to delete.
- `npm run typecheck && npm run lint && npm run format:check` clean; `tests/unit/utils/git-commit.test.ts`
  GREEN; `src/utils/git-commit.ts` 100% covered.

---

## Why

- **PRD §9.10.1 — stop re-implementing a solved tool.** The descriptive commit message was generated
  by an in-process re-implementation of stagecoach that drift-acquired a hardcoded `Co-Authored-By:
  Claude` trailer — mis-attributing pi/z.ai work to Claude on every commit (incident 1). The real
  `stagecoach` binary is identity-transparent by design. Delegating to it eliminates the drift vector.
- **"Shipped with this tool" + message-only.** `npm install` brings stagecoach transitively (P1.M2.T1.S1
  declared the dep + resolver). `--dry-run --single` emits ONLY the bare descriptive message to stdout;
  the pipeline retains commit ownership (the snapshot plumbing commit + the task-prefix position layer
  + restore_critical_files + retry/fallback — all unchanged).
- **stagecoach reads the index — the stdin-diff model is wrong.** system_context §5.1: stagecoach
  snapshots the repo index itself via its own `git write-tree`; it does NOT consume a diff via stdin.
  So the diff param becomes vestigial and stagecoach MUST run with `cwd = repoRoot` (reading the right
  index). The signature change reflects this reality.
- **Preserves the retry/fallback contract.** The only contract generateCommitMessage owes its caller is
  "return the message, or throw AgentError on failure." The new impl honors it: every failure mode
  (non-zero exit, spawn error, empty stdout, missing binary via the resolver) → AgentError → smartCommit's
  `retry()` (transient classification) → on exhaustion `buildFallbackCommitMessage`. Zero change to the
  retry/fallback/plumbing layer.
- **Consumes P1.M2.T1.S1's resolver.** T1.S1 (parallel previous) ships `resolveStagecoachBinary()` +
  the `stagecoach-ai` dep. This item execs the resolved path. File-disjoint (resolver.ts vs git-commit.ts);
  clean handoff. P1.M2.T3 later deletes the now-dead in-process agent (`commit-message-agent.ts`) + its
  test — this item only removes git-commit.ts's *consumption* of it.
- **Out of scope (hard boundary):** `resolveStagecoachBinary`/`stagecoach-resolver.ts` (P1.M2.T1.S1),
  deleting `commit-message-agent.ts` + its factory exports (P1.M2.T3.S1), deleting
  `commit-message-agent.test.ts` (P1.M2.T3.S2), the commit-identity structural guard (P1.M3),
  smartCommit's retry/fallback/plumbing-commit logic (unchanged), `formatCommitMessage` (unchanged —
  still layers the prefix, no trailer), the bash denylist / tool matrix (P1.M4), any `docs/*.md`
  (DOCS: Mode A — JSDoc only), `PRD.md`, `tasks.json`.

---

## What

### User-visible behavior
A pipeline-authored work-item commit's descriptive message is now produced by the real `stagecoach`
binary (same tool as the user's `git stagecoach` alias), carrying **no** `Co-Authored-By` trailer /
`Generated-by` footer / machine author (stagecoach's output discipline). Functionally, the commit path
is otherwise byte-identical (same staging, same atomic plumbing commit, same task-prefix position layer,
same retry/fallback). No CLI surface change.

### Technical requirements (exact contract)

**`src/utils/git-commit.ts`** — rewrite `generateCommitMessage` (currently lines ~355-400). The OLD
body (style resolution → `buildCommitMessageSystemPrompt` → `createCommitMessageAgent` → `createPrompt`
→ `agent.prompt` → message) is REPLACED by the binary exec. Verbatim new body:

```ts
/**
 * Generate a commit message by delegating to the `stagecoach` binary (PRD §9.10.1).
 *
 * @remarks
 * "The descriptive commit message is generated by delegating to the stagecoach binary."
 * Stagecoach is invoked message-only as `stagecoach --dry-run --single`: `--dry-run` emits the
 * message to stdout WITHOUT committing (the pipeline retains commit ownership — the snapshot
 * plumbing commit + the task-prefix position layer live in `smartCommit`/`formatCommitMessage`);
 * `--single` (`--no-decompose`) produces exactly one message with no multi-commit decomposition.
 *
 * Stagecoach reads the REPO INDEX directly (it snapshots via its own `git write-tree`) — it does
 * NOT consume a diff via stdin. Files MUST already be staged (`smartCommit` stages them before
 * calling this). The `_diff` parameter is therefore UNUSED (retained only for call-site
 * compatibility) and `repoRoot` is REQUIRED (stagecoach runs with `cwd: repoRoot` so it reads the
 * correct index). The message is captured from stdout.
 *
 * Provider/style forwarding: `--provider` is the resolved agent HARNESS (`pi` | `claude-code` — the
 * same runtime the pipeline uses for agent runs, NOT the LLM provider); `--model` is the resolved
 * `getModel('balanced')`; `--format` forwards `PRP_COMMIT_STYLE` for explicit non-`auto` modes only
 * (unset/`auto` → omitted, stagecoach's native history-learning default applies).
 *
 * Executed as a direct argv vector (NEVER `sh -c`), env inherited. On non-zero exit, a spawn error,
 * or empty stdout → throws {@link AgentError} (transient — smartCommit's `retry()` loop wraps this
 * boundary and falls back to a placeholder commit on exhaustion; PRD §5.1).
 *
 * @param repoRoot - The repository root (stagecoach's `cwd`; it reads this repo's index).
 * @param _diff - UNUSED (stagecoach reads the index). Kept for call-site compatibility.
 * @returns The trimmed descriptive commit message from stagecoach's stdout.
 * @throws {AgentError} On non-zero exit, spawn error, empty stdout, or a missing binary
 *   (via {@link resolveStagecoachBinary}).
 *
 * @example
 * ```ts
 * // stagecoach reads the staged index; the diff arg is ignored:
 * const msg = await generateCommitMessage(repoRoot);
 * // msg: 'feat(api): add endpoint'
 * ```
 */
export async function generateCommitMessage(
  repoRoot: string,
  _diff?: string
): Promise<string> {
  // stagecoach reads the REPO INDEX directly (system_context §5.1). _diff is UNUSED.
  const bin = resolveStagecoachBinary();

  // Build the argv vector (NEVER sh -c — spawn execs the binary directly).
  const argv: string[] = ['--dry-run', '--single'];

  // --format: forward PRP_COMMIT_STYLE only for explicit (non-auto) modes.
  // unset/auto → OMIT (stagecoach's native auto / history-learning default applies).
  const style = getPrpCommitStyle();
  if (style !== 'auto') {
    argv.push('--format', style);
  }

  // --provider: the resolved agent HARNESS (pi | claude-code), NOT the LLM provider.
  // --model: the resolved provider-qualified model (matches the old commit agent's balanced tier).
  argv.push('--provider', process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS);
  argv.push('--model', getModel('balanced'));

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', e => {
      reject(
        new AgentError(
          `stagecoach commit-message generation failed: ${e.message}`
        )
      );
    });
    child.on('close', code => {
      if (code !== 0) {
        reject(
          new AgentError(
            `stagecoach commit-message generation failed (exit ${code ?? 'null'})` +
              (stderr ? `: ${stderr.trim()}` : '')
          )
        );
        return;
      }
      resolve(out);
    });
  });

  const message = stdout.trim();
  if (!message) {
    throw new AgentError(
      'stagecoach commit-message generation failed: empty stdout'
    );
  }
  return message;
}
```

**`src/utils/git-commit.ts` imports** — REMOVE the now-unused (single-user was the old body):
`createCommitMessageAgent`, `buildCommitMessageSystemPrompt` (agent-factory import block ~47-48),
`createPrompt` (groundswell, ~44), `z` (zod, ~45), `getRecentCommitMessages` (~34),
`getPrpCommitStyleExamples` (~57). **KEEP** `getPrpCommitStyle` (~56 — used for `--format`).
**ADD:** `spawn` from `node:child_process`; `resolveStagecoachBinary` from `./stagecoach-resolver.js`;
`getModel` from `../config/environment.js`; `PRP_AGENT_HARNESS`, `DEFAULT_HARNESS` (add to the existing
`../config/constants.js` import block alongside `getPrpCommitStyle`).

**smartCommit call-site update** (~line 970) — the ONE edit to smartCommit's body:
```diff
-          const generated = await retry(
-            () => generateCommitMessage(diffResult.diff ?? ''),
+          const generated = await retry(
+            () => generateCommitMessage(repoRoot, diffResult.diff ?? ''),
```
(`repoRoot` is smartCommit's 1st param — already in scope. The gitDiff call + retry + fallback +
plumbing commit are ALL unchanged — see Known Gotchas §"keep gitDiff".)

**`tests/unit/utils/git-commit.test.ts`** — rewire (see Implementation Tasks). Add the binary-exec
mock surface; rewrite the `describe('generateCommitMessage')` block + the smartCommit fallback test;
remove the dead agent-mock infra + the obsolete empty-diff-guard tests.

### Success Criteria
- [ ] `generateCommitMessage(repoRoot)` spawns `resolveStagecoachBinary()` with `['--dry-run','--single', …]`, `cwd: repoRoot`, `env: process.env`, NO shell.
- [ ] `--provider` = harness id (`pi`|`claude-code`); `--model` = `getModel('balanced')`; `--format` appended only for non-`auto` `PRP_COMMIT_STYLE`.
- [ ] Non-zero exit / spawn error / empty stdout → `AgentError`; happy path → trimmed stdout.
- [ ] In-process agent imports removed from git-commit.ts; `getPrpCommitStyle` kept.
- [ ] smartCommit's retry/fallback/plumbing UNCHANGED (only the call-site signature updated).
- [ ] generateCommitMessage tests rewired to the spawn mock; dead agent-mock infra removed.
- [ ] JSDoc (Mode A) describes binary delegation + `--dry-run --single` + provider/style forwarding + §9.10.1.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `git-commit.test.ts` GREEN; git-commit.ts 100%.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
new function body, the exact import churn (remove 6 / keep 1 / add 4), the `--provider`-is-the-HARNESS
subtlety (NOT the LLM provider) + the no-side-effect env read (`process.env[PRP_AGENT_HARNESS] ??
DEFAULT_HARNESS`, mirroring `runAuthPreflight`), the repoRoot requirement (stagecoach reads the index →
needs `cwd`) + the resulting signature change + the 1-line smartCommit call-site edit, the spawn-based
impl (argv vector, never `sh -c`) + the three failure branches → AgentError, the smartCommit-keeps-gitDiff
decision (Option B, minimal blast radius), the full test-rewire scope (the generateCommitMessage
describe + smartCommit@1139 + the lint-forced dead-agent-mock removal), the T3 boundary, and the
executable validation commands. See `research/stagecoach-exec-design.md` for per-claim evidence.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the PRD section this implements
- docfile: PRD.md   # (provided in selected_prd_content §9.10.1)
  section: §9.10.1 "Commit-Message Generation (stagecoach delegation, message-only)"
  why: Pins the --dry-run --single message-only invocation, provider/model/--format forwarding, the
        "never sh -c" argv-vector rule, and the no-trailer determinism contract.
  critical: stagecoach reads the index (not stdin); stdout is the message; every failure → the pipeline's
        retry/fallback (so generateCommitMessage throws AgentError, never a silent fallback).

# AUTHORITATIVE RESEARCH — the stagecoach CLI contract + the index-not-stdin correction
- docfile: plan/015_459c7d9be558/architecture/stagecoach-and-agent-factory.md
  section: "PART 1" §1.3 (CLI flags: --dry-run/--single/--format/--provider/--model) + §1.4 (binary resolution)
  why: The exact flag semantics. CRITICAL: --provider is the agent CLI (pi/claude-code/opencode/…), i.e. the
        codebase's HARNESS — NOT the LLM provider. --format auto|plain|conventional|gitmoji.
- docfile: plan/015_459c7d9be558/architecture/system_context.md
  section: §5.1 "Stagecoach reads the repo index directly (NOT stdin)"
  why: "The PRD's 'feed the staged diff via stdin' is a design-doc imprecision. stagecoach snapshots the
        repo index itself via its own git write-tree." ⇒ _diff unused; repoRoot required for cwd.
  critical: Files MUST be staged before invoking (smartCommit stages them). process.cwd() is NOT safe
        (repoRoot may differ under --repo-root); pass repoRoot explicitly.

# THIS SUBTASK'S RESEARCH — the design + scope map + test-rewire plan
- docfile: plan/015_459c7d9be558/P1M2T2S1/research/stagecoach-exec-design.md
  section: "2. --provider is the HARNESS", "5. repoRoot required", "6. spawn impl", "7. import churn",
           "8. keep gitDiff", "9. test-rewire scope", "10. coverage branches"
  why: The --provider/harness distinction + the no-side-effect env read; the signature change rationale;
        the verbatim spawn impl; the exact imports to remove/keep/add; the keep-gitDiff decision; the
        forced test rewiring; the T3 boundary.

# CONTEXT — P1.M2.T1.S1 (the resolver PROVIDER) — assume it landed
- docfile: plan/015_459c7d9be558/P1M2T1S1/PRP.md
  why: Ships `resolveStagecoachBinary(): string` in src/utils/stagecoach-resolver.ts (throws AgentError on
        missing dep/binary; never a silent fallback) + the stagecoach-ai dep. This item CONSUMES it:
        `const bin = resolveStagecoachBinary(); spawn(bin, [...], {cwd, env})`. File-disjoint (resolver.ts
        vs git-commit.ts); assume it landed.

# THE FILE TO EDIT — current generateCommitMessage + smartCommit
- file: src/utils/git-commit.ts
  why: EDIT generateCommitMessage (~355-400) → the binary exec; import churn (~34-57); the smartCommit
        call-site (~970); the generateCommitMessage JSDoc (~300-352). smartCommit's gitDiff/retry/fallback/
        plumbing-commit are UNCHANGED. AgentError is already imported (~39). formatCommitMessage (~231)
        UNCHANGED (still layers the prefix, no trailer).
  pattern: "export async function generateCommitMessage(diff: string): Promise<string> { … createCommitMessageAgent … agent.prompt … }"
  critical: The OLD body is the only user of createCommitMessageAgent/buildCommitMessageSystemPrompt/
        createPrompt/z/getRecentCommitMessages/getPrpCommitStyleExamples (grep-verified) — remove all 6.
        KEEP getPrpCommitStyle (--format forwarding). The signature changes to (repoRoot, _diff?).

# THE RESOLVER (input — from T1.S1; read the CONTRACT, do NOT implement it)
- file: src/utils/stagecoach-resolver.ts   # (created by P1.M2.T1.S1)
  why: resolveStagecoachBinary(): string — returns the absolute binary path; throws AgentError if the
        stagecoach-ai dep or the native binary is missing. This item imports it; do NOT edit it (T1.S1).

# CONFIG GETTERS — provider/model/style resolution
- file: src/config/harness.ts
  why: READ-ONLY precedent for the no-side-effect harness read: runAuthPreflight() does
        `const harness = process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS;`. Mirror it for --provider.
        Do NOT call configureHarness() (startup side effects) or getResolvedProvider() (returns the LLM
        provider zai/anthropic — WRONG flag).
- file: src/config/environment.ts
  why: getModel('balanced') → the provider-qualified resolved model (e.g. 'zai/glm-5.2'). 'balanced' is
        the tier the OLD commit agent used. READ-ONLY import.
- file: src/config/constants.ts
  why: getPrpCommitStyle() → 'auto'|'plain'|'conventional'|'gitmoji'; PRP_AGENT_HARNESS + DEFAULT_HARNESS
        (the env-var name + 'pi'). Add PRP_AGENT_HARNESS/DEFAULT_HARNESS to the existing constants import.

# TEST PATTERN — the file being rewired
- file: tests/unit/utils/git-commit.test.ts
  why: EDIT. vi.mock('../../../src/agents/commit-message-agent.js')@41 + createCommitMessageAgent import@81
        + mockCreateCommitMessageAgent@113 back the agent path. describe('generateCommitMessage')@1181 +
        the smartCommit fallback test@1139 use the handle. mockGitDiff is used by smartCommit tests (KEEP —
        smartCommit still calls gitDiff). Rewire per Implementation Tasks.
  pattern: "mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent({ status:'success', data:'feat: x' }));"
  gotcha: After the rewrite, generateCommitMessage ignores the agent mock → its tests fail unless rewired to
        the spawn mock. mockCreateCommitMessageAgent becomes unused (lint) → remove the handle+import+mock.

# ERROR TYPE
- file: src/utils/errors.ts
  why: AgentError (constructor message-only; code PIPELINE_AGENT_LLM_FAILED) — already imported in
        git-commit.ts. isTransientError classifies it transient → smartCommit's retry() retries it.
        READ-ONLY.
```

### Current Codebase tree (relevant slice)
```bash
src/utils/git-commit.ts                     # EDIT — rewrite generateCommitMessage + imports + smartCommit call-site + JSDoc
src/utils/stagecoach-resolver.ts            # UNCHANGED (P1.M2.T1.S1 — resolveStagecoachBinary consumed)
src/agents/commit-message-agent.ts          # UNCHANGED (P1.M2.T3.S1 deletes it; this item stops importing it)
src/config/harness.ts                       # READ-ONLY (runAuthPreflight precedent for the harness read)
src/config/environment.ts                   # READ-ONLY (getModel)
src/config/constants.ts                     # READ-ONLY (getPrpCommitStyle, PRP_AGENT_HARNESS, DEFAULT_HARNESS)
tests/unit/utils/git-commit.test.ts         # EDIT — rewire generateCommitMessage tests + smartCommit@1139 + dead-mock removal
```

### Desired Codebase tree with files to be added/edited
```bash
src/utils/git-commit.ts                     # MODIFIED (generateCommitMessage rewrite + import churn + 1-line smartCommit call + JSDoc)
tests/unit/utils/git-commit.test.ts         # MODIFIED (spawn-mock rewire + dead agent-mock removal)
# No new files. No docs/*.md (DOCS: Mode A — JSDoc only).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — stagecoach --provider is the HARNESS id (pi | claude-code), NOT the LLM provider (zai/anthropic).
//   Resolve it WITHOUT side effects: process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS (mirrors runAuthPreflight
//   in harness.ts). Do NOT call configureHarness() (startup side effects) or getResolvedProvider() (returns the
//   LLM provider — WRONG flag). architecture §1.3: "--provider <name> … Provider/agent to shell out to … pi".

// CRITICAL — repoRoot is REQUIRED. stagecoach reads the repo index (system_context §5.1) → it MUST run with
//   cwd: repoRoot. The signature becomes generateCommitMessage(repoRoot: string, _diff?: string). Do NOT use
//   process.cwd() (fragile under --repo-root override → stagecoach reads the wrong index = silent corruption).
//   The contract's literal (diff?) signature is adjusted to (repoRoot, _diff?) — a forced, minimal change
//   (the cwd requirement is implied by "stagecoach reads the index").

// CRITICAL — stagecoach reads the INDEX, not stdin. _diff is UNUSED (underscore-prefixed). The OLD empty-diff
//   guard (`if (!diff.trim()) throw AgentError`) is REMOVED — stagecoach handles an empty index by exiting
//   non-zero → AgentError → retry → fallback. Do NOT re-add a diff guard.

// CRITICAL — argv vector, NEVER sh -c. Use child_process.spawn(bin, argv, {cwd, env, stdio}) — spawn execs
//   the binary directly (no shell). Do NOT use exec(`... ${...}`) or spawn(bin, {shell: true}). The binary
//   path comes from resolveStagecoachBinary() (T1.S1) — never a PATH lookup.

// CRITICAL — KEEP smartCommit's gitDiff call (Option B). The diff is computed + passed + IGNORED by
//   generateCommitMessage. Removing it cascades into the smartCommit describe's mockGitDiff tests (large
//   surface, T3.S2 territory). The ONLY smartCommit edit is the call-site: pass repoRoot as the 1st arg.
//   The retry/fallback/plumbing-commit are byte-identical.

// CRITICAL — REMOVE all 6 now-unused imports (createCommitMessageAgent, buildCommitMessageSystemPrompt,
//   createPrompt, z, getRecentCommitMessages, getPrpCommitStyleExamples) — each had a SINGLE user (the old
//   generateCommitMessage body; grep-verified). Lint errors on unused imports. KEEP getPrpCommitStyle.
//   Do NOT delete commit-message-agent.ts itself (P1.M2.T3.S1 owns that) — only stop importing from it.

// CRITICAL — Every failure → AgentError (NOT a silent fallback). Non-zero exit, spawn `error` event, empty
//   stdout, AND resolveStagecoachBinary's throw all become AgentError. This preserves smartCommit's retry
//   (transient) → fallback contract. stagecoach's OWN non-zero exit on a missing/empty index is the new
//   empty-index handling (replaces the old diff guard).

// GOTCHA — child_process is NOT currently imported by git-commit.ts (it uses simple-git + git plumbing
//   helpers). So `import { spawn } from 'node:child_process'` is the SOLE child_process usage → mocking
//   node:child_process in the test (vi.mock) is safe (no other consumer in the file).

// GOTCHA — getModel('balanced') returns the provider-qualified model (e.g. 'zai/glm-5.2'). 'balanced' is
//   the tier the OLD commit agent used (researcher role → balanced). Forward it verbatim as --model.

// GOTCHA — The test blast radius: mockCreateCommitMessageAgent is used at git-commit.test.ts lines 1139
//   (smartCommit fallback) + 1184/1204/1232/1251/1263 (generateCommitMessage describe@1181). ALL must be
//   rewired to the spawn mock; then the handle@113 + import@81 + top-of-file mock@41 are dead → remove
//   (lint-forced). mockGitDiff STAYS (smartCommit still calls gitDiff).

// GOTCHA — 100% coverage globally enforced (vitest.config.ts). Every branch of the new generateCommitMessage
//   must be hit: style!=='auto' (true+false), spawn close code===0 + code!==0, spawn `error` event,
//   !message (empty stdout). The spawn-mock tests cover all of them. resolveStagecoachBinary's own throw
//   is covered by mocking the resolver to throw in one test.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check (the multi-line JSDoc + the
//   Promise/spawn block may reflow).

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures). Gate =
//   typecheck + lint + format:check + the targeted tests/unit/utils/git-commit.test.ts.

// CRITICAL — Parallel execution: P1.M2.T1.S1 (running now) adds src/utils/stagecoach-resolver.ts + package.json
//   + its test. This item edits src/utils/git-commit.ts + tests/unit/utils/git-commit.test.ts. ZERO file
//   overlap, no merge conflict. This item CONSUMES resolveStagecoachBinary (assume T1.S1 landed).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. The signature changes from `(diff: string)` to `(repoRoot: string, _diff?: string)`.
The return type (`Promise<string>`) + the throw type (`AgentError`) are UNCHANGED. One new import
(`spawn`) + three config imports + the resolver; six unused imports removed.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/utils/git-commit.test.ts  (RED — rewire the mock surface FIRST)
  - ADD the binary-exec mock surface near the top (after the other vi.mocks):
      vi.mock('../../../src/utils/stagecoach-resolver.js', () => ({
        resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach'),
      }));
      vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
    Import the mocked spawn + resolver for per-test control:
      import { spawn } from 'node:child_process';
      import { resolveStagecoachBinary } from '../../../src/utils/stagecoach-resolver.js';
      const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
      const mockResolveBin = resolveStagecoachBinary as unknown as ReturnType<typeof vi.fn>;
    (getPrpCommitStyle is read from process.env via the REAL constants getter — control it with vi.stubEnv('PRP_COMMIT_STYLE', ...).)
  - ADD a helper that builds a fake spawn child emitting a close event:
      function fakeSpawnClose(opts: { code: number | null; stdout?: string; stderr?: string; error?: Error }) {
        return vi.fn((_bin, _argv, _opts) => {
          // return an EventEmitter-like child whose stdout/stderr are EventEmitter + emit 'close'/'error' async
          … (emit 'data' on stdout for opts.stdout, then 'close' with opts.code; or 'error' with opts.error)
        });
      }
    (Mirror the existing makeFakeAgent helper's style. The child needs .stdout/.stderr EventEmitters + .on('close'/'error').)
  - REWRITE describe('generateCommitMessage')@1181 — replace agent-mock tests with spawn-mock tests:
      * it('returns trimmed stdout on exit 0'): mockSpawn = fakeSpawnClose({code:0, stdout:'feat: add x\n'});
        expect(await generateCommitMessage('/fake/repo')).toBe('feat: add x');
        expect(mockResolveBin).toHaveBeenCalled(); expect(mockSpawn).toHaveBeenCalledWith('/fake/stagecoach',
        expect.arrayContaining(['--dry-run','--single']), expect.objectContaining({cwd:'/fake/repo', env: process.env})).
      * it('forwards --provider (harness) + --model'): assert mockSpawn called with argv containing
        '--provider', (process.env.PRP_AGENT_HARNESS ?? 'pi'), '--model', getModel('balanced').
      * it('appends --format for an explicit non-auto PRP_COMMIT_STYLE'): vi.stubEnv('PRP_COMMIT_STYLE','conventional');
        mockSpawn=fakeSpawnClose({code:0,stdout:'m'}); await generateCommitMessage('/r'); assert argv contains '--format','conventional'.
      * it('omits --format when PRP_COMMIT_STYLE is auto/unset'): delete process.env.PRP_COMMIT_STYLE;
        await generateCommitMessage('/r'); assert the argv passed to mockSpawn does NOT contain '--format'.
      * it('throws AgentError on non-zero exit'): mockSpawn=fakeSpawnClose({code:1,stderr:'nope'});
        await expect(generateCommitMessage('/r')).rejects.toThrow(AgentError); …toThrow(/exit 1/).
      * it('throws AgentError on empty stdout'): mockSpawn=fakeSpawnClose({code:0,stdout:'   \n'});
        await expect(generateCommitMessage('/r')).rejects.toThrow(AgentError); …toThrow(/empty stdout/).
      * it('throws AgentError on spawn error event'): mockSpawn=fakeSpawnClose({error:new Error('ENOENT')});
        await expect(generateCommitMessage('/r')).rejects.toThrow(AgentError); …toThrow(/ENOENT/).
      * it('propagates resolveStagecoachBinary failure'): mockResolveBin.mockImplementation(() => { throw new AgentError('not found'); });
        await expect(generateCommitMessage('/r')).rejects.toThrow(/not found/).
  - REMOVE the obsolete empty-diff-guard tests (@1217 generateCommitMessage('') → AgentError; @1225 whitespace).
  - REWRITE the smartCommit fallback test@1139 — replace mockCreateCommitMessageAgent.mockReturnValue(makeFakeAgent({status:'error'}))
    with mockSpawn=fakeSpawnClose({code:1}) (so generation fails → retry exhausts (COMMIT_RETRY_MAX=1) → buildFallbackCommitMessage).
    The assertion (placeholder flows through gitCommitTree + gitUpdateRefCAS) is UNCHANGED.
  - REMOVE the now-dead agent-mock infra (lint-forced after the above): the mockCreateCommitMessageAgent handle@113,
    the createCommitMessageAgent/buildCommitMessageSystemPrompt import@81, and the top-of-file
    vi.mock('../../../src/agents/commit-message-agent.js')@41. KEEP mockGitDiff (smartCommit still calls gitDiff).
  - EXPECTED NOW: the rewired generateCommitMessage tests FAIL (function still uses the agent) → RED.

Task 2: EDIT src/utils/git-commit.ts  (GREEN — imports + the rewrite + smartCommit call-site + JSDoc)
  - IMPORTS: remove createCommitMessageAgent/buildCommitMessageSystemPrompt/createPrompt/z/getRecentCommitMessages/
    getPrpCommitStyleExamples; KEEP getPrpCommitStyle; ADD spawn (node:child_process), resolveStagecoachBinary
    (./stagecoach-resolver.js), getModel (../config/environment.js), PRP_AGENT_HARNESS+DEFAULT_HARNESS (../config/constants.js).
  - REWRITE generateCommitMessage with the verbatim body in "Technical requirements" (signature (repoRoot, _diff?)).
  - UPDATE the smartCommit call-site (~970): generateCommitMessage(repoRoot, diffResult.diff ?? '').
  - REWRITE the generateCommitMessage JSDoc (Mode A, §9.10.1) per "Technical requirements".
  - DO NOT: touch smartCommit's gitDiff/retry/fallback/plumbing-commit; formatCommitMessage; restore_critical_files;
    commit-message-agent.ts; stagecoach-resolver.ts; use sh -c / shell:true; use process.cwd(); re-add a diff guard.
  - EXPECTED: Task 1's tests turn GREEN; the rest of git-commit.test.ts stays GREEN.

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts   # rewired + all existing smartCommit/format tests — GREEN.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts --coverage   # git-commit.ts 100%.
  - RUN: git diff --name-only → ONLY src/utils/git-commit.ts + tests/unit/utils/git-commit.test.ts.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures — not this item's concern).
  - EXPECTED: typecheck/lint/format clean; git-commit.test.ts green; git-commit.ts 100%. If coverage <100%, a
    spawn branch is unexercised — add the missing case (close code 0 vs !=0, error event, empty stdout, style
    auto vs non-auto). If a smartCommit test fails, the call-site signature update was missed.
```

### Implementation Patterns & Key Details
```ts
// ---- the new generateCommitMessage (argv vector; never sh -c; repoRoot for cwd) ----
export async function generateCommitMessage(repoRoot: string, _diff?: string): Promise<string> {
  const bin = resolveStagecoachBinary();
  const argv: string[] = ['--dry-run', '--single'];
  const style = getPrpCommitStyle();
  if (style !== 'auto') argv.push('--format', style);                       // explicit modes only
  argv.push('--provider', process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS); // HARNESS id, not LLM provider
  argv.push('--model', getModel('balanced'));                                 // resolved model
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, { cwd: repoRoot, env: process.env, stdio: ['ignore','pipe','pipe'] });
    let out = ''; let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', e => reject(new AgentError(`stagecoach … failed: ${e.message}`)));
    child.on('close', code => {
      if (code !== 0) { reject(new AgentError(`stagecoach … failed (exit ${code ?? 'null'})${stderr ? `: ${stderr.trim()}` : ''}`)); return; }
      resolve(out);
    });
  });
  const message = stdout.trim();
  if (!message) throw new AgentError('stagecoach … failed: empty stdout');
  return message;
}

// ---- the ONE smartCommit call-site edit (~970) ----
() => generateCommitMessage(repoRoot, diffResult.diff ?? ''),   // was: generateCommitMessage(diffResult.diff ?? '')

// ---- hermetic test: mock the resolver + spawn (sole child_process user in the file) ----
vi.mock('../../../src/utils/stagecoach-resolver.js', () => ({ resolveStagecoachBinary: vi.fn(() => '/fake/stagecoach') }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
// per-test: mockSpawn.mockImplementation(() => <EventEmitter child emitting 'data'+'close'>)
```

### Integration Points
```yaml
GIT-COMMIT.TS (src/utils/git-commit.ts):
  - generateCommitMessage: (diff:string) → (repoRoot:string, _diff?:string); body = stagecoach binary exec.
  - imports: −6 unused (createCommitMessageAgent/buildCommitMessageSystemPrompt/createPrompt/z/
    getRecentCommitMessages/getPrpCommitStyleExamples), +4 (spawn/resolveStagecoachBinary/getModel/
    PRP_AGENT_HARNESS+DEFAULT_HARNESS); KEEP getPrpCommitStyle.
  - smartCommit: 1-line call-site edit (pass repoRoot). gitDiff/retry/fallback/plumbing UNCHANGED.
  - PRESERVE: formatCommitMessage (still layers prefix, no trailer), restore_critical_files, the plumbing
    helpers (gitWriteTree/gitCommitTree/gitUpdateRefCAS), AgentError import.

DOWNSTREAM / UNCHANGED:
  - smartCommit callers (task-orchestrator.ts, bug-hunt-workflow.ts) — all pass {generateMessage:true};
    the delegation is internal to generateCommitMessage, so they are byte-identical.

CONSUMED (P1.M2.T1.S1 — assume landed):
  - resolveStagecoachBinary() from src/utils/stagecoach-resolver.ts (throws AgentError on missing).

SIBLING (sequenced after — clean handoff):
  - P1.M2.T3.S1: deletes commit-message-agent.ts + the createCommitMessageAgent/buildCommitMessageSystemPrompt
    exports from agent-factory. This item already stops importing them → T3 removes the provider.
  - P1.M2.T3.S2: deletes commit-message-agent.test.ts + confirms test cleanup. This item already removed
    the agent-mock from git-commit.test.ts (lint-forced).

DOCS (Mode A — JSDoc rides with the work):
  - JSDoc on generateCommitMessage (binary delegation + --dry-run --single + provider/style forwarding +
    stagecoach-reads-the-index + §9.10.1) is the only doc artifact. NO docs/*.md.
  - Commit message notes: stagecoach binary delegation (message-only); --provider=harness/--model/--format
    forwarding; stagecoach reads the index (diff unused, repoRoot required); smartCommit retry/fallback
    unchanged; consumes T1.S1's resolver; the keep-gitDiff decision; T3 deletes the dead agent.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — JSDoc + spawn block may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (signature change + new imports)
npm run lint           # eslint . --ext .ts — clean (MUST flag any unused import you forgot to remove)
npm run format:check   # prettier --check — clean
# Expected: all clean. If lint flags an unused import (createCommitMessageAgent/z/createPrompt/etc.), you
#   missed one — remove it. If typecheck errors on the smartCommit call-site, you forgot to pass repoRoot.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — rewired generateCommitMessage tests + ALL existing smartCommit/format tests:
npx vitest run tests/unit/utils/git-commit.test.ts
# Coverage on the touched source file (confirm 100% — every spawn branch hit):
npx vitest run tests/unit/utils/git-commit.test.ts --coverage
# Expected: green; git-commit.ts 100%. If coverage <100%, a spawn branch is unexercised (close 0 vs !=0,
#   error event, empty stdout, style auto vs non-auto) — add the case. If a generateCommitMessage test fails,
#   recheck the spawn mock's close/stdout emission + the argv assertions. If a smartCommit test fails, the
#   call-site signature update (pass repoRoot) was missed.
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures — not this item's concern).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm ONLY the 2 files changed (this item must not touch the resolver/agent/other utils):
git diff --name-only   # Expect ONLY src/utils/git-commit.ts + tests/unit/utils/git-commit.test.ts.
# Confirm the agent imports are gone + the new imports present + smartCommit call-site updated:
grep -n "createCommitMessageAgent\|buildCommitMessageSystemPrompt\|createPrompt\b" src/utils/git-commit.ts  # Expect ZERO (all removed).
grep -n "resolveStagecoachBinary\|spawn\|--dry-run" src/utils/git-commit.ts   # Expect the new exec path.
grep -n "generateCommitMessage(repoRoot" src/utils/git-commit.ts              # Expect the updated call-site.
grep -n "mockCreateCommitMessageAgent\|commit-message-agent" tests/unit/utils/git-commit.test.ts  # Expect ZERO (dead mock removed).
# Sibling regression — the resolver (T1.S1) + agent (still present until T3) are untouched by this item:
npx vitest run tests/unit/utils/stagecoach-resolver.test.ts 2>/dev/null || echo "(T1.S1's test — run if landed)"
# Expected: git diff shows only the 2 files; grep confirms the import churn + call-site + dead-mock removal.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP from generateCommitMessage itself (it spawns the local stagecoach binary; mocked in tests).
# Domain checks (record in commit message):
#   1. generateCommitMessage now execs the REAL stagecoach binary (--dry-run --single) — no in-process agent.
#   2. stagecoach reads the repo index (not stdin); _diff unused; repoRoot is cwd. process.cwd() is NOT used.
#   3. --provider is the harness id (pi|claude-code), --model is getModel('balanced'), --format is PRP_COMMIT_STYLE
#      (non-auto only). argv vector, never sh -c.
#   4. Every failure (non-zero exit / spawn error / empty stdout / missing binary) → AgentError → smartCommit's
#      retry → fallback. The commit path (staging, plumbing commit, task-prefix layer, restore_critical_files) is unchanged.
#   5. The in-process agent is no longer imported by git-commit.ts (commit-message-agent.ts itself is left for T3.S1).
# Optional E2E (requires the binary present — T1.S1 landed + npm install ran): in a staged test repo,
#   node -e "…" calling the compiled generateCommitMessage — but the targeted vitest suite (spawn-mocked) is the gate.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `npm run lint` clean (no unused imports); `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts` GREEN (rewired generateCommitMessage + existing smartCommit/format).
- [ ] `src/utils/git-commit.ts` at 100% coverage.
- [ ] `git diff --name-only` = ONLY `src/utils/git-commit.ts` + `tests/unit/utils/git-commit.test.ts`.

### Feature Validation
- [ ] `generateCommitMessage(repoRoot)` spawns `resolveStagecoachBinary()` with `['--dry-run','--single',...]`, `cwd: repoRoot`, `env`, NO shell.
- [ ] `--provider` = harness id; `--model` = `getModel('balanced')`; `--format` appended only for non-auto `PRP_COMMIT_STYLE`.
- [ ] Non-zero exit / spawn error / empty stdout → `AgentError`; exit 0 + non-empty stdout → trimmed message.
- [ ] smartCommit's retry/fallback/plumbing UNCHANGED (only the call-site passes repoRoot).

### Code Quality Validation
- [ ] The 6 now-unused imports removed; `getPrpCommitStyle` kept; 4 new imports added.
- [ ] argv vector (spawn, no shell); `cwd: repoRoot` (not process.cwd()); `_diff` unused (no diff guard).
- [ ] commit-message-agent.ts + stagecoach-resolver.ts UNCHANGED; formatCommitMessage/restore_critical_files/plumbing UNCHANGED.
- [ ] JSDoc (Mode A) on generateCommitMessage (§9.10.1 binary delegation + --dry-run --single + forwarding + reads-index).
- [ ] generateCommitMessage tests rewired to spawn mock; dead agent-mock infra removed (lint-forced); mockGitDiff kept.

### Documentation & Deployment
- [ ] JSDoc on generateCommitMessage is the only doc artifact (Mode A — rides with the code).
- [ ] No `docs/*.md`, README, package.json (T1.S1 owns the dep), `.env.example` changes.
- [ ] Commit message notes: stagecoach binary delegation (message-only); --provider=harness/--model/--format
      forwarding; stagecoach reads the index (diff unused, repoRoot required); smartCommit retry/fallback
      unchanged; consumes T1.S1's resolver; keep-gitDiff decision; T3 deletes the dead agent.

---

## Anti-Patterns to Avoid

- ❌ Don't use `sh -c` / `shell: true` / `exec(\`…\`)`. Use `child_process.spawn(bin, argv, {cwd, env, stdio})`
      — stagecoach is exec'd directly via an argv vector (PRD §9.10.1 "never sh -c"). The path comes from
      `resolveStagecoachBinary()` (T1.S1), never a PATH lookup.
- ❌ Don't pass `--provider` the LLM provider (`zai`/`anthropic` from `getResolvedProvider()`). stagecoach's
      `--provider` is the AGENT CLI = the codebase's HARNESS (`pi`|`claude-code`). Read it via
      `process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS` (mirrors `runAuthPreflight`); do NOT call
      `configureHarness()` (side effects).
- ❌ Don't use `process.cwd()` for stagecoach's cwd. repoRoot may differ (under `--repo-root`); stagecoach
      reading the wrong index = silent corruption. Pass `repoRoot` explicitly (the new required 1st param).
- ❌ Don't keep the empty-diff guard (`if (!diff.trim()) throw`). stagecoach reads the index; the diff param
      is unused. An empty index makes stagecoach exit non-zero → AgentError → retry → fallback (the new
      empty-index handling). Re-adding a diff guard is dead code.
- ❌ Don't leave any of the 6 now-unused imports (`createCommitMessageAgent`, `buildCommitMessageSystemPrompt`,
      `createPrompt`, `z`, `getRecentCommitMessages`, `getPrpCommitStyleExamples`). Lint errors on unused
      imports. KEEP `getPrpCommitStyle` (--format forwarding).
- ❌ Don't delete `commit-message-agent.ts` or `commit-message-agent.test.ts` — that's P1.M2.T3.S1/S2. This
      item only stops IMPORTING the agent into git-commit.ts (a consumer removal). T3 removes the provider.
- ❌ Don't remove smartCommit's `gitDiff({staged:true})` call (Option A). KEEP it (Option B) — the diff is
      computed + ignored; removing it cascades into smartCommit's mockGitDiff tests (T3.S2 territory). The
      ONLY smartCommit edit is the call-site signature (pass repoRoot).
- ❌ Don't change smartCommit's retry/fallback/plumbing-commit. The retry still wraps generateCommitMessage;
      AgentError is still transient; exhaustion still hits `buildFallbackCommitMessage` → `gitCommitTree`/
      `gitUpdateRefCAS`. Only the generateCommitMessage call-site (1 line) changes.
- ❌ Don't mock `node:child_process` partially if other code in git-commit.ts uses it — but (verified) git-commit.ts
      does NOT currently import child_process, so `vi.mock('node:child_process', () => ({ spawn: vi.fn() }))` is safe.
- ❌ Don't run the full `npm run test:run` as the gate — orthogonal pre-existing failures. Gate on typecheck +
      lint + format:check + the targeted `tests/unit/utils/git-commit.test.ts`.
- ❌ Don't forget the coverage branches — close code 0 vs !=0, spawn `error` event, empty stdout, style auto vs
      non-auto (the spawn-mock tests must hit each). resolveStagecoachBinary's throw is covered by mocking the
      resolver to throw in one test.
- ❌ Don't edit `stagecoach-resolver.ts` (T1.S1) or any `docs/*.md` (Mode A — JSDoc only).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a focused, well-bounded rewrite. The new function body is pinned verbatim (spawn-based,
argv vector, three failure branches → AgentError); the import churn is grep-verified (6 unused / 1 kept / 4
added); the `--provider`-is-the-HARNESS subtlety is documented with the exact no-side-effect resolution
(`process.env[PRP_AGENT_HARNESS] ?? DEFAULT_HARNESS`, mirroring `runAuthPreflight`); the repoRoot requirement
(stagecoach reads the index → needs cwd) is reconciled with a minimal signature change + a 1-line smartCommit
call-site edit; and the smartCommit retry/fallback/plumbing layer is explicitly UNCHANGED (keep-gitDiff =
Option B, minimal blast radius). The consumer contract ("return the message or throw AgentError") is preserved
exactly, so smartCommit's retry classification + fallback are untouched. The test-rewire scope is bounded
(rewire generateCommitMessage's direct tests + the one smartCommit test that drives it + the lint-forced dead
agent-mock removal) and the hermetic mock surface (resolver + spawn) makes 100% coverage deterministic. The
item is file-disjoint from the parallel P1.M2.T1.S1 (resolver/package.json) and hands off cleanly to T3
(agent deletion). Residual risks: (a) the spawn-mock's EventEmitter child shape (enumerated with a helper
mirroring the existing `makeFakeAgent`); (b) a missed unused import (caught by lint); (c) a prettier reflow
(auto-fixed via `npm run fix`); (d) the signature change rippling to a second call site (grep-confirmed
smartCommit is the only caller). No network/LLM unknowns from the rewrite itself — stagecoach is a local
binary mocked in tests.