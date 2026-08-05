## 3. System Architecture

The new system must implement four distinct processing engines:

1.  **Session Manager:** Handles state, directory structures (`plan/001_hash`), and PRD diffing.
2.  **Task Orchestrator:** Manages the JSON backlog, dependency resolution, and status updates (replacing the `tsk` CLI).
3.  **Agent Runtime:** Drives the agent loop through a pluggable **harness** (default `pi` / pi.dev; `claude-code` optional) that is orthogonal to the LLM provider, to run specific personas (Architect, Researcher, Coder, QA). See §9.4.
4.  **Pipeline Controller:** The main loop handling the sequence of operations, parallelization, and error recovery.

Preceding all of these is a **bootstrap layer** that runs before any engine: it resolves the repository root by upward `.git` traversal and `chdir`s to it (§9.8; git is a hard prerequisite), then loads layered configuration from `~/.hack`, `<repoRoot>/.hack`, and `<repoRoot>/.hack.local` (§9.7) into the §9.2.1 precedence stack.
