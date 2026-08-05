## 7. Improvements for the Rewrite

While the Bash script is functional, the rewrite in a higher-level language (Python/Go/Rust) must address these limitations:

1.  **Concurrency Control:** The bash script uses background subshells (`&`) which are hard to monitor. The rewrite should use proper async/await patterns or thread pools for "Parallel Research."
2.  **Structured State:** Replace `jq` parsing with native JSON serialization/deserialization to prevent corruption of `tasks.json`.
3.  **Observability:** structured logging instead of `print -P` (see §9.6 for the logging architecture — lazy loggers and synchronous destinations are mandatory).
4.  **Tool Abstraction:** Instead of relying on `tsk` CLI, integrate the task management logic directly into the codebase.
5.  **Error Handling:** Stronger retry logic and exception handling for API calls and tool failures — including a **fail-fast auth preflight** (§9.2.7) so credential misconfiguration is caught at startup instead of deep inside the first agent run.
6.  **Provider-Agnostic Authentication:** Authenticate the **resolved provider** (`~/.pi/agent/auth.json` or the provider's native env var, e.g. `ZAI_API_KEY`), not Anthropic-shell env vars; `ANTHROPIC_AUTH_TOKEN` is a backward-compat alias, never a hard requirement (see §9.2.6).

## 8. Development Roadmap (Bootstrap)

To implement this PRD, the following self-bootstrapping sequence is recommended:

1.  **Core:** Implement the `Task` and `Session` data structures.
2.  **Orchestrator:** Implement the logic to iterate through the JSON hierarchy.
3.  **Prompts:** Port the HEREDOC prompts into a template engine (e.g., Jinja2).
4.  **Agent Interface:** Build the wrapper to send these prompts to the LLM.
5.  **CLI:** Build the entry point to trigger the pipeline. Bootstrap ordering is load-bearing: `parseCLIArgs()` (so `--help`/`--version` short-circuit first) → **repository-root resolution + `chdir`** (§9.8; git is a hard prerequisite) → **`.hack` config load** (§9.7) → environment/harness/preflight → pipeline.
