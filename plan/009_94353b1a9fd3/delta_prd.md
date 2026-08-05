# Delta PRD — `.hack` Configuration File, Repository-Root Resolution & Breakdown-in-Progress Handling

> **Scope.** This delta covers three changes to the master PRD (the completed session 008 backlog remains the baseline):
>
> 1. **§9.7 — `.hack` Configuration File (NEW):** a project-local, version-controllable TOML config file with three-tier layering (global `~/.hack` → project `<repoRoot>/.hack` → gitignored `<repoRoot>/.hack.local`), a secrets policy, validation, and a `hack config` subcommand.
> 2. **§9.8 — Repository Root Resolution (NEW):** upward `.git` traversal from the invocation directory, `process.chdir(repoRoot)` at bootstrap, `INVOCATION_CWD` capture for explicit-path semantics, `--repo-root <path>` override, and a hard error when no git repository is found.
> 3. **§5.3 — Tasks-Not-Yet-Generated Window / Breakdown-in-Progress (NEW):** graceful handling of the transient state where a session directory exists but `tasks.json` has not yet been written by the Architect Agent.
>
> **Coupled, framing-only changes** (no standalone task — they are realized by the implementing phases): the §3 "bootstrap layer" paragraph, the §8 load-bearing bootstrap-ordering note, the §9.5 roadmap items for repo-root resolution and the `.hack` loader, and the §9.2.1 expansion from a 3-source overview to the 7-layer precedence model (the §9.7 loader realizes the `.hack` layers and the env-over-file rule; the §9.8 resolver realizes repo-root awareness).
>
> **Already complete — NO new work.** The §5.1 "Commit Message Format (Standardized Task-Prefix)" text and the §9.2.2 `PRP_COMMIT_FORMAT` bullet were added as documentation that catches up to **already-built** code: `formatCommitMessage`, `buildTaskPrefix`, `parseItemPosition`, and `getPrpCommitFormat()` all exist in `src/utils/git-commit.ts` / `src/config/constants.ts` and already implement the elide-trailing-levels, replace-decoration (no `[PRP Auto]` banner), bugfix-own-numbering, `plain`-opt-out, and degrade-to-plain behavior. These changes are noted for awareness only; this delta creates **no** task for them.
>
> **Cosmetic.** A garbled `@path/to/file.md` include-directive line in §2.3 was cleaned up; the resolver code is already correct from session 008. No work.

---

## Phase 1 — Repository Root Resolution (Upward `.git` Traversal) — §9.8

**Goal.** Make `hack` runnable from any subdirectory of a repository by walking up to the nearest `.git`, `chdir`-ing there, and resolving all default paths (`PRD.md`, `plan/`, `.hack`, `.env`) against that root. Git is a **hard prerequisite**: a missing repo aborts at startup. This phase runs **first** in the bootstrap sequence because the `.hack` project layers (Phase 2) live at the repo root.

**Research note.** `src/index.ts:main()` currently calls `parseCLIArgs()` (line ~112) then immediately `configureEnvironment()` (line ~128) — there is **no** `chdir`, no upward traversal, and no `INVOCATION_CWD` capture. `repoRoot = process.cwd()` is hard-coded in `src/utils/git-commit.ts:553`, `src/core/cleanup-runner.ts`, and `src/core/task-orchestrator.ts:1259`. `src/tools/git-mcp.ts:195` (`validateRepositoryPath`) checks `.git` only at the given path — no upward walk. No `--repo-root` flag exists. All of this is documented in `plan/008_.../architecture/system_context.md` (file inventory) and the §9.8.1 problem statement.

### Milestone 1.1 — Resolver Engine, Bootstrap Wiring & CLI Override

**Task 1.1.1 — Core resolver, bootstrap `chdir`, and `INVOCATION_CWD` semantics**

