# PRP — P1.M4.T1.S1: Implement denylist in `executeBashCommand` + comprehensive test coverage

> §9.10 "Commit Generation & Agent Tool Safety" — **M4.T1.S1 (the bash denylist)**. PRD §9.10.3 was
> written in direct response to **incident 2**: a `pi`+`glm` agent used the pipeline's **unguarded**
> bash tool (`spawn(command, { shell: true })`, zero filtering) plus the host's `repo`-scoped `gh`
> credentials to flip the target GitHub repo's **default branch** to a test worktree branch
> (`origin/HEAD -> origin/hack`). The exact command was never logged (agent bash calls bypass shell
> history), so the mitigation **removes the capability**: the bash tool now REFUSES — non-zero exit,
> clear error — any repo-remote-mutating or default-branch-mutating command BEFORE exec. This item
> ships the production gate (`isDeniedCommand`) + its wiring into `executeBashCommand` + a full
> test matrix. **Test-infra only as far as scope:** it edits `src/tools/bash-mcp.ts` (production) and
> `tests/unit/tools/bash-mcp.test.ts` (tests). The per-role tool *matrix* (which roles get `bash` at
> all) is the **next** item P1.M4.T2 — disjoint.
>
> **Parallel-coordination note:** P1.M3.T2.S1 (commit-message trailer/banner-absence tests) is being
> implemented concurrently; it edits `src/utils/git-commit.ts`, `tests/unit/utils/git-commit.test.ts`,
> and `tests/integration/smart-commit.test.ts`. **This item edits fully disjoint files**
> (`src/tools/bash-mcp.ts` + `tests/unit/tools/bash-mcp.test.ts`). No conflict, either order lands.

---

## Goal

**Feature Goal**: Add a **pre-exec, fail-closed denylist** to `executeBashCommand` in
`src/tools/bash-mcp.ts` so the bash tool refuses any repo-remote-mutating or default-branch-mutating
command (§9.10.3) before it reaches `spawn`, while still running every legitimate test/build/lint gate.
The denylist is a pure string-inspection function `isDeniedCommand(command): { denied; reason? }`
exported for direct unit testing and evaluated on the raw command string (case-insensitive) before
`spawn`. `shell: true` is **retained** (pipes/loops/`&&` need it) — the denylist is a pre-exec gate,
not a sandbox.

**Deliverable**:
1. **`src/tools/bash-mcp.ts`** — add exported `isDeniedCommand(command: string): DenylistResult` and
   the `DenylistResult` type (`{ denied: boolean; reason?: string }`), plus a private
   `invokesSubcommand(c, binary, sub)` regex helper. Wire a single denylist call into
   `executeBashCommand` **immediately after the `const { command, cwd, timeout } = input;` destructure
   and before the `workingDir` validation / `spawn`**: on `denial.denied`, `return` the refusal
   `BashToolResult` (`success:false`, `exitCode:126`, clear `error`, `timedOut:false`, `killed:false`)
   without spawning. Add JSDoc on both functions citing §9.10.3 + the fail-closed semantics.
2. **`tests/unit/tools/bash-mcp.test.ts`** — add a `describe('§9.10.3 bash denylist')` block with
   (a) pure-function `isDeniedCommand` tests for **every** denylisted pattern + obfuscation/compound
   variants; (b) **fail-closed** semantics tests; (c) an **allowlist** of must-pass test gates +
   read-only git + non-git commands that merely *contain* deny keywords; (d) `executeBashCommand`
   integration tests asserting a denied command does **not** call `spawn` and returns the refusal
   shape, while an allowed command still calls `spawn` (existing mock pattern).

**Success Definition**:
- `isDeniedCommand('git push')` → `{ denied: true, reason: <string> }`; likewise for every pattern in
  the §9.10.3 list (see Test Matrix). `git push origin main`, `git push -f`, `/usr/bin/git push`,
  `GIT PUSH`, `git  push` all denied.
- `isDeniedCommand('npx vitest run')`, `'npm test'`, `'npx tsc --noEmit'`, `'npm run lint'` →
  `{ denied: false }`. `git status`, `git diff`, `git log --grep="push"'`, `git log config`,
  `npm config get registry`, `npm run commit` → `{ denied: false }`.
