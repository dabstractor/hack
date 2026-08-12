# Research — §9.10.3 Bash denylist (`isDeniedCommand` in `bash-mcp.ts`)

Companion research for PRP P1.M4.T1.S1. Captures the production-code shape, the
insertion point, the reference matcher design, and the disambiguation from the
existing test-local helper.

## 1. Production code under edit — `src/tools/bash-mcp.ts` (330 lines)

- `executeBashCommand(input: BashToolInput): Promise<BashToolResult>` — the
  private function (exported at file bottom alongside `bashTool`). Body order:
  1. `const { command, cwd, timeout = DEFAULT_TIMEOUT } = input;` (destructure)
  2. `workingDir` validation (`existsSync`/`realpathSync`; throws on missing cwd)
  3. `let child: ChildProcess;` + `try { child = spawn(command, { cwd: workingDir, stdio: ['ignore','pipe','pipe'], shell: true }) }`
  4. `new Promise(resolve => {...})` with SIGTERM→SIGKILL watchdog + `close`/`error` handlers.

- **`BashToolResult` shape** (the refusal return MUST match it):
  `{ success: boolean; stdout: string; stderr: string; exitCode: number | null;
     error?: string; timedOut: boolean; killed: boolean }`

- **Insertion point for the denylist:** immediately AFTER step 1 (destructure),
  BEFORE step 2 (cwd validation). Rationale: a denied command must never reach
  spawn; placing it first also means a denied command with a bad cwd is still
  refused (and a non-denied command still throws on bad cwd as before — existing
  test `'should validate working directory exists'` uses `command:'ls'`, which is
  not denied, so it proceeds to the cwd throw as expected → no regression).

- **Refusal return** (per contract: `success:false`, non-zero `exitCode`, clear msg):
  ```ts
  return { success: false, stdout: '', stderr: '',
           exitCode: 126,                            // 126 = "found, refused (permission)"
           error: `[bash denylist] Command refused: ${denial.reason}`,
           timedOut: false, killed: false };
  ```

- **`shell: true` STAYS** — required for pipes/loops/`&&`/`$()` (the big comment
  block at the spawn call documents why `shell:false` was abandoned). The
  denylist is a pre-exec STRING gate, not a sandbox replacement.

- **Exports today:** `export type { BashToolInput, BashToolResult }; export { bashTool, executeBashCommand };`
  → ADD `isDeniedCommand` (+ `DenylistResult` type/interface) to the value export.

## 2. Disambiguation: do NOT confuse with the test-local helper

`tests/integration/forbidden-operations.test.ts:241` defines a file-local
`validateBashCommand(command): { allowed: boolean; error?: string }` that checks
`FORBIDDEN_PIPELINE_COMMANDS` (`prd/run-prd.sh`, `./tsk`, `tsk`, `npm run prd`)
and `.gitignore` patterns. This is the §5.2 **anti-recursion / gitignore**
concern — a COMPLETELY DIFFERENT concern from §9.10.3 remote-mutation. It is
test-only (never wired to production). Our production `isDeniedCommand` is a
DIFFERENT function, DIFFERENT shape (`{denied, reason?}`), DIFFERENT scope
(remote/default-branch mutation). **Do not merge them.** (Architecture survey
`commit-tests-survey.md §7` calls the test-local helper "effectively testing
nothing in production code" — that is the gap this item fills in *production*.)

## 3. The denylist rules (reference implementation) — case-insensitive on raw string

Design principles (from PRD §9.10.3 + item contract):
- "fail closed" — ambiguous/undecidable matches are REFUSED.
- only the §9.10.3 remote/default-branch patterns; NOT the §5.2 anti-recursion set.
- must-pass list: `npx vitest run`, `npm test`, `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, `npm run typecheck`, `npm run format:check`, `npx prettier`,
  read-only git (`git status`, `git diff`, `git log`, `git show`).

### 3a. Helper — "binary invoked with subcommand S as its first positional"
Tolerates an optional path prefix (`/usr/bin/git`), optional `.exe`, and common
git global flags (`-C <dir>`, `-c <kv>`, `--xxx` booleans) before the subcommand.
The subcommand is the FIRST positional token (so `git log config` does NOT
false-match `config`, and `git log --grep="push"` does NOT false-match `push`).
Left-boundary `(?:^|[^\w./@+-])` so `widget/git-push.sh` / `agit` don't match.

```ts
function invokesSubcommand(c: string, binary: string, sub: string): boolean {
  // c is already lowercased.
  const globalFlags = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--[a-z][\w-]*))*`;
  const re = new RegExp(
    String.raw`(?:^|[^\w./@+-])(?:[\w.@+-]*/)?` + binary + String.raw`(?:\.exe)?`
      + globalFlags + String.raw`\s+` + sub + String.raw`\b`
  );
  return re.test(c);
}
```
Compound commands are covered: in `echo a && git push` the `&` is a valid left
boundary, so the second `git` matches. In `$(git push)` the `(` is a boundary.