- **Subtask 1.1.1.S1 — `resolveRepositoryRoot` + bootstrap `chdir` in `main()`**
  - **INPUT:** None (foundational bootstrap step).
  - **LOGIC:** Create `src/utils/repo-root.ts` exporting `resolveRepositoryRoot(startDir: string, opts?: { explicit?: string }): { repoRoot: string; invocationCwd: string }`. Algorithm (§9.8.2): beginning at `startDir`, walk upward; at each directory test whether it contains a child entry `.git` as **either** a directory (normal clone) **or** a file (worktree/submodule `gitdir:` pointer — §9.8.4). Stop at the first ancestor with `.git` (nearest-ancestor wins). If the filesystem root is reached without `.git`, throw a typed error (`NotARepositoryError`) carrying the searched-from dir and the `--repo-root` remediation. On success, canonicalize via `realpathSync(repoRoot)`. Wire into `src/index.ts:main()`: capture `INVOCATION_CWD = process.cwd()` at the very top (before any path resolution), call `resolveRepositoryRoot(INVOCATION_CWD)` **after** `parseCLIArgs()` and **before** `configureEnvironment()`, then `process.chdir(repoRoot)`. Expose the resolved `repoRoot` + `INVOCATION_CWD` read-only (a small module singleton or fields passed where needed). `--help`/`--version`/usage errors already short-circuit during `parseCLIArgs()` and must **not** reach the traversal.
  - **OUTPUT:** `src/utils/repo-root.ts`; `main()` updated to traverse + `chdir` before env config. Consumed by 1.1.1.S2 and Phase 2.
  - **DOCS (Mode A):** JSDoc on `resolveRepositoryRoot` documenting the dir-or-file `.git` detection, nearest-ancestor rule, and hard-error contract; note the bootstrap ordering in a comment at the `main()` insertion site.

- **Subtask 1.1.1.S2 — `--repo-root <path>` flag + explicit-path vs default-path semantics**
  - **INPUT:** Resolver from 1.1.1.S1.
  - **LOGIC:** Add a `--repo-root <path>` CLI flag in `src/cli/index.ts` (it skips the upward search, resolves `<path>` against `INVOCATION_CWD`, then `realpathSync` + `chdir`). Verify the explicit path contains `.git` (dir or file); otherwise fail with the same `NotARepositoryError` as the walk. Enforce the explicit-path semantics (§9.8.3): explicit `--prd`/`--file`/`--session` resolve against **`INVOCATION_CWD`**; omitted/default paths resolve against the **new** `process.cwd()` (repo root). Because the fix is a single bootstrap `chdir`, **no per-call-site changes** are required at the ~20 `resolve('PRD.md')`/`resolve('plan')` sites — verify a representative sample resolves to `<repoRoot>/...`. Update the `PRPPipeline` constructor call site only if it passes `repoRoot` explicitly.
  - **OUTPUT:** `--repo-root` flag wired; explicit-vs-default path semantics verified. Completes Task 1.1.1.
  - **DOCS (Mode A):** Add `--repo-root` to the CLI reference (mirror §9.8.6).

**Task 1.1.2 — Hard-error behavior, child-process inheritance, and acceptance verification**

- **Subtask 1.1.2.S1 — No-repository hard error + child/agent inheritance**
  - **INPUT:** Resolver + bootstrap wiring from 1.1.1.S1.
  - **LOGIC:** On `NotARepositoryError`, `main()` must abort with a single actionable message naming the invocation directory searched from, the fact that no ancestor contains `.git`, and the `--repo-root` remediation, then `process.exit(1)` — **before** creating any session, reading `.hack`/`.env`, or invoking any agent (§9.8.5). Confirm `--help`/`--version`/invalid-flag still exit during `parseCLIArgs()` (they never reach the traversal). Verify child-process inheritance (§9.8.7): because the parent `chdir`s before spawning bugfix children and agent subprocesses, they inherit `cwd = repoRoot` — confirm `git-mcp.ts`/`git-commit.ts` operations now run against the repo root regardless of launch directory. Add tests: launched-from-subdir resolves repo root; worktree `.git` file detected; submodule resolves to submodule root; no-repo exits 1 with no session created; `--help` works outside any repo.
  - **OUTPUT:** Hard-error path + inheritance verified. Completes Milestone 1.1 and Phase 1.
  - **DOCS (Mode A):** JSDoc on `NotARepositoryError`.

---

