### 9.8 Repository Root Resolution (Upward `.git` Traversal)

Cross-cutting requirement that `hack` **locate the repository root by walking up from the invocation directory to the nearest directory containing `.git`, and re-root all path resolution there** — so the pipeline can be run from _anywhere_ within a repository, not only from the root. A git repository is a **hard prerequisite** for the tool to function.

#### 9.8.1 Problem

Today every relative path is resolved against `process.cwd()`, and the entry point **never calls `process.chdir()`**:

- `resolve('PRD.md')` and `resolve('plan')` appear at ~20 call sites (`src/cli/index.ts`, every `src/cli/commands/*` constructor default, `session-manager`, `session-utils`, `prp-pipeline`).
- `repoRoot = process.cwd()` is hard-coded in `task-orchestrator`, `cleanup-runner`, and `git-commit` (Smart Commit, `restore_critical_files`).
- `git-mcp.ts`’s `validateRepositoryPath` checks for `.git` only at the _given_ path — no upward traversal.

Consequence: `hack` **must** be launched from the repository root. Running it from `src/` or `docs/` resolves `PRD.md`/`plan/` against the wrong directory, silently reading a non-existent `PRD.md` or scribbling a stray `plan/` in a subdirectory. There is no “run from anywhere in the repo” UX, and the `.hack` file (§9.7) — which lives at the repo root — could not be located from a subdirectory without this traversal.

#### 9.8.2 Resolution Algorithm

1. Capture `INVOCATION_CWD = process.cwd()` at the very top of `main()`, **before** any path resolution or `chdir`.
2. Beginning at `INVOCATION_CWD`, walk upward: at each directory, test whether it contains a child entry named `.git` (a directory **or** a file — see §9.8.4). If it does, that directory is the **repo root**.
3. If the current directory has no `.git`, ascend to its parent and repeat.
4. Stop with success at the first directory containing `.git` (nearest ancestor wins — this is the working-tree root, correct for worktrees and submodules per §9.8.4).
5. If the filesystem root is reached without finding `.git`, **fail hard** per §9.8.5.
6. On success: canonicalize with `realpathSync(repoRoot)` (collapse symlinks), then `process.chdir(repoRoot)` so every subsequent `resolve(...)`/`process.cwd()`/`repoRoot` call site resolves against the repo root without per-site changes.

- The walk is bounded by the filesystem root and performs a constant number of `stat` calls (one or two per level), so it is effectively free.

#### 9.8.3 Implementation Strategy & Explicit-Path Semantics

- **Strategy: `process.chdir(repoRoot)` once at bootstrap.** This is preferred over threading an explicit `repoRoot` through ~20 call sites because it makes every existing `resolve('PRD.md')`/`resolve('plan')`/`process.cwd()` site correct with **zero** per-site edits, and because spawned agent subprocesses inherit `cwd = repoRoot`, which is the desired behavior (agents operate inside the repo). The `chdir` happens **after** `parseCLIArgs()` (so `--help`/`--version`/usage errors short-circuit during parse and work with no repo) and **before** the `.hack`/`.env` load and `configureEnvironment()` (so the project files are read from the repo root).
- **`INVOCATION_CWD` is captured first and retained** so that explicit user-supplied paths can be resolved against _where the user was_, not the new cwd:
  - **Explicit `--prd <path>` / `--file <path>` / `--session <id>` / `--repo-root <path>`** resolve relative to **`INVOCATION_CWD`** (the directory the user typed the command in). Most intuitive: the path you type is relative to where you are.
  - **Default paths** (`./PRD.md`, `./plan/`) resolve relative to the **new** `process.cwd()` (the repo root) — i.e. `<repoRoot>/PRD.md`, `<repoRoot>/plan/`. This is what makes “run from anywhere” work: from `src/deep/`, the default PRD is still `<repoRoot>/PRD.md`.
- The resolved repo root and `INVOCATION_CWD` are exposed (read-only) to the rest of the codebase for diagnostics and for the few call sites that genuinely need the original invocation directory.

#### 9.8.4 `.git` Directory vs `.git` File (Worktrees & Submodules)

- A directory is a repo root if it contains `.git` as **either** a directory (normal clone) **or** a file (git worktree or submodule, where `.git` is a `gitdir: <path>` pointer).
- **Worktrees:** in a linked worktree, the `.git` _file_ sits at the worktree root. The traversal stops there, so the “repo root” for `hack`’s purposes is the **worktree root** (where `PRD.md`/`plan/` live), _not_ the common dir’s main checkout. This is correct: `hack` operates on the working tree it was invoked in.
- **Submodules:** a submodule has its own `.git` (file or dir). The traversal stops at the **submodule root**, not the superproject root — each submodule is treated as its own repository, which matches how the pipeline’s git operations and `plan/` directories are scoped.
- Parsing the `gitdir:` pointer is **not** required for root detection; only the _presence_ of `.git` (dir or file) matters. (Future work MAY follow the pointer for advanced worktree-relative logic, but it is out of scope here.)
- Bare repositories (`.git` with no working tree) are not supported working directories for `hack`; invoking from within a bare repo’s directory is treated like any other dir and the traversal continues upward.

#### 9.8.5 No-Repository Behavior (Hard Error)

**Git is a hard prerequisite for this project to function** — the pipeline commits via Smart Commit (§5.1), reads/writes `plan/` alongside the repo, and runs git-backed recovery (§5.1 `tasks.json` Restore, `restore_critical_files`). Therefore:

