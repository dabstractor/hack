# Groundswell Guide

> Guide to the Groundswell integration in the PRP Pipeline — focusing on
> the pluggable agent **harness** system (the runtime that drives prompting,
> tool execution, and streaming), which is selected independently of the LLM
> provider.

**Status**: Published
**Last Updated**: 2026-06-20
**Version**: 1.0.0

## Table of Contents

- [Overview](#overview)
- [Harness System](#harness-system)
  - [Supported Harnesses](#supported-harnesses)
  - [Configuration](#configuration)
  - [Critical Rules](#critical-rules)
  - [Capability Reference](#capability-reference)
  - [Integration Example](#integration-example)
- [See Also](#see-also)

## Overview

Groundswell is the workflow and agent orchestration engine powering the PRP
Pipeline. It provides `Workflow`, `Agent`, `Prompt`, `MCPHandler`, and
caching primitives — see the upstream
[Groundswell README](~/projects/groundswell/README.md) for the full API
surface.

A key architectural decision in Groundswell is the separation of the **agent
runtime** (called the **harness**) from the **LLM provider/model**. The
harness drives prompting, tool execution, and streaming, while the provider
supplies the language model. These are selected **independently** — you can
run the `pi` harness with any provider (including z.ai), or switch to the
`claude-code` harness when you need Anthropic's native runtime.

## Harness System

The **harness** is the agent runtime/SDK that drives prompting, tool
execution, and streaming. It is **orthogonal** to the LLM
**provider/model** — the two are selected independently (see
[Configuration](#configuration)). Mirrors PRD §9.4; see the upstream
[Groundswell Harnesses](~/projects/groundswell/docs/harnesses.md) reference
for full detail.

### Supported Harnesses

| Harness       | SDK / Package                                       | Default?      | Notes                                                                                                                                  |
| ------------- | --------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pi`          | Pi SDK — `@earendil-works/pi-coding-agent` (pi.dev) | **Yes**       | Vendor-neutral runtime; runs any LLM provider (incl. z.ai). MCP, Skills, and LSP supplied by Groundswell's `MCPHandler`.               |
| `claude-code` | Claude Code SDK — `@anthropic-ai/claude-agent-sdk`  | No (optional) | Anthropic-only models. Incompatible with the z.ai provider (PRD §9.2.4). Retained as a parity-maintained fallback for Anthropic users. |

**Default selection.** `PRP_AGENT_HARNESS` defaults to `pi`. This is the
only harness compatible with the project's default z.ai provider and the
§9.2.4 cost safeguard.

### Configuration

```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi', // vendor-neutral default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — INDEPENDENT of the harness
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

- **`PRP_AGENT_HARNESS`** (`pi` | `claude-code`, default `pi`): selects the
  runtime.
- The harness and the provider/model are selected **independently**.
- Harness selection cascades: global default → agent config → prompt
  overrides.
- Harness-specific options (e.g. `skillsDirs` on `pi`) MAY extend the base
  `HarnessOptions`.

Call `configureHarnesses()` **once** at startup, after
`configureEnvironment()` (which maps `ANTHROPIC_AUTH_TOKEN` →
`ANTHROPIC_API_KEY` so the `harnessDefaults` apiKey binding is populated).

### Critical Rules

- **The harness never appears in the model string.** `pi/zai/GLM-4.7` and
  `cc/anthropic/...` are **invalid**. Always use `provider/model`
  (e.g. `zai/GLM-4.7`). (Groundswell's `parseModelSpec` throws on
  3-segment strings.)
- **Provider/harness compatibility.** `claude-code` runs `anthropic/*`
  models only. Requesting the z.ai provider on `claude-code` is a
  configuration error surfaced at `initialize()`/`execute()`; the PRP
  pipeline rejects it at startup (`HarnessProviderMismatchError`).
  See PRD §9.2.4.
- **Feature parity.** All features (MCP tools, skills, hooks,
  `AgentResponse`, caching, workflow events) work identically across both
  harnesses. Tool execution flows through `MCPHandler` for both, so `pi`'s
  lack of built-in MCP/LSP is **not** a capability gap.
- **Cache isolation.** Cache keys incorporate **both** the harness and the
  provider/model.

### Capability Reference

| Capability        | `pi`                                                | `claude-code`                     |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| MCP               | via Groundswell `MCPHandler`                        | built-in **and** via `MCPHandler` |
| Skills            | ✓ native (agentskills.io; loads `~/.claude/skills`) | ✓ native (system prompt)          |
| LSP               | via MCP plugins through `MCPHandler`                | via MCP plugins                   |
| Streaming         | ✓                                                   | ✓                                 |
| Sessions          | ✓                                                   | ✓                                 |
| Extended Thinking | ✓                                                   | ✓                                 |
| LLM providers     | any                                                 | Anthropic only                    |

### Integration Example

At startup the PRP pipeline calls `configureHarnesses()` once (via
`src/config/harness.ts`'s `configureHarness()`), after
`configureEnvironment()`:

```ts
// src/config/harness.ts (effective behavior)
const harness = (process.env.PRP_AGENT_HARNESS ?? 'pi') as 'pi' | 'claude-code';
// claude-code + zai is rejected here with HarnessProviderMismatchError
configureHarnesses({
  defaultHarness: harness,
  defaultModelProvider: 'zai',
  harnessDefaults: {
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});
```

```bash
# .env — agent runtime (optional; defaults to pi)
# PRP_AGENT_HARNESS=pi
# NOTE: claude-code requires anthropic/* models (incompatible with the z.ai provider).
```

For the env-var and model-override details, see
[Configuration](./CONFIGURATION.md).

## See Also

- **[Configuration](./CONFIGURATION.md)** — Environment variables, model
  overrides, and the `PRP_AGENT_HARNESS` env var
- **[Architecture](./ARCHITECTURE.md)** — High-level system architecture
  and design
- **[Installation](./INSTALLATION.md)** — Setup instructions incl.
  Groundswell linking
- **[Groundswell Harnesses](~/projects/groundswell/docs/harnesses.md)** —
  Upstream authoritative harness reference
- **[Groundswell README](~/projects/groundswell/README.md)** — Official
  Groundswell docs