## Phase 2 — The `.hack` Configuration File — §9.7

**Goal.** A single TOML config file capturing **every** tunable default (§9.2.2 env-style settings **and** §5.3 `parseCLIArgs()` CLI flags), with three-tier layering, a secrets policy that keeps secrets out of version control, validation, and a `hack config` subcommand. This phase **realizes** the §9.2.1 7-layer precedence model (defaults → global `~/.hack` → project `.hack` → `.hack.local` → `.env` → shell env → CLI flags) and the env-over-file rule.

**Research note.** There is **no application-level config file today** — `package.json` lists `dotenv` but it is never imported in `src/`; `.env` is loaded only externally (direnv/`.envrc`, the `n` package in `tests/setup.ts`). All defaults live in `src/config/constants.ts` and `configureEnvironment()` (`src/config/environment.ts`). No TOML parser dependency exists. No `hack config` subcommand exists. See `plan/008_.../architecture/system_context.md` "Environment Configuration". Depends on Phase 1 (project layers are read from the resolved repo root).

### Milestone 2.1 — TOML Loader, Three-Tier Layering, Secrets Policy & Validation

**Task 2.1.1 — TOML parse, three-tier discovery/merge, and env-over-file seeding**

- **Subtask 2.1.1.S1 — TOML parser dependency + parse/validate module**
  - **INPUT:** None (foundational).
  - **LOGIC:** Add a TOML parser dependency (TOML 1.0; `@iarna/toml` or `smol-toml`) to `package.json`. Create `src/config/hack-config.ts` with `parseHackFile(path: string): ParsedHackConfig` (§9.7.4): UTF-8, reject a leading BOM with a clear error, single document, preserve comments at write time (the `init` template is heavily commented). Parse into a typed `ParsedHackConfig` keyed by `[section]` → key. All keys are lowercase snake_case; type information is carried for validation in 2.1.2.
  - **OUTPUT:** TOML dep + parse module. Consumed by 2.1.1.S2.
  - **DOCS (Mode A):** JSDoc on `parseHackFile` documenting the format, BOM rejection, and key casing.

- **Subtask 2.1.1.S2 — Three-tier discovery, layered merge, env-over-file seeding**
  - **INPUT:** Parser from 2.1.1.S1; resolved `repoRoot` from Phase 1.
  - **LOGIC:** Implement `loadHackConfig(repoRoot: string): MergedHackConfig` (§9.7.3) that discovers and parses three optional files in tier order: global (`$HACK_CONFIG_HOME/config` → `$XDG_CONFIG_HOME/hack/config` → `~/.hack`), project (`<repoRoot>/.hack`, committable), project-local (`<repoRoot>/.hack.local`, gitignored). Each higher tier overwrites the same key from a lower tier (per-section/key merge). Then **seed `process.env` only for keys not already set** by a higher §9.2.1 layer — i.e. the merged file value is the default and real shell env / `.env` override it (the env-over-file rule, §9.2.1 / §9.7.3). A missing file at any tier is not an error. Wire the load into `main()` **after** the Phase 1 `chdir` and **before** `configureEnvironment()` (§9.7.9 / §8 bootstrap ordering). This insertion point realizes the §9.2.1 expanded layering in code.
  - **OUTPUT:** Layered loader + env seeding wired into bootstrap. Consumed by 2.1.2 and 2.2.
  - **DOCS (Mode A):** JSDoc on `loadHackConfig` documenting the tier order, env-over-file seeding rule, and the §9.7.9 bootstrap position.

**Task 2.1.2 — Secrets policy, validation, and error handling**

