## 9. Technical Specification (Groundswell Implementation)

This section details the implementation strategy leveraging the local [Groundswell](~/projects/groundswell) library.

### 9.1 Technology Stack

- **Runtime**: Node.js 20+ / TypeScript 5.2+
- **Core Framework**: Groundswell (local library at `~/projects/groundswell`)
- **Agent Harness**: `pi` (pi.dev) — the vendor-neutral, **first-class default** runtime. `claude-code` is a **second-class, parity-maintained** option retained specifically for users locked into Anthropic's walled-garden ecosystem (e.g. subscribers who want to spend an Anthropic coding-plan quota); see §9.4.
- **LLM Provider**: z.ai (Anthropic-compatible API), orthogonal to the harness; the default provider. Authentication is **provider-aware** (see §9.2.6) and does **not** assume Anthropic credentials.
- **Commit-Message Generation**: stagecoach — the `stagecoach-ai` npm dependency (per-platform native binary, downloaded at `postinstall`; §9.10.1), invoked **message-only** for descriptive commit messages. Identity-transparent by design (§9.10.2).
- **State Management**: Groundswell `@ObservedState` & `Workflow` persistence
