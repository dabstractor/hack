## 2. Core Philosophy & Concepts

### 2.1 The "PRP" Concept

The central thesis is that AI fails at complex coding tasks due to context dilution. A **PRP** is a focused, information-dense "micro-PRD" for a single task that includes:

- The specific goal.
- Curated context (file paths, specific code snippets).
- Implementation strategy.
- Validation gates (syntax, unit test, integration, manual).
- "No Prior Knowledge" guarantee: An agent should need _only_ the PRP to succeed.

### 2.2 The Session Model

The system creates an immutable audit trail of development.

- **Session:** A directory containing the state of a specific run (tasks, architecture notes, code).
- **Delta Logic:** If the master PRD changes, the system does not overwrite the current session. It creates a linked **Delta Session** that focuses only on the differences (new/modified features) while preserving completed work.

### 2.3 Distributed (Multi-File) PRDs

A PRD of any real size may be authored across multiple files (architecture, API, data model, companion docs) and assembled into one canonical document at load time. A split PRD MUST behave identically to a monolithic one everywhere downstream.

- **Include directive:** An `@path/to/file.md` token is an _include directive_ — it is replaced inline by the referenced file's contents. A line of the form `@path/to/file.md` (optional leading whitespace, nothing else) is always expanded; the `@path` token is also honored inline anywhere on a line (e.g. inside a markdown table cell or in prose).
- **Expansion rules:** A token expands only when _both_ (1) **boundary** — the `@` is at the start of the line or preceded by a non-path character (so `foo@bar.com` and mid-word `@` are left literal), and (2) **existence** — the path resolves to an existing file. Ordinary prose `@mentions` that don't resolve stay verbatim and silent. Includes resolve **project-root-relative** (relative to the entry PRD's directory, regardless of which file contains the directive) and are expanded **recursively with cycle detection** up to `PRD_INCLUDE_MAX_DEPTH` (default 10).
- **Idempotency:** Re-resolving already-resolved content MUST yield identical bytes. This is the property that guarantees hash/snapshot consistency.
- **Single canonical document downstream:** Hashing (§4.1 step 2; §4.3 delta detection), `prd_snapshot.md` writes, delta-PRD inputs, integration/validation/bug-finder prompts, and `prd_selectors`/mdsel section indexing (§4.2) all operate over the **fully-resolved, include-expanded document**, never the raw entry file. mdsel runs over a materialized resolved copy so selectors reference the merged document.
- **Agent guidance:** Agent prompts that embed PRD content MUST state that the text they receive is already the complete merged document (agents must not chase includes themselves).
- **Markers (optional):** When `PRD_INCLUDE_MARKERS` is set, resolved output emits `<!-- @include: path -->` / `<!-- @end-include -->` comment markers. A `.md` token that fails to resolve (stale include) MUST emit a stderr warning.