- **Subtask 2.1.2.S1 — Secrets refusal + type/range validation + error semantics**
  - **INPUT:** Loader from 2.1.1.S2.
  - **LOGIC:** Enforce the secrets policy (§9.7.6): if any secret-bearing key (`[auth] override_key`, `[auth] zai_api_key`, `[auth] anthropic_api_key`, `[auth] anthropic_auth_token`, or any key ending in `_key`/`_token`/`_secret`/`_password`) is present in the **committable project `.hack`**, emit a **hard error** naming the file, offending key, and remediation (move to `.hack.local` or an env var), and abort before any agent run. `.hack.local` (gitignored) is the only tier permitted to hold secrets; map `[auth] override_key` there to `PRP_API_KEY`. Empty/whitespace-only secret values are treated as "not configured" (never forwarded — §9.2.7 empty-string policy). Implement validation (§9.7.7): unknown section → warn once and continue (lenient, forward-compatible); unknown key in a known section → warn once with file/section/key and ignore (catch typos like `reseaerch_depth`); type mismatch / out-of-range value (`[tasks_lock] poll_ms = -5`, `[harness] name = "foo"`, `[cli] mode = "fast"`) → **hard error** naming file, key, offending value, expected type/range, accepted values, abort before any agent run. All warnings/errors go to **stderr** synchronously (§9.6-compliant; the pino logger is configured _after_ config load since `--log-level` may itself come from `.hack`). With resolved `--log-level debug`, log each key with its **source layer** and resolved value, masking secret values.
  - **OUTPUT:** Secrets policy + validation. Completes Milestone 2.1.
  - **DOCS (Mode A):** JSDoc on the validation/secrets functions documenting hard-error vs warn semantics and the stderr requirement.

### Milestone 2.2 — Schema Mapping, `hack config` Subcommand & Bootstrap Reconciliation

**Task 2.2.1 — Exhaustive schema mapping and canonical-name resolution**

- **Subtask 2.2.1.S1 — Full schema map (all tunables) with env-var + CLI-flag seeding**
  - **INPUT:** Loader + validation from 2.1.
  - **LOGIC:** Implement the exhaustive schema in `hack-config.ts` mapping every `[section].key` from §9.7.5 to exactly one env var and/or CLI flag: `[models] high/balanced/fast` → `PRP_MODEL_*`; `[endpoint] base_url` → `PRP_API_BASE_URL`; `[harness] name` → `PRP_AGENT_HARNESS`; `[pipeline] parallel_research/research_depth/research_timeout_seconds/issue_retry_max/commit_format` → `PARALLEL_RESEARCH`/`RESEARCH_DEPTH`/`RESEARCH_TIMEOUT`/`ISSUE_RETRY_MAX`/`PRP_COMMIT_FORMAT` (the latter already built — do not duplicate); `[commit] retry_max/retry_delay_ms/retry_delay_cap_ms/classifier_retry_max`; `[bug_hunt] finder_agent/results_file/fix_scope`; `[validation] agent/timeout_seconds`; `[distributed_prd] include_max_depth/include_markers`; `[tasks_lock] stale_ms/timeout_ms/poll_ms`; `[concurrency] research_queue/parallelism`; `[api] timeout_ms`; `[monitor] task_interval/interval_ms/enabled`; `[cli] mode/scope/log_level/machine_readable/continue_on_error/cache_enabled/max_tasks/max_duration` → the matching `parseCLIArgs()` Commander defaults. Model-id values are written **bare** (`glm-5.2`) and provider-qualified by the existing `qualifyModel()` path; already-qualified values (`zai/glm-5.2`) accepted intact. For concepts reachable both as env var and CLI flag (`RESEARCH_QUEUE_CONCURRENCY`/`--research-concurrency`, `HACKY_LOG_LEVEL`/`--log-level`, etc.), expose exactly **one** TOML key per concept (no duplicate `[cli]`/`[pipeline]` pair). For booleans exposed as negating flags (`--no-cache`, `--no-resource-monitor`), the TOML key names the positive state.
  - **OUTPUT:** Complete schema map. Consumed by 2.2.2.
  - **DOCS (Mode A):** The §9.7.5 schema table is the authoritative reference; JSDoc on the schema map cross-references it.

**Task 2.2.2 — `hack config` subcommand (init / show / validate / path)**