- `executeBashCommand({ command: 'git push' })` resolves to the refusal shape and **`spawn` is not
  called**; `executeBashCommand({ command: 'npm test' })` calls `spawn` as today.
- The PRD §9.10.3 acceptance triple is demonstrable: refuses `git push`,
  `gh repo edit --default-branch <x>`, and `gh api -X PATCH repos/…/… -f default_branch=…`; still runs
  `npx vitest run` / `npm test` / `npx tsc --noEmit`.
- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npx vitest run tests/unit/tools/bash-mcp.test.ts` GREEN (existing + new tests). No existing test
  regresses (all current commands remain allowed).

## User Persona (if applicable)

**Target User**: Pipeline operator + every agent role that is granted the `bash` tool (today:
uniformly; after P1.M4.T2: the validation/QA role only). The threat actor is a misbehaving or
prompt-injected agent running inside the pipeline.

**Use Case**: An agent (validation) runs the test gate `npx vitest run` via bash → succeeds. The same
agent (or a compromised one) attempts `gh repo edit origin/hack --default-branch hack` or
`git push --force` → the tool refuses with a clear error BEFORE any process spawns; no remote/default
branch mutation is possible through the bash tool.

**Pain Points Addressed**: The bash tool currently executes ANY command with the host's credentials;
§9.10.3 incident 2 proved this flips a GitHub default branch. There is **zero** command filtering and
**zero** test coverage for any denylisted pattern today (architecture survey
`commit-tests-survey.md §5/§7`).

## Why

- **Closes the incident-2 root cause at the tool layer.** Removes the capability regardless of command
  wording (the original command was never logged).
- **Fails closed.** Ambiguous/undecidable matches (e.g. `git reset --hard` "against a shared ref") are
  refused — you cannot reliably detect "shared" from a raw string, so the safe default is deny.
- **Prerequisite for P1.M4.T2.** The per-role tool matrix (T2) removes `bash` from non-validation
  roles; this item (T1) ensures the `bash` that the validation role *does* get is fenced. Together they
  satisfy §9.10.3's "no agent tool can change a remote ref or the default branch."
- **No behavior change for legit use.** Test gates, linters, type-checks, and read-only git all pass
  unchanged.

## What

Edit **`src/tools/bash-mcp.ts`** (production) and **`tests/unit/tools/bash-mcp.test.ts`** (tests)
ONLY:

1. Add `DenylistResult` (interface) + `isDeniedCommand(command): DenylistResult` (exported) + a
   private `invokesSubcommand(c, binary, sub)` helper. Case-insensitive evaluation on the raw string.
2. In `executeBashCommand`, insert the denylist gate right after the input destructure; on denial,
   return the refusal `BashToolResult` (no spawn).
3. Add the denylist test block (pure `isDeniedCommand` + fail-closed + allowlist + `executeBashCommand`
   integration). Do not touch the existing test bodies.
4. JSDoc on `executeBashCommand` (add a §9.10.3 paragraph) and on `isDeniedCommand` (document the rule
  list + fail-closed semantics, citing §9.10.3 verbatim: "The bash tool MUST refuse — non-zero exit,
  clear error — any command that matches a repo-remote-mutating or default-branch-mutating operation
  before exec.").

### Success Criteria

- [ ] `isDeniedCommand` exported from `src/tools/bash-mcp.ts` (and importable in the test).
- [ ] Every §9.10.3 pattern returns `{ denied: true }` (see Test Matrix).
- [ ] Must-pass test gates + read-only git + deny-keyword-but-not-the-binary commands return
      `{ denied: false }`.
- [ ] `executeBashCommand` refuses denied commands without calling `spawn`; returns `exitCode:126`,
      `success:false`, a clear `error`, `timedOut:false`, `killed:false`.
- [ ] Existing `bash-mcp.test.ts` tests stay GREEN (no current command is denied).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] No file other than the two named is modified.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP includes the exact production function body order + insertion line, the verbatim refusal return
shape, the full reference implementation of `isDeniedCommand` + `invokesSubcommand`, the complete test
matrix (denied / fail-closed / allowed), the disambiguation from the unrelated test-local
`validateBashCommand`, and precise validation commands. No other codebase knowledge is required.

### Documentation & References

```yaml
# MUST READ — the requirement (verbatim acceptance triple + rule list)
- docfile: plan/015_459c7d9be558/P1M4T1S1/PRP.md  # this PRP's §9.10.3 quote + rule table
  why: the authoritative rule list + fail-closed mandate.
  section: "Implementation Blueprint → denylist rules" and "Test Matrix".

