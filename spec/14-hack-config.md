### 9.7 The `.hack` Configuration File

Cross-cutting requirement for a **project-local, version-controllable configuration file** that captures _all_ user-tunable defaults — both the environment-variable-style settings of §9.2.2 and the CLI flags of §5.3 / `parseCLIArgs()` — so a user does not have to re-export env vars or re-pass CLI parameters on every invocation. This is the file-backed counterpart to the layered precedence defined in §9.2.1.

#### 9.7.1 Problem

Today every tunable is an environment variable or a CLI flag, and there is **no application-level config file at all**:

- The `dotenv` dependency is listed in `package.json` but is **never imported in `src/`**; `.env` is only loaded externally (direnv via `.envrc` in the shell, the `n` package in `tests/setup.ts`). A user who does not use direnv has no app-level way to persist settings.
- All defaults live in `config/constants.ts` and can only be overridden per-invocation (`export VAR=…` or `--flag`). Repetitive invocations (`npm run dev -- --prd ./PRD.md --mode bug-hunt --parallel-research --log-level debug`) are the norm.
- There is no team-wide, version-controlled way to share pipeline configuration (model tiers, commit format, research tuning). Every developer re-derives their own `.envrc`/exports, which drift.
- CLI flags cannot be defaulted at all — a user who always wants `--mode bug-hunt` must type it every time.

The `.hack` file fills all four gaps with one mechanism.

#### 9.7.2 Goals & Non-Goals

**Goals.**

- Provide a single, human-editable file that can express **every** tunable default (env-style settings **and** CLI flags), per the user requirement “all possible config defaults so the user doesn't have to keep passing in env vars or cli parameters every time.”
- Support a **three-tier file layering** — global user, project (committable), project-local (gitignored) — that composes cleanly with the existing shell-env / `.env` / CLI precedence (§9.2.1).
- Keep **secrets out of version control** by construction: the committable project file refuses secret-bearing keys.
- Locate the project file via the **same upward `.git` traversal** that locates `PRD.md`/`plan/` (§9.8), so `hack` run from any subdirectory resolves the identical configuration.
- Ship with tooling: a generator (`hack config init`), an effective-config inspector (`hack config show`), and a linter (`hack config validate`).

**Non-goals.**

- Replacing `~/.pi/agent/auth.json` or the provider-native credential env vars (`ZAI_API_KEY`, `ANTHROPIC_API_KEY`) as the _primary_ auth channel (§9.2.6). The `.hack` file may name an explicit override key in the gitignored `.hack.local` only; it is never the recommended auth path.
- Replacing the `.env` file for users who already rely on direnv/`.envrc`. `.env` remains a supported layer (§9.2.1 layer 5).
- Hot-reloading. Config is read once at startup; editing `.hack` mid-run has no effect until the next invocation.
- A GUI or interactive configuration wizard. `hack config init` emits a commented template; editing is manual.

#### 9.7.3 Discovery, Layering & File Locations

Three files are searched, each optional. They are layered lowest-to-highest as §9.2.1 layers 2–4:

| Layer         | Path                                                                                   | Purpose                                                                                                  | Git-tracked?                        | Secrets allowed?                                                        |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| Global user   | `$HACK_CONFIG_HOME/config` if set, else `$XDG_CONFIG_HOME/hack/config`, else `~/.hack` | Personal defaults applied to _every_ project (e.g. always use the `pi` harness, a preferred model tier). | N/A (outside repos)                 | Discouraged (lives in `$HOME`); if present, treated like `.hack.local`. |
| Project       | `<repoRoot>/.hack`                                                                     | Team-wide project defaults, reviewed in PRs alongside code.                                              | **Yes** (intended to be committed). | **No** — refused (§9.7.6).                                              |
| Project local | `<repoRoot>/.hack.local`                                                               | Per-developer overrides and personal secrets.                                                            | **No** — MUST be in `.gitignore`.   | **Yes** (it is local-only).                                             |

**Discovery rules.**

