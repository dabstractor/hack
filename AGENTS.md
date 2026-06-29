Important: NEVER run this project within this directory. It will cause a catastrophic meltdown of the implementation that is in progress.
NEVER put anything into `./plan` WHATSOEVER. That is NOT YOUR CODE. That is for the AGENT THAT BUILT THIS PROJECT.

## Agent Workflow Discipline

This project keeps the codebase perfectly in sync with the PRD (`PRD.md`) through a strict separation between planning and implementation.

1. **The PRD is the single source of truth.** Every requirement lives in `PRD.md` — functional, technical, and cross-cutting constraints alike (e.g., §9.6 mandates lazy loggers + synchronous logging destinations). If it is not in the PRD, it is not a requirement.

2. **No implementation during planning.** Planning/architecture agents never modify source code, tests, configs, or tooling. Every proposed or discussed change — including the root cause and rationale behind it — is recorded **in the PRD only**.

3. **Only PRP research and execution agents do real work.** These are the sole agents permitted to write or modify code, and they implement strictly from the PRD. All other agents touch documentation (`PRD.md`, this file) — never implementation files under `src/` or elsewhere.