- file: src/tools/bash-mcp.ts
  why: THE production file. executeBashCommand body order + BashToolResult shape + exports.
  pattern: destructure → (NEW denylist gate) → workingDir validation → spawn({shell:true}) → Promise.
  gotcha: shell:true STAYS (pipes/loops need it). Denylist is a pre-exec string gate, not a sandbox.
           Existing test 'should pass full command string to spawn' uses command:'git status -sb' —
           that MUST stay allowed (git status is not in the deny list).

- file: tests/unit/tools/bash-mcp.test.ts
  why: THE test file. Mocks node:child_process.spawn (vi.fn()) + node:fs. Add the denylist describe block here.
  pattern: denied-command integration test asserts mockSpawn NOT called + refusal shape; allowed test
           asserts mockSpawn called (existing pattern). isDeniedCommand is pure → no mocks needed.
  gotcha: Do NOT edit existing test bodies — their commands are all allowlisted.

- docfile: plan/015_459c7d9be558/architecture/commit-tests-survey.md
  why: §5 (bash-mcp.test.ts) + §7 (forbidden-operations) + "Bash Denylist (§9.10.3)" confirm the gap
       ("complete gap — entirely new test coverage needed") and the placement ("pre-exec gate in
       executeBashCommand() before the spawn() call").
  section: "### 5. tests/unit/tools/bash-mcp.test.ts", "### 7. …forbidden-operations.test.ts",
           "### Bash Denylist (§9.10.3)".

- docfile: plan/015_459c7d9be558/architecture/stagecoach-and-agent-factory.md
  why: §2.7 documents the BashMCP registration + "No denylist currently exists… pre-exec denylist
       (fail-closed) in executeBashCommand before the spawn call."
  section: "### 2.7 BashMCP class registration pattern".

- docfile: plan/015_459c7d9be558/P1M4T1S1/research/bash-denylist-design.md
  why: companion design note — rule table, regex walkthrough, scope/coordination, must-pass verification.

# External — Node spawn(shell:true) semantics (confirms why shell:true is kept, not a change)
- url: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
  why: documents shell:true → '/bin/sh -c <command>' (pipes/&&/$() work). NO code change here; cited
       only to justify retaining shell:true per the existing in-file comment block.
```

### Current Codebase tree (scope)

```bash
src/tools/bash-mcp.ts                          # ← EDIT (add isDeniedCommand + wire gate + JSDoc)
tests/unit/tools/bash-mcp.test.ts              # ← EDIT (add denylist describe block)
tests/integration/forbidden-operations.test.ts # READ-ONLY (test-local validateBashCommand = DIFFERENT concern; do NOT touch)
src/agents/agent-factory.ts                    # READ-ONLY (P1.M4.T2 owns per-role tool matrix; NOT this item)
plan/015_459c7d9be558/architecture/*.md        # READ-ONLY (context)
```

### Desired Codebase tree with files to be added/edited

```bash
src/tools/bash-mcp.ts                          # EDIT (+ isDeniedCommand, + DenylistResult, + gate, + JSDoc)
tests/unit/tools/bash-mcp.test.ts              # EDIT (+ describe('§9.10.3 bash denylist'))
# No new files. No other src/ or tests/ file is touched.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — shell:true STAYS. The big comment block at the spawn() call in executeBashCommand
// documents that shell:false was abandoned because it broke `for…done`, `&&`, `|`, `$()`. The
// denylist is a pre-exec STRING gate evaluated BEFORE spawn — it is NOT a sandbox and does NOT
// change the spawn options.

// CRITICAL — fail closed. PRD §9.10.3: "Ambiguous matches fail closed (refuse)." Anything we cannot
// decide (e.g. whether a `git reset --hard` target is a "shared ref") is REFUSED. Prefer a false
// positive (block) over a false negative (let a remote mutation through). The only commands that
// MUST pass are test/build/lint gates + read-only git.

// CRITICAL — do NOT confuse with the test-local helper. tests/integration/forbidden-operations.test.ts
// defines a file-local validateBashCommand(command):{allowed,error?} covering 'prd/run-prd.sh'/'tsk'
// (§5.2 anti-recursion) + .gitignore patterns. That is a DIFFERENT concern and DIFFERENT shape.
// Our production isDeniedCommand(command):{denied,reason?} covers ONLY §9.10.3 remote/default-branch
// mutation. Do not merge, import, or replicate the anti-recursion list here (out of scope).

// GOTCHA — the subcommand is the FIRST POSITIONAL token after git/gh (after optional global flags).
// So `git log config` (a file named config) is ALLOWED, and `git log --grep="push"` is ALLOWED —
// neither has the denied subcommand as the first positional. The matcher uses a left boundary
// `(?:^|[^\w./@+-])` so `widget/git-push.sh` / `agit` / `digital` do not false-match.

// GOTCHA — exitCode for refusal: use 126 ("command found, execution refused"). The result MUST still
// populate timedOut:false and killed:false (the watchdog never fired).

// GOTCHA — the denylist gate runs BEFORE the cwd validation. The existing test
// 'should validate working directory exists' uses command:'ls' (not denied) → still reaches the cwd
// throw. A denied command with a bad cwd is simply refused (never validates cwd). No regression.
```

## Implementation Blueprint

### Data models and structure

```ts
/** Result of a §9.10.3 denylist evaluation. */
export interface DenylistResult {
  /** True iff the command must be refused before exec (fail-closed). */
  denied: boolean;
  /** Human-readable reason when denied. */
  reason?: string;
}
```
`BashToolResult` (existing) is unchanged; the refusal reuses its exact shape.

### denylist rules (reference implementation)

```ts
/**
 * Match `binary` invoked with `sub` as its FIRST POSITIONAL subcommand.
 * Tolerates an optional path prefix (`/usr/bin/git`), optional `.exe`, and
 * common global flags (`-C <dir>`, `-c <kv>`, `--xxx` booleans) before `sub`.
 * The subcommand is the first positional, so `git log config` does NOT match
 * `config`, and `git log --grep="push"` does NOT match `push`. `c` is lowercased.
 */
function invokesSubcommand(c: string, binary: string, sub: string): boolean {
  const globalFlags = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--[a-z][\w-]*))*`;
  const re = new RegExp(
    String.raw`(?:^|[^\w./@+-])(?:[\w.@+-]*/)?` + binary + String.raw`(?:\.exe)?`
      + globalFlags + String.raw`\s+` + sub + String.raw`\b`
  );
  return re.test(c);
}

/**
 * §9.10.3 pre-exec bash denylist. Inspect the raw command string (case-
 * insensitive) and refuse any repo-remote-mutating or default-branch-mutating
 * operation BEFORE spawn. Ambiguous matches FAIL CLOSED (refuse).
 *
 * PRD §9.10.3: "The bash tool MUST refuse — non-zero exit, clear error — any
 * command that matches a repo-remote-mutating or default-branch-mutating
 * operation before exec."
 */
export function isDeniedCommand(command: string): DenylistResult {
  const c = command.toLowerCase();

  // Rule A — ANY reference to default_branch (catch-all; evaluated first so it
  // also catches `gh api … -f default_branch=…` before Rule D).
  if (/default[_-]branch/.test(c)) {
    return { denied: true, reason: 'references default_branch — repo default-branch mutation is human-only (PRD §9.10.3)' };
  }

  // Rule B — curl/wget to api.github.com.
  if (/\b(curl|wget)\b/.test(c) && c.includes('api.github.com')) {
    return { denied: true, reason: 'curl/wget to api.github.com — raw GitHub API surface (PRD §9.10.3)' };
  }

  // Rule C — gh repo (any subcommand).
  if (invokesSubcommand(c, 'gh', 'repo')) {
    return { denied: true, reason: 'gh repo (any subcommand) mutates repo settings (PRD §9.10.3)' };
  }

  // Rule D — gh api writes / ambiguous. Explicit write method, OR field flags
  // (which imply a POST body) => write intent => fail closed. Bare
  // `gh api <endpoint>` and `gh api -X GET` are reads => allowed.
  if (invokesSubcommand(c, 'gh', 'api')) {
    if (/-x\s*(patch|post|delete|put)\b/.test(c)) {
      return { denied: true, reason: 'gh api -X PATCH|POST|DELETE|PUT is a GitHub-API write (PRD §9.10.3)' };
    }
    if (/(?:^|\s)-[fF]\b/.test(c) || /--raw-field\b/.test(c) || /--field\b/.test(c)) {
      return { denied: true, reason: 'gh api with -f/-F/--field/--raw-field implies a write body (PRD §9.10.3, fail-closed)' };
    }
    // bare read: fall through (allowed)
  }

  // Rule E — git remote-mutating / state-mutating subcommands.
  for (const sub of ['push', 'remote', 'update-ref', 'config', 'rebase', 'commit']) {
    if (invokesSubcommand(c, 'git', sub)) {
      return { denied: true, reason: `git ${sub} mutates git state/remotes (PRD §9.10.3: remote/state mutation is human-only)` };
    }
  }

  // Rule F — git reset --hard. "against a shared ref" is UNDECIDABLE from a raw
  // string => blanket deny (fail-closed).
  if (invokesSubcommand(c, 'git', 'reset') && c.includes('--hard')) {
    return { denied: true, reason: 'git reset --hard denied — shared-ref qualifier undecidable, fail closed (PRD §9.10.3)' };
  }

  return { denied: false };
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/bash-mcp.ts — add the denylist (pure function + type + helper)
  - ADD (above executeBashCommand, or directly above the BashMCP class): the DenylistResult
    interface, the private invokesSubcommand(c, binary, sub) helper, and the exported
    isDeniedCommand(command): DenylistResult function — VERBATIM as in "denylist rules" above.
  - ADD isDeniedCommand to the value export line:
      export { bashTool, executeBashCommand, isDeniedCommand };
    and add `export type { DenylistResult }` alongside the existing `export type { BashToolInput, BashToolResult }`.
  - NAMING: isDeniedCommand (camelCase fn), DenylistResult (PascalCase type), reason field (string).
  - JSDOC: cite §9.10.3 + "Ambiguous matches fail closed" on isDeniedCommand (see reference above).

Task 2: EDIT src/tools/bash-mcp.ts — wire the gate into executeBashCommand
  - INSERT immediately after `const { command, cwd, timeout = DEFAULT_TIMEOUT } = input;` and BEFORE
    the `// PATTERN: Validate working directory exists` block:
      // §9.10.3 pre-exec denylist (fail-closed). Inspect the raw command string BEFORE spawn.
      const denial = isDeniedCommand(command);
      if (denial.denied) {
        return {
          success: false, stdout: '', stderr: '',
          exitCode: 126,
          error: `[bash denylist] Command refused: ${denial.reason}`,
          timedOut: false, killed: false,
        };
      }
  - PRESERVE: everything else in executeBashCommand (workingDir validation, spawn({shell:true}),
    watchdog, close/error handlers). shell:true is UNCHANGED.
  - JSDOC: add a §9.10.3 paragraph to executeBashCommand's existing JSDoc noting the pre-exec
    denylist + fail-closed semantics.