- The project files (`.hack`, `.hack.local`) are read from the **repository root** located by the §9.8 traversal, never from the invocation directory. This guarantees a developer running `hack` from `src/deep/nested/` resolves the same files as one running from the root.
- The global file resolves against `$HOME`-rooted paths (or their env overrides) and is independent of the repo.
- A missing file at any tier is **not an error**; that tier simply contributes nothing.
- `.hack.local` MUST be added to `.gitignore` by `hack config init` (and documented in `.env.example` / README). If `.hack.local` is ever tracked by git, `hack config validate` MUST warn loudly (secrets may have leaked) and point the user at `git rm --cached .hack.local`.
- The files are parsed in tier order (global → project → project-local); each key from a higher tier overwrites the same key from a lower tier, and the merged result is then seeded into `process.env` _only for keys not already set by a higher §9.2.1 layer_ (so real shell env still wins, §9.2.1 env-over-file rule). Equivalently: the merged file value is the default, and env/CLI override it.

#### 9.7.4 Format

- **Format:** TOML (specifically TOML 1.0, parsed via a dependency such as `@iarna/toml` or `smol-toml`). TOML is chosen over YAML/JSON/INI for: unambiguous types (no YAML `yes`/`no`/Norway problems), line comments (`#`) that make a heavily-commented template readable, native arrays/tables for the nested CLI-flag group, and widespread familiarity from `pyproject.toml`/`Cargo.toml`.
- **Encoding:** UTF-8; a leading byte-order mark is rejected with a clear error.
- **Single document per file**; no multi-file includes (the project file is intentionally one curated artifact; PRD-level `@include` directives of §2.3 do not apply here).
- **Comments** are preserved by `hack config init` (the template is heavily commented) and ignored at parse time.
- All keys are **lowercase snake_case** within their section; env-var names are uppercased when a file key is mapped to its corresponding env var (§9.7.5).

#### 9.7.5 Schema Reference

Every tunable maps to exactly one `[section].key`. The table below is exhaustive; `hack config show` prints the same mapping. “Env var” is the §9.2.2 name the key seeds into `process.env`; “CLI flag” is the `parseCLIArgs()` option it defaults. A key with both an env var and a CLI flag seeds both (the CLI default is derived from the seeded env var, preserving §9.2.1 precedence).