- If the §9.8.2 walk reaches the filesystem root without finding `.git`, the tool **MUST abort with a hard error and exit code 1**, _before_ creating any session, reading `.hack`/`.env`, or invoking any agent.
- The error message MUST be actionable, naming: the invocation directory searched from, the fact that no ancestor contains `.git`, and the remediation — either run from within a git repository, or pass `--repo-root <path>` (§9.8.6) to pin a root explicitly.
- This mirrors the §9.2.7 fail-fast preflight philosophy: a missing prerequisite is caught at startup with one clear message, not deep inside the first git operation.
- **`--help`/`--version`/invalid-flag usage errors are exempt** — they are handled by Commander during `parseCLIArgs()` and `process.exit()` _before_ the traversal runs, so `hack --help` works anywhere even though git is otherwise mandatory. This is the only intentional exception and it falls out naturally from the bootstrap ordering (parse before traverse).

#### 9.8.6 The `--repo-root <path>` Override

- `--repo-root <path>` skips the upward search and uses `<path>` as the repo root (resolved against `INVOCATION_CWD`, then `realpathSync`’d, then `chdir`’d to).
- It MUST verify that `<path>` contains `.git` (dir or file); if not, it fails with the same hard error as §9.8.5 (git is required even when the root is explicit).
- Use cases: unusual layouts where the nearest `.git` is not the intended root (e.g. a monorepo where the PRP project lives in a subdir but should operate against the outer repo — though note `PRD.md`/`plan/` would then resolve against the outer root), test harnesses that pin a temp repo, and CI that wants to be explicit.
- `--repo-root` is also the escape hatch if the automatic walk ever picks the wrong ancestor (e.g. nested repos).

#### 9.8.7 Effect on Subcommands & Child Processes

- **All subcommands benefit automatically.** Because the fix is a single bootstrap `chdir`, every command — the main pipeline _and_ `hack task`/`status`, `hack artifacts`, `hack cache`, `hack inspect`, `hack validate-state`, `hack config` — resolves `PRD.md`/`plan/`/`.hack` at the repo root when launched from any subdirectory. No per-command changes are required.
- **Child processes (bugfix sub-pipelines, §4.4 / §9.2.5):** the parent `chdir`s to the repo root before spawning children, so children inherit `cwd = repoRoot`. A child that itself walks up from a `plan/…/bugfix/…` directory would re-discover the same repo root; either way the result is identical. The nested-execution guard (§9.2.5) semantics are unchanged — it inspects `PLAN_DIR`/`SKIP_BUG_FINDING`, not cwd.
- **Agent subprocesses:** inherit `cwd = repoRoot`, so file/shell tools inside agents operate against the repo root, which is the intended behavior (agents work on the repo, not the invocation subdir).

#### 9.8.8 Interaction with `.hack` Discovery & Other Subsystems

- **Shared traversal with §9.7:** the project `.hack` / `.hack.local` / `.env` are read from the repo root located by _this_ walk — there is exactly one upward walk at startup, and it simultaneously locates `.git` (the repo root) and the project config files that live there. The global `~/.hack` (§9.7.3) is independent of the walk.
- **§9.2.4 endpoint safeguard / §9.2.7 preflight:** unaffected; they read `process.env`, which is populated from `.hack` (loaded after the `chdir`) and the shell. The `chdir` does not alter env.
- **§4.3 delta detection / §5.1 Smart Commit / `restore_critical_files`:** these call git against `process.cwd()`, which is now guaranteed to be the repo root, so they operate correctly from any launch directory (previously they would have run against the invocation subdir).
- **`PRD.md` hashing (§4.1) and include expansion (§2.3):** the default `PRD.md` is now `<repoRoot>/PRD.md`; include directives remain project-root-relative to the entry PRD’s directory (§2.3), which is the repo root for the default case — consistent with the existing contract.

#### 9.8.9 Acceptance Criteria

- `hack` launched from `src/`, `docs/`, or any nested subdirectory resolves `PRD.md`, `plan/`, `.hack`, and `.env` at the repository root exactly as a root-launched run does; `process.cwd()` during the run equals the repo root.
- `hack --help` and `hack --version` succeed with exit 0 from a directory that is **not** inside any git repository (they short-circuit before traversal).
- Any operational invocation of `hack` (including `--validate-prd`, `--dry-run`, `hack task`, `hack config show`) from outside any git repository exits 1 with a single actionable “not a git repository” message naming the invocation directory and the `--repo-root` remediation; no session directory is created and no agent is invoked.
- A git **worktree** is correctly detected via its `.git` _file_; the repo root resolves to the worktree root and `PRD.md`/`plan/` are read/written there.
- A git **submodule** resolves to the submodule root, not the superproject root.
- `--repo-root /explicit/path` pins the root and skips the search; it errors if `/explicit/path` lacks `.git`.
- An explicit `--prd ./relative/PRD.md` is resolved against the **invocation** directory, while an omitted `--prd` resolves to `<repoRoot>/PRD.md`.
- A bugfix child process spawned from a `plan/…/bugfix/…` directory resolves the same repo root and `.hack` as its parent.
- Smart Commit (§5.1) and `restore_critical_files` invoked during a run launched from a subdirectory operate against the repository root (no stray commits or `plan/` directories in subdirectories).