Task 3: EDIT tests/unit/tools/bash-mcp.test.ts — import isDeniedCommand + add the test block
  - UPDATE the import from '../../../src/tools/bash-mcp.js' to also import isDeniedCommand.
  - ADD a new top-level describe('§9.10.3 bash denylist') (or nested under executeBashCommand)
    containing the Test Matrix below. Reuse the existing mockSpawn setup for the integration cases.
  - DO NOT modify existing test bodies (all their commands remain allowed — verified).
  - NAMING: test titles like 'denies git push', 'allows npx vitest run', 'fail-closed on gh api -X PUT'.

Task 4: VERIFY (no edit)
  - RUN: npx vitest run tests/unit/tools/bash-mcp.test.ts            # GREEN (existing + new)
  - RUN: npm run typecheck && npm run lint && npm run format:check   # clean
  - RUN (whole-suite delta, optional): npx vitest run --reporter=dot # this file green; other files unaffected
```

### Test Matrix (must all be present)

```yaml
isDeniedCommand — DENIED (each asserts { denied: true } and reason is a non-empty string):
  git remote-mutation / state-mutation:
    - 'git push'
    - 'git push origin main'
    - 'git push -f origin HEAD'
    - 'git push --force'
    - '/usr/bin/git push'                       # path prefix
    - 'git.exe push'                            # .exe suffix
    - 'GIT PUSH'                                # case-insensitive
    - 'git  push'                               # extra whitespace
    - 'git remote'                              # bare
    - 'git remote -v'                           # read-only form STILL denied per spec (any subcommand)
    - 'git remote add origin https://github.com/x/y'
    - 'git update-ref refs/heads/main abc123'
    - 'git config user.name "x"'                # write
    - 'git config --list'                       # read-only form STILL denied per spec
    - 'git rebase main'
    - 'git commit -m "msg"'
  gh:
    - 'gh repo edit owner/repo --default-branch hack'   # ALSO default_branch (Rule A) — denied
    - 'gh repo create'
    - 'gh repo view'                             # read-only form STILL denied (any subcommand)
    - 'gh api -X PATCH repos/o/r -f default_branch=hack'  # ALSO default_branch
    - 'gh api -X POST repos/o/r -f x=y'
    - 'gh api -X DELETE repos/o/r'
    - 'gh api repos/o/r -f x=y'                  # field flag => POST write => fail-closed
  http:
    - 'curl https://api.github.com/repos/o/r'
    - 'wget -qO- https://api.github.com/'
  default_branch catch-all:
    - 'echo $default_branch'
    - 'gh api repos/o/r -f default_branch=main'
  compound / obfuscation:
    - 'echo a && git push'                       # boundary after &&  — second git matches
    - 'true; git push origin main'
    - 'git status; git commit -m x'              # the commit segment matches
  git reset --hard:
    - 'git reset --hard origin/main'
    - 'git reset --hard HEAD~1'