| TOML key                              | Env var                      | CLI flag                  | Type                                       | Default                                     |
| ------------------------------------- | ---------------------------- | ------------------------- | ------------------------------------------ | ------------------------------------------- |
| `[models] high`                       | `PRP_MODEL_HIGH`             | —                         | string (bare model id)                     | `glm-5.2`                                   |
| `[models] balanced`                   | `PRP_MODEL_BALANCED`         | —                         | string                                     | `glm-5.2`                                   |
| `[models] fast`                       | `PRP_MODEL_FAST`             | —                         | string                                     | `glm-5-turbo`                               |
| `[reasoning] agent`                   | `PRP_REASONING_AGENT`             | — | `off`\|`minimal`\|`low`\|`medium`\|`high`\|`xhigh` | `high` |
| `[reasoning] breakdown_agent`         | `PRP_REASONING_BREAKDOWN_AGENT`  | — | (same vocabulary)                                | `high` |
| `[reasoning] bug_finder_agent`        | `PRP_REASONING_BUG_FINDER_AGENT` | — | (same vocabulary)                                | `high` |
| `[reasoning] validation_agent`        | `PRP_REASONING_VALIDATION_AGENT` | — | (same vocabulary)                                | `high` |
| `[reasoning] impl_agent`              | `PRP_REASONING_IMPL_AGENT`       | — | (same vocabulary)                                | `off`  |
| `[endpoint] base_url`                 | `PRP_API_BASE_URL`           | —                         | URL                                        | `https://api.z.ai/api/anthropic` (zai only) |
| `[harness] name`                      | `PRP_AGENT_HARNESS`          | —                         | `pi` \| `claude-code`                      | `pi`                                        |
| `[pipeline] parallel_research`        | `PARALLEL_RESEARCH`          | `-r/--parallel-research`  | bool                                       | `false`                                     |
| `[pipeline] research_depth`           | `RESEARCH_DEPTH`             | —                         | int ≥ 1                                    | `2`                                         |
| `[pipeline] research_timeout_seconds` | `RESEARCH_TIMEOUT`           | —                         | int > 0                                    | `1800`                                      |
| `[pipeline] issue_retry_max`          | `ISSUE_RETRY_MAX`            | —                         | int ≥ 0                                    | `3`                                         |
| `[pipeline] commit_format`            | `PRP_COMMIT_FORMAT`          | —                         | `task-prefix` \| `plain`                   | `task-prefix`                               |
| `[pipeline] commit_style`             | `PRP_COMMIT_STYLE`           | —                         | `auto`\|`plain`\|`conventional`\|`gitmoji` | `auto`                                      |
| `[pipeline] commit_style_examples`    | `PRP_COMMIT_STYLE_EXAMPLES`  | —                         | int ≥ 0                                    | `5`                                         |
| `[commit] retry_max`                  | `COMMIT_RETRY_MAX`           | —                         | int ≥ 1                                    | `5`                                         |
| `[commit] retry_delay_ms`             | `COMMIT_RETRY_DELAY`         | —                         | int ≥ 0                                    | `10000`                                     |
| `[commit] retry_delay_cap_ms`         | `COMMIT_RETRY_DELAY_CAP`     | —                         | int ≥ `retry_delay_ms`                     | `120000`                                    |
| `[commit] classifier_retry_max`       | `CLASSIFIER_RETRY_MAX`       | —                         | int ≥ 1                                    | `4`                                         |
| `[bug_hunt] finder_agent`             | `BUG_FINDER_AGENT`           | —                         | string                                     | `pizr`                                      |
| `[bug_hunt] results_file`             | `BUG_RESULTS_FILE`           | —                         | string                                     | `TEST_RESULTS.md`                           |
| `[bug_hunt] fix_scope`                | `BUGFIX_SCOPE`               | —                         | string                                     | `subtask`                                   |
| `[validation] agent`                  | `VALIDATION_AGENT`           | —                         | string                                     | `pizr`                                      |
| `[validation] timeout_seconds`        | `VALIDATION_TIMEOUT`         | —                         | int > 0                                    | `7200`                                      |
| `[distributed_prd] include_max_depth` | `PRD_INCLUDE_MAX_DEPTH`      | —                         | int ≥ 1                                    | `10`                                        |
| `[distributed_prd] include_markers`   | `PRD_INCLUDE_MARKERS`        | —                         | bool                                       | `false`                                     |
| `[tasks_lock] stale_ms`               | `TASKS_LOCK_STALE_MS`        | —                         | int > 0                                    | `30000`                                     |
| `[tasks_lock] timeout_ms`             | `TASKS_LOCK_TIMEOUT_MS`      | —                         | int > 0                                    | `30000`                                     |
| `[tasks_lock] poll_ms`                | `TASKS_LOCK_POLL_MS`         | —                         | int > 0                                    | `50`                                        |
| `[concurrency] research_queue`        | `RESEARCH_QUEUE_CONCURRENCY` | `--research-concurrency`  | int 1–10                                   | `3`                                         |
| `[concurrency] parallelism`           | —                            | `--parallelism`           | int 1–10                                   | `2`                                         |
| `[api] timeout_ms`                    | `API_TIMEOUT_MS`             | —                         | int > 0                                    | `60000`                                     |
| `[monitor] task_interval`             | `MONITOR_TASK_INTERVAL`      | `--monitor-task-interval` | int 1–100                                  | `1`                                         |
| `[monitor] interval_ms`               | —                            | `--monitor-interval`      | int 1000–60000                             | `30000`                                     |
| `[monitor] enabled`                   | —                            | `--no-resource-monitor`   | bool                                       | `true`                                      |
| `[cli] prd`                           | —                            | `-p/--prd`                | string (path)                              | `./PRD.md`                                  |
| `[cli] mode`                          | —                            | `-m/--mode`               | `normal`\|`delta`\|`bug-hunt`\|`validate`  | `normal`                                    |
| `[cli] scope`                         | —                            | `-s/--scope`              | string                                     | unset                                       |
| `[cli] log_level`                     | `HACKY_LOG_LEVEL`            | `--log-level`             | trace…fatal                                | `info`                                      |
| `[cli] machine_readable`              | —                            | `--machine-readable`      | bool                                       | `false`                                     |
| `[cli] continue_on_error`             | —                            | `--continue-on-error`     | bool                                       | `false`                                     |
| `[cli] cache_enabled`                 | —                            | `--no-cache`              | bool                                       | `true`                                      |
| `[cli] max_tasks`                     | —                            | `--max-tasks`             | int > 0                                    | unset                                       |
| `[cli] max_duration_ms`               | —                            | `--max-duration`          | int > 0                                    | unset                                       |