### 3b. Rule set (evaluate top-down, first hit wins)
| # | Rule | Trigger (on lowercased `c`) | Why |
|---|------|------------------------------|-----|
| A | any `default_branch` ref | `/default[_-]branch/` | default-branch mutation is human-only (catches `-f default_branch=`, `--default-branch`, env refs) |
| B | curl/wget → api.github.com | `/\b(curl|wget)\b/` AND `c.includes('api.github.com')` | GitHub API surface via raw HTTP |
| C | `gh repo` (any sub) | `invokesSubcommand(c,'gh','repo')` | repo-settings mutation (edit/create/…) |
| D | `gh api` writes/ambiguous | `invokesSubcommand(c,'gh','api')` AND (`-X PATCH\|POST\|DELETE\|PUT` OR `-f`/`-F`/`--field`/`--raw-field`) | explicit write method, OR field flags imply a POST body (fail-closed). Bare `gh api <endpoint>` / `gh api -X GET` = read → ALLOW |
| E | git mutating subcommands | `invokesSubcommand(c,'git', sub)` for sub in `push, remote, update-ref, config, rebase, commit` | remote/state mutation |
| F | `git reset --hard` | `invokesSubcommand(c,'git','reset')` AND `c.includes('--hard')` | "shared ref" qualifier is UNDECIDABLE from a string → blanket deny (fail-closed) |

`default_branch` (Rule A) is evaluated FIRST so it catches `gh api … -f default_branch=…`
even before Rule D's `-f` branch (belt-and-suspenders).

## 4. Existing test file — `tests/unit/tools/bash-mcp.test.ts` (~590 lines)

- Mocks `node:child_process` (`spawn: vi.fn()`) and `node:fs`. So new
  `executeBashCommand` denial tests assert `spawn` is **NOT called** for denied
  commands and the result is the refusal shape; allow tests assert `spawn` **IS**
  called (existing pattern). `isDeniedCommand` is a pure function → unit-test
  directly with no mocks.
- Existing commands used in current tests (must stay ALLOWED): `echo test`,
  `git status -sb` (★ used by "should pass full command string to spawn"),
  `sleep 1/100`, `cat file.txt`, `ls -la`, `pwd`, `false`, `invalid-command`,
  `true`, `mixed-output`, `slow-cmd`, `failing-command`, `restricted-command`,
  `hang`, `stubborn`, `test`, `''`. All verified to NOT match any rule.
- Describe blocks: `BashMCP class`, `bashTool schema`, `executeBashCommand`
  (nested), `edge cases` → add a new top-level `describe('§9.10.3 bash denylist')`
  (or nested under `executeBashCommand`) for `isDeniedCommand` + denial-integration.

## 5. Scope boundary / coordination
- **Production:** only `src/tools/bash-mcp.ts` (add `isDeniedCommand`+`DenylistResult`,
  wire into `executeBashCommand`, JSDoc citing §9.10.3). No other src file.
- **Tests:** only `tests/unit/tools/bash-mcp.test.ts`. Do NOT touch
  `forbidden-operations.test.ts` (its test-local helper is a separate concern).
- **Disjoint from parallel P1.M3.T2.S1** (commit-message trailer/banner tests in
  `git-commit.test.ts`/`smart-commit.test.ts`/`git-commit.ts`) — no shared files.
- **Consumed by P1.M4.T2** (per-role tool matrix in `agent-factory.ts`): the
  validation agent's `bash` tool will route through this same `executeBashCommand`,
  so the denylist is enforced regardless of role wiring — T2 just removes `bash`
  from non-validation roles. No interface contract T2 depends on beyond
  `executeBashCommand(input)`'s existing signature (unchanged).
- Anti-recursion commands (`prd`/`run-prd.sh`/`tsk`) are §5.2, OUT of scope here.