isDeniedCommand — FAIL-CLOSED / ambiguous (denied):
    - 'git reset --hard'                         # shared-ref qualifier undecidable => deny
    - 'gh api -X PUT repos/o/r'                  # PUT is a write not in PATCH|POST|DELETE => deny
    - 'gh api repos/o/r -F type@file'            # -F typed field => write => deny

isDeniedCommand — ALLOWED (each asserts { denied: false }) — THE GATES:
    # must-pass test/build/lint gates
    - 'npx vitest run'
    - 'npx vitest run tests/unit/tools/bash-mcp.test.ts'
    - 'npm test'
    - 'npx tsc --noEmit'
    - 'npm run lint'
    - 'npm run build'
    - 'npm run typecheck'
    - 'npm run format:check'
    - 'npx prettier --check .'
    - 'node dist/index.js'
    # read-only git (first positional is a read subcommand)
    - 'git status'
    - 'git status -sb'                           # ★ used by existing test — MUST stay allowed
    - 'git diff'
    - 'git diff HEAD~1'
    - 'git log --oneline'
    - 'git show HEAD'
    - 'git log --grep="push"'                    # 'push' inside a value, not a positional => allowed
    - 'git log config'                           # 'config' is a path here, not the subcommand => allowed
    # deny-keyword present but NOT the target binary's subcommand
    - 'npm config get registry'                  # 'config' but no git => allowed
    - 'npm run commit'                           # 'commit' but no git => allowed
    - 'echo remote'                              # 'remote' but no git => allowed
    - 'cat config.json'                          # 'config' substring, no git => allowed
    # gh reads
    - 'gh api repos/o/r'                         # bare read (GET default) => allowed
    - 'gh api -X GET repos/o/r'                  # explicit read => allowed
    - 'gh pr view 123'                           # not gh repo / gh api => allowed (pr is out of scope)
    # benign
    - 'echo test'
    - 'ls -la'
    - 'pwd'
    - ''                                         # empty command => allowed (existing test)

