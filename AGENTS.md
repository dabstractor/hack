Important: NEVER run this project within this directory. It will cause a catastrophic meltdown of the implementation that is in progress.
NEVER put anything into `./plan` WHATSOEVER. That is NOT YOUR CODE. That is for the AGENT THAT BUILT THIS PROJECT.

## Agent Workflow Discipline

This project keeps the codebase perfectly in sync with the PRD (`PRD.md`) through a strict separation between planning and implementation.

1. **The PRD is the single source of truth.** Every requirement lives in `PRD.md` — functional, technical, and cross-cutting constraints alike (e.g., §9.6 mandates lazy loggers + synchronous logging destinations). If it is not in the PRD, it is not a requirement.

2. **No implementation during planning.** Planning/architecture agents never modify source code, tests, configs, or tooling. Every proposed or discussed change — including the root cause and rationale behind it — is recorded **in the PRD only**.

3. **Only PRP research and execution agents do real work.** These are the sole agents permitted to write or modify code, and they implement strictly from the PRD. All other agents touch documentation (`PRD.md`, this file) — never implementation files under `src/` or elsewhere.

4. **You are allowed to bring the project into alignment with the PRD, but you are never allowed to add new features to code before they're defined in the PRD.**

5. **Out-of-spec corrective work does NOT require a PRP.** Rules 2–4 govern _new features and new requirements_. Any agent may fix — directly in `src/`, `tests/`, `lib/`, `plugin/`, and repo-root meta files, **without** first writing a PRP or a PRD entry — anything that deviates from how the system is already specified or intended to behave: bugs, crashes, silent failures, hangs, rejected-valid-input, wrong exit codes, regressions, broken contracts, or behavior that contradicts an existing PRD requirement. Record the root cause and rationale in code comments and the commit message; a PRD bugfix-section entry is welcome but **not blocking**. This rule is an explicit exception to rule 3's "only PRP agents do real work" for corrective work. It does **not** license new features, new flags, or new behavior beyond existing intent — those still require a PRD entry first per rule 4. (Examples that are fine to fix directly: the event-loop-drain silent exit, CLI flags rejecting valid integers, a discarded process exit code, fataling on an un-started session's missing `tasks.json`. Example that is NOT fine without a PRD entry: adding a brand-new `--resume-from` flag or a new pipeline phase.)
