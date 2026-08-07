### 9.5 Implementation Roadmap

1.  **Project Setup**:
    - Initialize TypeScript project.
    - Link `groundswell` (`npm link ~/projects/groundswell`).
    - Implement **repository-root resolution** (§9.8) as the first bootstrap step after `parseCLIArgs()`: upward `.git` traversal (dir or file; worktree/submodule aware) → hard-error if none found → `process.chdir(repoRoot)`; capture `INVOCATION_CWD` first so explicit `--prd`/`--file` paths resolve against the invocation dir while default paths re-root to the repo.
    - Implement the **`.hack` configuration loader** (§9.7): TOML parse of global `~/.hack` → project `<repoRoot>/.hack` → gitignored `<repoRoot>/.hack.local`, layered per §9.2.1; refuse secrets in the committable `.hack`; seed `process.env` for unset keys (env-over-file rule). Add the `hack config` subcommand (`init`/`show`/`validate`/`path`).
    - Implement the **provider-agnostic auth bootstrap** (§9.2.6): resolve the selected provider's credential via override → provider env var (`ZAI_API_KEY` for `zai`) → `~/.pi/agent/auth.json`; forward a non-empty override only.
    - Implement the **fail-fast auth preflight** (§9.2.7): abort before any agent run with an actionable error when no credential is resolvable for the selected harness + provider/model.
    - **Cross-repo:** switch the `pi` harness to a file-backed `AuthStorage` (`AuthStorage.create()`) in `~/projects/groundswell` `src/harnesses/pi-harness.ts` so `~/.pi/agent/auth.json` is honored.
    - Call `configureHarnesses({ defaultHarness: 'pi', defaultModelProvider: 'zai' })` at startup (see §9.4).
    - Implement the **per-role reasoning level** (§9.2.9): resolve `PRP_REASONING_<ROLE>` for each agent identity through the §9.2.1 stack (defaults `high`/`high`/`high`/`high`/`off` for research/breakdown/bug-finder/validation/impl), validate against the `off`/`minimal`/`low`/`medium`/`high`/`xhigh` vocabulary (hard startup error on invalid), and forward the resolved level into each agent config so it is composed with — and independent of — the tier model (§9.2.3).

2.  **Core Workflows**:
    - Implement `SessionManager` (Filesystem operations).
    - Implement `ArchitectAgent` (using `PROMPTS.md` logic).

3.  **Execution Engine**:
    - Implement `PRPGenerator` (Researcher).
    - Implement `CodeExecutor` (Coder).
    - Integrate `Groundswell`'s caching to save money/time on repeated architectural queries.

4.  **Validation & QA**:
    - Implement `QAAgent` (Bug Hunter).
    - Wrap validation scripts in a `ValidationWorkflow` step.
