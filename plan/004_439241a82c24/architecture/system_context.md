# System Context — Session 004 (Harness Delta)

## 1. What this session is

This is a **DELTA SESSION** (`plan/004_439241a82c24/`), linked from `plan/003_b3d3efdaf0ed/` (see `delta_from.txt` = `3`).

Phases 1–3 of the PRP Pipeline (hacky-hack) are **already COMPLETE**. Session 004
implements a single, focused delta introduced by PRD **§9.4 (Agent Harness System)**
plus clarifications in §3, §9.1, §9.2.2–§9.2.4, §9.3.3, §9.5.

**Scope driver:** `plan/004_439241a82c24/delta_prd.md` (authoritative — read it).

## 2. The one change

Decouple the **agent runtime (harness)** from the **LLM provider/model**:

- **Harness** = how prompting / tool-execution / streaming is driven (`pi` default | `claude-code` optional).
- **Provider** = the LLM host (`zai` by default; `anthropic` if using `claude-code`).

The two are selected **independently**. Model strings are `provider/model`
(e.g. `zai/GLM-4.7`), and are **never** harness-qualified (`pi/zai/GLM-4.7` is invalid).

## 3. Critical reality check — DO NOT REBUILD

**Groundswell already implements the ENTIRE harness system** (it is the dependency
that owns the `Harness` abstraction). Confirmed present & exported in
`~/projects/groundswell/src`:

| Capability                                                                                             | Groundswell export      | File                                        |
| ------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------- |
| `configureHarnesses(cfg)`                                                                              | `groundswell` (public)  | `src/utils/harness-config.ts`               |
| `getGlobalHarnessConfig()`                                                                             | `groundswell`           | `src/utils/harness-config.ts`               |
| `resolveHarnessConfig(...)`                                                                            | `groundswell`           | `src/utils/harness-config.ts`               |
| `registerDefaultHarnesses()`                                                                           | `groundswell/harnesses` | `src/harnesses/register-defaults.ts`        |
| `PiHarness`, `ClaudeCodeHarness`                                                                       | `groundswell`           | `src/harnesses/{pi,claude-code}-harness.ts` |
| `HarnessRegistry`                                                                                      | `groundswell`           | `src/harnesses/harness-registry.ts`         |
| Types: `HarnessId`, `ModelProviderId`, `HarnessOptions`, `GlobalHarnessConfig`, `ModelSpec`, `Harness` | `groundswell`           | `src/types/harnesses.ts`                    |
| `parseModelSpec`, `formatModelForProvider`                                                             | `groundswell`           | `src/utils/model-spec.ts`                   |

Therefore Session 004 is **integration / adoption work** on the PRP (hacky-hack) side:

1. Wire `configureHarnesses()` once at startup.
2. Read `PRP_AGENT_HARNESS` from the environment.
3. Resolve model names to provider-qualified `zai/<model>` strings.
4. Enforce the harness↔provider compatibility rule (`claude-code` + z.ai = config error).
5. Verify parity (tools still run via `MCPHandler` under both harnesses).
6. Update docs.

**No new harness adapter, no changes to session/task/delta/bug-hunt logic.**

## 4. Project facts (confirmed by research)

- **Language/runtime:** Node.js 20+ / TypeScript 5.2+, ESM (`"type": "module"`).
- **Build/test:** `tsc -p tsconfig.build.json` (typecheck), `vitest` (test), `eslint`+`prettier` (lint/format). `npm run validate` = lint + format:check + typecheck.
- **Groundswell linkage:** `file:.yalc/groundswell` (local yalc link, NOT npm link). Built `dist/` consumed. **Do not edit Groundswell sources from this project** — it is an external dependency.
- **Test framework:** Vitest, with env stubbing via `vi.stubEnv` / `vi.unstubAllEnvs()` (see `tests/setup.ts`).

## 5. Out of scope (do NOT plan)

- Building a new harness adapter.
- Session / task / delta / bug-hunt logic (unchanged by this diff).
- Modifying `PRD.md` (human-owned, read-only).

## 6. Forbidden operations reminder (this agent = Task Breakdown)

This agent writes ONLY to `plan/004_439241a82c24/tasks.json` and
`plan/004_439241a82c24/architecture/`. Never touch `PRD.md`, source code,
`.gitignore`, or any other `tasks.json`.