**Mapping semantics.**

- A `[cli]` key sets the **default** for the matching Commander option. An explicit flag on the command line still wins (§9.2.1 layer 7), so `[cli] mode = "bug-hunt"` is overridden by `--mode validate`.
- `[cli] prd` sets the default **PRD entry path** (the `-p/--prd` flag). Like every `.hack` path it is **repo-root-relative** (§9.7.3 / §9.8): `prd = "spec/SPEC.md"` resolves to `<repoRoot>/spec/SPEC.md` regardless of the invocation directory, so a distributed PRD can be pinned without a per-invocation flag. An explicit `--prd <path>` still wins and — per §9.8.3 — resolves against the _invocation_ directory, while the `.hack` default resolves against the repo root. This is the key that lets a project whose spec lives outside the default `./PRD.md` (e.g. a split spec under `spec/`) declare its canonical entry document.
- For booleans exposed as negating flags (`--no-cache`, `--no-resource-monitor`), the TOML key names the _positive_ state (`cache_enabled`, `monitor.enabled`); `false` is equivalent to passing the `--no-*` form.
- Where a single concept is reachable both as an env var and a CLI flag with the same default (`RESEARCH_QUEUE_CONCURRENCY` / `--research-concurrency`, `HACKY_LOG_LEVEL` / `--log-level`, `MONITOR_TASK_INTERVAL` / `--monitor-task-interval`, `PARALLEL_RESEARCH` / `-r`), the TOML key seeds the env var and the CLI option reads through it; only **one** TOML key exists per concept (no duplicate `[cli]`/`[pipeline]` pair), avoiding the ambiguity of two keys racing for the same value.
- Model-id values are written **bare** (`glm-5.2`) and provider-qualified at read time by the existing `qualifyModel()` path (§9.2.3); an already-qualified value (`zai/glm-5.2`) is accepted and left intact.
- `[reasoning]` values are case-insensitive members of the §9.2.9 vocabulary (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`); a value outside that set is a hard startup error (§9.7.7, §9.2.9). `[reasoning]` keys are **independent of** `[models]` keys — the former sets a role's extended-thinking level, the latter its model id — so a strong model can be paired with reasoning off (§9.2.3, §9.2.9).

**Example project `.hack` (committable, no secrets):**

```toml
# <repoRoot>/.hack — team-wide PRP pipeline defaults
# Generated/refreshed by `hack config init`. Safe to commit.

[harness]
name = "pi"             # vendor-neutral default (§9.1)

[models]
high     = "glm-5.2"    # Architect agent
balanced = "glm-5.2"    # planning & research roles
fast     = "glm-5-turbo" # implementation role

[reasoning]
# per-role extended-thinking level (§9.2.9); orthogonal to [models] above
agent            = "high"  # research / PRP creation
breakdown_agent  = "high"  # task decomposition
bug_finder_agent = "high"
validation_agent = "high"
impl_agent       = "off"   # codegen from a complete PRP needs no thinking

[endpoint]
# base_url left unset: defaults to z.ai for the `zai` provider (§9.2.4)

[pipeline]
parallel_research        = true   # background PRP research (§4.2)
research_depth           = 3
research_timeout_seconds = 1800
commit_format            = "task-prefix"  # §5.1 (position prefix)
commit_style             = "auto"         # §5.1 (descriptive-message style; auto = learn from last 5)

[validation]
timeout_seconds = 7200     # full test suites legitimately need hours (§4.4)

[distributed_prd]
include_max_depth = 10     # §2.3

[cli]
mode          = "normal"
log_level     = "info"
max_tasks     = 20         # cap every run
```

**Example `.hack.local` (gitignored, may hold secrets):**

```toml
# <repoRoot>/.hack.local — personal overrides; NEVER commit.

[cli]
log_level = "debug"        # I like verbose output

[harness]
name = "claude-code"       # I'm spending an Anthropic coding-plan quota today

[models]
balanced = "anthropic/claude-sonnet-4"
fast     = "anthropic/claude-haiku-4"

[reasoning]
impl_agent = "high"      # I want extended thinking on for codegen today (§9.2.9)

[auth]
override_key = "sk-ant-..."  # explicit override (§9.2.6 layer 1); prefer ZAI_API_KEY/auth.json instead
```

#### 9.7.6 Secrets Policy

- **The committable project `.hack` MUST refuse secret-bearing keys.** If any of the following keys is present in `.hack` (not `.hack.local`), the loader MUST emit a hard error naming the file, the offending key, and the remediation (move it to `.hack.local` or an env var), and abort startup before any agent runs: `[auth] override_key`, `[auth] zai_api_key`, `[auth] anthropic_api_key`, `[auth] anthropic_auth_token`, or any key whose name ends in `_key`/`_token`/`_secret`/`_password`.
- `.hack.local` (gitignored) is the **only** file tier permitted to hold secrets, and even there the canonical auth channels of §9.2.6 (`~/.pi/agent/auth.json`, `ZAI_API_KEY`, provider env vars) are preferred. `[auth] override_key` in `.hack.local` maps to `PRP_API_KEY` (the §9.2.6 layer-1 explicit override).
- An empty/whitespace-only secret value is treated as “not configured,” consistent with §9.2.7’s empty-string policy; it is never forwarded into harness options.
- `hack config validate` MUST flag a `.hack.local` that is tracked by git (potential secret leak) and a `.hack` that contains any secret-bearing key.

#### 9.7.7 Validation & Error Handling

- **Unknown section:** warn once (`unknown section [foo] in .hack; ignored`) and continue. lenient, so forward-compatible additions in newer `hack` versions don’t break older parsers and vice versa.
- **Unknown key in a known section:** warn once with the file, section, and key, and ignore the key. (Catch typos like `[pipeline] reseaerch_depth`.)
- **Type mismatch / out-of-range value (e.g. `[tasks_lock] poll_ms = -5`, `[harness] name = "foo"`, `[cli] mode = "fast"`):** **hard error** at startup naming the file, key, offending value, expected type/range, and the accepted values; abort before any agent run. This mirrors the fail-fast philosophy of the §9.2.7 auth preflight — a misconfigured `.hack` must not surface as a deep runtime error mid-pipeline.
- **Parse error (malformed TOML):** hard error naming the file and the parser’s line/column; abort.
- **Duplicate key:** TOML itself rejects duplicate keys; surface the parser error verbatim with the file path.
- All warnings/errors go to **stderr** synchronously (§9.6-compliant), because the pino logger is configured _after_ config loading (it needs the resolved `--log-level`, which may itself come from `.hack`).
- **Effective-config trace:** when `--log-level debug` (resolved after the file is read) is in effect, the loader logs each key with its _source layer_ (global/project/local/env/cli) and final resolved value, except for secret-bearing keys whose values are masked (`override_key = "<redacted>"`).

#### 9.7.8 The `hack config` Subcommand

A new `config` subcommand exposes the file feature:

```bash
hack config init [--force]            # write a commented <repoRoot>/.hack template
hack config show [--src]              # print effective resolved config; --src annotates each value with its source layer
hack config validate [<file>]         # lint .hack (+ .hack.local); exit 1 on errors, warn on unknowns
hack config path [--global|--local]   # print the resolved path(s) actually consulted
```

- `init` refuses to overwrite an existing `.hack` unless `--force`; it appends `.hack.local` to `.gitignore` (creating `.gitignore` if absent) and prints next-step guidance.
- `show` is the primary debugging aid: it merges all layers (including env/CLI) and prints every key with its resolved value, _masked secrets_, and (with `--src`) the winning layer. It runs without invoking any agent, so it is safe to use for diagnosing auth/config issues.
- `validate` is CI-friendly (exit code distinguishes errors from warnings) so a repo can gate PRs on a clean `.hack`.

#### 9.7.9 Interaction with Existing Subsystems

- **§9.2.1 precedence:** `.hack`/`.hack.local`/global are layers 2–4; env (5–6) and CLI (7) override them. The loader seeds `process.env` only for keys not already set, preserving the env-over-file rule.
- **§9.2.6 auth model:** `[auth] override_key` (`.hack.local` only) maps to `PRP_API_KEY` (layer-1 explicit override); all other auth resolution is unchanged. The `.hack` file never displaces `auth.json`/`ZAI_API_KEY` as the primary path.
- **§9.2.7 preflight:** runs _after_ `.hack` is loaded, so a key sourced from `.hack` (e.g. `[harness] name`, `[models] balanced`) flows correctly into the harness/provider resolution the preflight checks.
- **§9.2.8 deprecation:** legacy `ANTHROPIC_*` aliases are _not_ exposed as `.hack` keys; users set canonical `PRP_*`-equivalent TOML keys, and the existing canonical-first loader handles any legacy env vars as before.
- **§9.4 harness selection:** `[harness] name` seeds `PRP_AGENT_HARNESS`; the harness↔provider compatibility check (§9.4.3) still runs and still surfaces mismatches at `initialize()`.
- **§9.2.5 nested execution:** child `hack` processes (bugfix sub-pipelines) inherit `process.env` from the parent (which already ran the file loader and `chdir`), so they see the same resolved configuration; children do **not** re-read `.hack` differently because the repo root is identical (§9.8.7).
- **Bootstrap ordering (see §9.8.3):** `parseCLIArgs()` (so `--help` exits early) → **§9.8 repo-root resolution + `chdir`** → **§9.7 `.hack` load (global → project → local)** → existing `.env`/`configureEnvironment()` → `configureHarness()` → `runAuthPreflight()` → pipeline. The `.hack` load happens _after_ the repo root is known (the project files live there) and _before_ anything that reads the resolved values.

#### 9.7.10 Acceptance Criteria

- A user can place a committable `<repoRoot>/.hack` setting `[cli] mode = "bug-hunt"`, `[pipeline] parallel_research = true`, and `[models] balanced = "glm-5.2"`, then run bare `hack` from any subdirectory and observe all three applied — with **no** env vars exported and **no** flags passed.
- `hack config init` writes a commented `.hack`, ensures `.hack.local` is gitignored, and refuses to clobber an existing `.hack` without `--force`.
- `hack config show --src` prints every tunable with its resolved value and winning layer; secret values are masked.
- A `.hack` containing `[auth] zai_api_key = "…"` aborts startup with a hard error; the same key in `.hack.local` is accepted and seeds `PRP_API_KEY`.
- An out-of-range/typo value (e.g. `[tasks_lock] poll_ms = -5`, `[harness] name = "foo"`) aborts startup with an actionable message before any agent runs.
- An unknown key/section produces a stderr warning and otherwise proceeds.
- The §9.2.1 env-over-file rule holds: with `PARALLEL_RESEARCH=false hack` and `[pipeline] parallel_research = true` in `.hack`, the run uses `false` (env wins).
- `hack` run from `src/deep/nested/` resolves the same `.hack`, `.env`, `PRD.md`, and `plan/` as a run from the repo root (jointly satisfied with §9.8).
- No secret value is ever written to stdout/logs unmasked by `hack config show`, effective-config debug logging, or an error message.