- **INPUT:** Schema map from 2.2.1.
- **LOGIC:** Add a `config` subcommand to `src/cli/index.ts` (§9.7.8): `hack config init [--force]` writes a heavily-commented `<repoRoot>/.hack` template (refuses to clobber without `--force`, appends `.hack.local` to `.gitignore` creating it if absent, prints next-step guidance); `hack config show [--src]` merges all layers (incl. env/CLI) and prints every key with its resolved value + masked secrets, and with `--src` annotates each value with its winning layer (global/project/local/env/cli) — runs without invoking any agent (safe for diagnosing auth/config); `hack config validate [<file>]` lints `.hack` + `.hack.local`, exit 1 on errors / warn on unknowns, CI-friendly; `hack config path [--global|--local]` prints the resolved path(s) actually consulted. `show`/`validate`/`path` benefit automatically from Phase 1's repo-root `chdir`. Register `config` so it dispatches before the default pipeline path (like `task`/`status`).
- **OUTPUT:** `hack config` subcommand. Completes Task 2.2.2.
- **DOCS (Mode A):** Add the `hack config` subcommand and its four actions to the CLI reference; note the `--src`/masked-secrets behavior.

**Task 2.2.3 — `.gitignore` management, `.hack.local`-tracked warning, and acceptance**

- **INPUT:** Subcommand from 2.2.2.
- **LOGIC:** `hack config init` must ensure `.hack.local` is in `.gitignore`. `hack config validate` must warn loudly if `.hack.local` is tracked by git (potential secret leak) and point at `git rm --cached .hack.local` (§9.7.6). Add acceptance tests for §9.7.10: a committable `.hack` with `[cli] mode`, `[pipeline] parallel_research`, `[models] balanced` applies on a bare `hack` from any subdir with no env/flags; `[auth] zai_api_key` in `.hack` aborts while in `.hack.local` seeds `PRP_API_KEY`; an out-of-range/typo value aborts startup; an unknown key/section warns and proceeds; the env-over-file rule holds (`PARALLEL_RESEARCH=false hack` beats `[pipeline] parallel_research = true`); no secret is ever written unmasked by `show`/debug logging/errors.
- **OUTPUT:** `.gitignore` management + tracked-`.hack.local` warning + acceptance. Completes Milestone 2.2 and Phase 2.
- **DOCS (Mode A):** Document `.hack.local` gitignore behavior in the CLI reference and README.

---

## Phase 3 — Tasks-Not-Yet-Generated Window (Breakdown-in-Progress) — §5.3

**Goal.** When a discovered (auto-resolved) `tasks.json` is absent solely because the session directory exists but the Architect Agent has not finished decomposition, the read commands degrade to a calm notice (exit 0) instead of crashing with `ENOENT`. This is the read-only observation path and is **distinct** from corruption-recovery (§5.1) and interrupted-bugfix re-entry (§4.4).

**Research note.** `src/cli/index.ts` resolves the auto-discovered tasks file around line ~610–620 (`tasksFile = resolve(sessionPath, 'tasks.json')`, `sourceNote = 'Using main tasks: …'`), then `readFile(tasksFile)` (line ~625) throws `ENOENT` during the breakdown window. The `task` (list), `status` (alias, registered at line ~737), and `task next` (the `action === 'next'` branch) paths share this handler. An explicit `--file <path>` override (the `options.file` branch) must remain a hard error. `SessionManager.findLatestSession` already distinguishes "no sessions" from "session found"; the session directory itself existing is the signal for breakdown-in-progress.

### Milestone 3.1 — Graceful Degradation for Auto-Resolved Missing `tasks.json`

**Task 3.1.1 — Detection, messaging, exit code, and scope rules**

