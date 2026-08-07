Important: NEVER run this project within this directory. It will cause a catastrophic meltdown of the implementation that is in progress.
NEVER put anything into `./plan` WHATSOEVER. That is NOT YOUR CODE. That is for the AGENT THAT BUILT THIS PROJECT.

## Agent Workflow Discipline

This project keeps the codebase perfectly in sync with the PRD (`PRD.md`) through a strict separation between planning and implementation.

1. **The PRD is the single source of truth.** Every requirement lives in `PRD.md` — functional, technical, and cross-cutting constraints alike (e.g., §9.6 mandates lazy loggers + synchronous logging destinations). If it is not in the PRD, it is not a requirement.

2. **No implementation during planning.** Planning/architecture agents never modify source code, tests, configs, or tooling. Every proposed or discussed change — including the root cause and rationale behind it — is recorded **in the PRD only**. **Authoring or adding a requirement to the PRD is itself a planning act.** When a request says "update the spec," "spec out," "add X to the PRD," or otherwise describes a feature and asks you to capture it, you edit `PRD.md` / `spec/` ONLY and then STOP. The feature description in the request is context for writing an accurate spec — it is never a mandate to ship code.

3. **Only PRP research and execution agents do real work.** These are the sole agents permitted to write or modify code, and they implement strictly from the PRD. All other agents touch documentation (`PRD.md`, this file) — never implementation files under `src/` or elsewhere.

4. **You are allowed to bring the project into alignment with the PRD, but you are never allowed to add new features to code before they're defined in the PRD.** Being defined in the PRD is _necessary_ but **not sufficient**: the agent that just authored a requirement into the PRD does NOT thereby become authorized to implement it. Implementation is always a separate, later pass by a PRP execution agent reading an already-finalized PRD — never the same agent, turn, or session that wrote the spec entry. If a single request asks you to BOTH spec and build a feature, author the spec and STOP; the build is handed off to a PRP agent.

5. **Out-of-spec corrective work does NOT require a PRP.** Rules 2–4 govern _new features and new requirements_. Any agent may fix — directly in `src/`, `tests/`, `lib/`, `plugin/`, and repo-root meta files, **without** first writing a PRP or a PRD entry — anything that deviates from how the system is already specified or intended to behave: bugs, crashes, silent failures, hangs, rejected-valid-input, wrong exit codes, regressions, broken contracts, or behavior that contradicts an existing PRD requirement. Record the root cause and rationale in code comments and the commit message; a PRD bugfix-section entry is welcome but **not blocking**. This rule is an explicit exception to rule 3's "only PRP agents do real work" for corrective work. It does **not** license new features, new flags, or new behavior beyond existing intent — those still require a PRD entry first per rule 4. (Examples that are fine to fix directly: the event-loop-drain silent exit, CLI flags rejecting valid integers, a discarded process exit code, fataling on an un-started session's missing `tasks.json`. Example that is NOT fine without a PRD entry: adding a brand-new `--resume-from` flag or a new pipeline phase.)

## PLANNING IS PLANNING ONLY

The single most common — and most damaging — violation of the workflow above goes like this: a request describes a feature in detail and asks you to capture it in the spec, and you proceed to _also_ write the implementation in the same turn. **Do not.** Specifying a feature and implementing it are strictly separate, sequential, and **agent-disjoint** steps:

- **Specifying** (planning / architecture agents): edit `PRD.md` / `spec/` / `AGENTS.md` ONLY. Never `src/`, `tests/`, `lib/`, `plugin/`, configs, or tooling.
- **Implementing** (PRP research / execution agents ONLY): read the finalized PRD and write code — in a separate pass, never the turn that authored the spec entry.

A request of the form _"This repo needs the ability to do X … here's the surface I want (`hack update 1.1.1.1 re`, loose matching, etc.) … Update the spec with this requirement"_ means exactly one thing: **write the requirement into the spec and stop.** The detail exists so you can author a precise spec (the exact CLI surface, the matching rules, the cascade semantics), not so you can deliver the feature in the same breath. The fact that you now understand the feature well enough to implement it is precisely _why_ you must hand it off rather than build it.

Rule 5 (corrective out-of-spec fixes) is the ONLY exception to "planning agents never touch code," and it covers bugs/regressions in _existing_ behavior — never new features. "I just added it to the PRD, so now I may build it" is never a valid reason for a planning agent to write implementation code.