executeBashCommand integration (mocked spawn):
    - denied command 'git push': spawn NOT called (expect(mockSpawn).not.toHaveBeenCalled());
      result.success===false, result.exitCode===126, result.error matches /denylist/i,
      result.timedOut===false, result.killed===false, result.stdout==='', result.stderr===''
    - denied command 'gh repo edit --default-branch x': spawn NOT called; same shape
    - allowed command 'npm test': spawn IS called with shell:true (existing behavior preserved)
    - allowed command 'git status -sb': spawn IS called (regression guard for the existing test's cmd)
```

### Implementation Patterns & Key Details

```ts
// executeBashCommand — the gate (insert after destructure, before workingDir validation):
async function executeBashCommand(input: BashToolInput): Promise<BashToolResult> {
  const { command, cwd, timeout = DEFAULT_TIMEOUT } = input;

  // §9.10.3 PRE-EXEC DENYLIST (fail-closed). Inspect raw command BEFORE spawn.
  const denial = isDeniedCommand(command);
  if (denial.denied) {
    return {
      success: false, stdout: '', stderr: '',
      exitCode: 126,                                  // 126 = "found, refused"
      error: `[bash denylist] Command refused: ${denial.reason}`,
      timedOut: false, killed: false,
    };
  }

  // PATTERN: Validate working directory exists  (unchanged)
  const workingDir = typeof cwd === 'string' ? (() => { … })() : undefined;
  …  // spawn({ shell: true }) etc. UNCHANGED
}

// Test — denied command never spawns:
it('refuses git push without spawning', async () => {
  const result = await executeBashCommand({ command: 'git push origin main' });
  expect(mockSpawn).not.toHaveBeenCalled();
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(126);
  expect(result.error).toMatch(/denylist/i);
  expect(result.timedOut).toBe(false);
  expect(result.killed).toBe(false);
});
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
PRODUCTION-WIRING:
  - executeBashCommand is called by: BashMCP.execute_bash() and the MCP tool executor registered in
    the BashMCP constructor (this.registerToolExecutor('bash','execute_bash', …)). The gate sits INSIDE
    executeBashCommand, so BOTH the direct method path AND the MCP-tool path are fenced — no call-site
    changes needed.
DOWNSTREAM (P1.M4.T2 — NOT this item):
  - agent-factory.ts will scope the bash tool to the validation role only. That item depends only on
    executeBashCommand's UNCHANGED signature; the denylist is transparent to it.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json ; expect clean (incl. new export)
npm run lint             # eslint . --ext .ts ; expect clean for src/tools/bash-mcp.ts + test
npm run format:check     # prettier --check ; expect clean
# If prettier complains: npx prettier --write src/tools/bash-mcp.ts tests/unit/tools/bash-mcp.test.ts
# Expected: zero errors. Read output and fix before proceeding.
```

### Level 2: Unit Tests (the target file)

```bash
npx vitest run tests/unit/tools/bash-mcp.test.ts
# Expected: all existing tests GREEN (no command they use is denied) AND the new §9.10.3 block GREEN.
# If a NEW denied-case test unexpectedly returns {denied:false}, the matcher is too narrow — re-check
# the regex (use the reference implementation verbatim). If an ALLOWED-case test returns {denied:true},
# the matcher is too broad — confirm the denied keyword is actually the target binary's subcommand.
```

### Level 3: Integration Testing (the §9.10.3 acceptance triple)

```bash
# Demonstrate the PRD §9.10.3 acceptance triple via the new integration tests (mocked spawn):
npx vitest run tests/unit/tools/bash-mcp.test.ts -t "denylist"
# Expected: includes passing tests that (1) refuse 'git push', (2) refuse
# 'gh repo edit --default-branch <x>', (3) refuse 'gh api -X PATCH … -f default_branch=…',
# AND (4) still run 'npx vitest run' / 'npm test' / 'npx tsc --noEmit' (spawn called).

# Smoke (optional, real shell — confirms legit commands still execute end-to-end):
node -e "const {BashMCP}=require('./dist/tools/bash-mcp.js'); new BashMCP().execute_bash({command:'echo ok'}).then(r=>console.log(r))" 2>/dev/null || echo "build-dist-optional-skip"
# Expected: legit echo returns success:true; a denied command returns exitCode:126 without exec.
```

### Level 4: Creative & Domain-Specific Validation (security grep guards)

```bash
# Guard 1 — isDeniedCommand is exported from production:
grep -nE "export \{[^}]*isDeniedCommand" src/tools/bash-mcp.ts        # expect a match
# Guard 2 — the gate is wired before spawn (denylist call precedes the spawn try-block):
grep -nE "isDeniedCommand\(command\)" src/tools/bash-mcp.ts          # expect a match in executeBashCommand
# Guard 3 — shell:true is RETAINED (not removed by accident):
grep -nE "shell: true" src/tools/bash-mcp.ts                         # expect a match
# Guard 4 — every §9.10.3 token has a test:
for tok in 'git push' 'git remote' 'git update-ref' 'git config' 'git rebase' 'git commit' 'git reset --hard' 'gh repo' 'gh api -X' 'api.github.com' 'default_branch'; do
  printf '%-22s ' "$tok"; grep -qF "$tok" tests/unit/tools/bash-mcp.test.ts && echo "HAS TEST" || echo "MISSING TEST";
done
# Expected: all print "HAS TEST".
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run tests/unit/tools/bash-mcp.test.ts` GREEN (existing + new denylist block).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] Level-4 grep guards all pass (export wired, gate before spawn, shell:true retained, every token tested).

### Feature Validation (§9.10.3 acceptance)

- [ ] Refuses `git push` (and `-f`, path-prefixed, `.exe`, uppercased, extra-whitespace, compound).
- [ ] Refuses `gh repo edit --default-branch <x>` (and any `gh repo …`).
- [ ] Refuses `gh api -X PATCH repos/…/… -f default_branch=…` (write method + default_branch).
- [ ] Still runs `npx vitest run` / `npm test` / `npx tsc --noEmit` (spawn called, success path intact).
- [ ] No denied command calls `spawn`; refusal returns `exitCode:126`, clear `error`, `timedOut:false`.
- [ ] Fail-closed: `git reset --hard`, `gh api -X PUT`, `gh api … -f …` all refused.

### Code Quality Validation

- [ ] Follows existing file style (2-space indent, single quotes, trailing commas, JSDoc on exports).
- [ ] `isDeniedCommand` is pure (no I/O, no side effects) and exported for direct testing.
- [ ] No production file other than `src/tools/bash-mcp.ts` is modified.
- [ ] No test file other than `tests/unit/tools/bash-mcp.test.ts` is modified (forbidden-operations.test.ts untouched).
- [ ] `executeBashCommand`'s public signature is unchanged (transparent to P1.M4.T2).

### Documentation & Deployment

- [ ] JSDoc on `isDeniedCommand` documents the rule list + fail-closed semantics + cites §9.10.3 verbatim.
- [ ] JSDoc on `executeBashCommand` notes the pre-exec denylist gate.
- [ ] Commit message follows the project task-prefix convention (P1.M4.T1.S1) with no `[PRP Auto]` banner
      and no `Co-Authored-By` trailer (§5.1/§9.10.2).

---

## Anti-Patterns to Avoid

- ❌ Don't remove `shell: true` — it's required for pipes/loops/`&&`/`$()`; the denylist is a pre-exec
  string gate, NOT a sandbox. (See the in-file comment block at the spawn call.)
- ❌ Don't match deny keywords as bare substrings — `commit`/`config`/`remote`/`push` appear in benign
  commands (`npm run commit`, `npm config get registry`, `git log --grep="push"`, `cat config.json`).
  Always scope to the target binary's first-positional subcommand via `invokesSubcommand`.
- ❌ Don't merge/import the test-local `validateBashCommand` (anti-recursion/.gitignore) — different
  concern (§5.2), different shape. This item is §9.10.3 remote/default-branch mutation only.
- ❌ Don't relax the fail-closed mandate. `git reset --hard` and ambiguous `gh api` MUST refuse —
  "undecidable" ⇒ deny, never allow.
- ❌ Don't add the §5.2 anti-recursion commands (`prd`/`run-prd.sh`/`tsk`) to `isDeniedCommand` — out of
  scope; that's a separate concern with its own (test-local) handling today.
- ❌ Don't edit `forbidden-operations.test.ts` or `agent-factory.ts` — out of scope (latter = P1.M4.T2).
- ❌ Don't change `executeBashCommand`'s signature or the `spawn` options — only insert the gate.

---

## Confidence Score

**9/10** — one-pass success likelihood. The defect/gap is precisely characterized (zero filtering
today), the production insertion point and refusal shape are exact (after the destructure, before
workingDir/spawn; reuse `BashToolResult` with `exitCode:126`), the reference `isDeniedCommand` +
`invokesSubcommand` implementation is given verbatim with a left-boundary/first-positional matcher that
avoids false positives on benign keyword collisions, the test matrix enumerates every §9.10.3 pattern +
fail-closed + allowlist + integration, and the scope is cleanly bounded (two files, disjoint from the
parallel commit-format item). Residual risk: regex edge cases in exotic global-flag forms (e.g.
`git --git-dir foo push`) may false-negative — but the acceptance tests and realistic attack commands
(`git push`, `gh repo edit --default-branch …`) all use the immediate-subcommand form, which the
matcher handles exactly.