- **Subtask 3.1.1.S1 — Breakdown-in-progress detection + calm notice across all discovery-based actions**
  - **INPUT:** None (independent of Phases 1–2; benefits from Phase 1's repo-root `chdir`).
  - **LOGIC:** In the shared `task`/`status`/`task next` action handler, **after** the target session is resolved and the auto-discovered `tasksFile` is set (the `else` branch of the `--file`/`--session` discovery — do **not** soften the explicit `--file` path) and **before** `readFile(tasksFile)`: if `tasksFile` does not exist (`ENOENT`, `statSync`/`access` check) **and** the session directory **does** exist, classify the state as breakdown-in-progress (§5.3 Requirement / Detection). Behavior: emit a single calm human-readable notice to **stderr** naming the session and explaining `tasks.json` is generated during PRD breakdown and is not available yet — re-run shortly, or run `hack --continue` to (re)generate it. This notice **replaces** the `Using main tasks: …` source note for this state (printing both is self-contradictory). Under `--output json`, emit a structured object (`{ "status": "awaiting_breakdown", "session": "NNN_hash" }`) to stdout instead. Exit code **0**. Apply to `task` (list), `status` (alias), and `task next` — `next` reports "no tasks available yet (breakdown in progress)". Leave the existing "No sessions found" path (`findLatestSession` returns nothing) unchanged — it still exits non-zero, so the two empty states ("no sessions" vs "session exists, no `tasks.json`") are distinguished. **Do not** trigger §5.1 corruption-recovery (that path is keyed off a present-but-broken file) or §4.4 interrupted-bugfix re-entry. Add tests: `hack status` against a session-without-`tasks.json` prints the notice and exits 0 (no `ERROR`/`ENOENT`/stack trace); `--output json` emits `awaiting_breakdown` and exits 0; `--file /nonexistent` still exits non-zero; no-sessions-at-all still exits non-zero.
  - **OUTPUT:** Graceful breakdown-in-progress handling across `task`/`status`/`task next`. Completes Milestone 3.1 and Phase 3.
  - **DOCS (Mode A):** Document the breakdown-in-progress state and its exit code in the CLI reference (mirror §5.3 acceptance criteria).

---

## Phase 4 — Sync Changeset-Level Documentation (Mode B)

**Goal.** Cross-cutting documentation that only makes sense once the whole delta lands. Per-file Mode A docs ride with their implementing subtasks above and are **not** duplicated here. Runs LAST; depends on every implementing subtask in Phases 1–3.

**Task 4.1.1 — Changeset-level doc sweep**

- **Subtask 4.1.1.S1 — README, ARCHITECTURE, and CONFIGURATION updates**
  - **INPUT:** All implementing subtasks from Phases 1–3.
  - **LOGIC:** (a) **README.md** — add a "Configuration" section describing the `.hack` file (three-tier layering, `hack config` subcommand, secrets policy) and a "Running from anywhere" note that `hack` resolves the repo root automatically (and the `--repo-root` escape hatch). (b) **docs/ARCHITECTURE.md** — add a bootstrap-layer section covering the §8 ordering (`parseCLIArgs()` → repo-root resolution + `chdir` → `.hack` load → env/harness/preflight → pipeline), the repo-root resolver, and the `.hack` layered loader; ensure no stale "must run from repo root" framing remains. (c) **docs/CONFIGURATION.md** — add the `.hack` file as the primary configuration mechanism with the §9.7.5 schema reference table, the env-over-file rule, and the secrets policy; cross-reference the §9.2.1 7-layer precedence. Reconcile with the §5.1 commit-format text (note it is already live, linking the existing `PRP_COMMIT_FORMAT`).
  - **OUTPUT:** Coherent changeset-level docs. Completes Phase 4 and the delta.
  - **DOCS:** [Mode B] This IS the documentation task.

---

## Cross-Cutting Notes (reference, no standalone tasks)

- **§3 System Architecture bootstrap paragraph** — realized by Phase 1 (`chdir` + repo-root) and Phase 2 (`.hack` load); the paragraph is framing prose, not a code surface.
- **§8 Development Roadmap bootstrap-ordering note** — realized by the bootstrap wiring in Phase 1 (1.1.1.S1) and Phase 2 (2.1.1.S2).
- **§9.2.1 Configuration Source Priority expansion (3 → 7 layers)** — realized by the Phase 2 loader (2.1.1.S2 seeds `process.env` per the layering and env-over-file rule); `configureEnvironment()` keeps reading `process.env` unchanged because the loader puts `.hack` values _underneath_ the shell env.
- **§9.5 Implementation Roadmap items** (repo-root resolution, `.hack` loader) — realized by Phases 1 and 2.
- **§5.1 Commit Message Format / §9.2.2 `PRP_COMMIT_FORMAT`** — already implemented; no task.