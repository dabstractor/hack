# Scout 1 — Cleanup Persona Pattern Recon

Recon for building the `cleanup` agent persona (P3.M1.T3.S3). Concrete file:line
refs only. All findings verified against as-built code on 2025-07-24.

## 1. The lightweight stateless single-shot template — `commit-message-agent.ts`

File: `src/agents/commit-message-agent.ts` (full file, 0-115). This is the
canonical pattern to mirror for a stateless single-shot agent factory.

- **Imports** (lines 64-66):
  - `import { createAgent, type Agent } from 'groundswell';`
  - `import { createBaseConfig } from './agent-factory.js';`
  - `import { getLogger } from '../utils/logger.js';`
- **Factory** `createCommitMessageAgent(): Agent` (lines 98-114):
  ```ts
  export function createCommitMessageAgent(): Agent {
    const baseConfig = createBaseConfig('researcher', 'research');
    const config = {
      ...baseConfig,
      name: 'CommitMessageAgent',
      system: COMMIT_MESSAGE_SYSTEM,
      maxTokens: 512,
      enableReflection: false,
      enableCache: false,
    };
    logger().debug({ persona: 'researcher', model: config.model }, 'Creating commit-message agent');
    return createAgent(config);
  }
  ```
- **Key behaviors**: (a) reuses `createBaseConfig('researcher', 'research')` — NO
  expansion of the `AgentPersona` union; (b) overrides `name`, `system`,
  `maxTokens`, `enableReflection: false`, `enableCache: false`; (c) **omits `mcps`**
  entirely (spread baseConfig carries no `mcps`, and the agent adds none); (d)
  returns `createAgent(config)`; (e) system prompt is a module-level `const`
  string (`COMMIT_MESSAGE_SYSTEM`, lines 55-72) — NOT from the `PROMPTS` map.

> **⚠️ CRITICAL DIFFERENCE for cleanup:** commit-message-agent omits `mcps`
> because it only reads a diff from the prompt text. The cleanup agent must
> **perform filesystem operations** (remove temp artifacts, move docs to `docs/`,
> save `tasks.json`), so it MUST include `mcps: MCP_TOOLS` (BashMCP,
> FilesystemMCP, GitMCP). The cleanup persona therefore mirrors commit-message
> for the config-override shape but matches `createCoderAgent`/`createQAAgent`
> for MCP inclusion. See §2.

## 2. `agent-factory.ts` — what must change to add a `cleanup` persona

File: `src/agents/agent-factory.ts`.

- **`AgentPersona` union** (line 98):
  ```ts
  export type AgentPersona = 'architect' | 'researcher' | 'coder' | 'qa';
  ```
  → add `| 'cleanup'`.
- **`PERSONA_TOKEN_LIMITS`** (lines 173-178, declared `as const`):
  ```ts
  const PERSONA_TOKEN_LIMITS = {
    architect: 8192,
    researcher: 4096,
    coder: 4096,
    qa: 4096,
  } as const;
  ```
  → add `cleanup: 4096,` (researcher/coder/qa tier; cleanup is a reorg task, not
  high-reasoning). NOTE: `createBaseConfig` indexes `PERSONA_TOKEN_LIMITS[persona]`
  (line 252) — adding the key is what makes `createBaseConfig('cleanup', ...)` type-check.
- **`ROLE_CONFIG`** (lines 219-231, exported, `Readonly<Record<ModelRole,...>>`):
  unchanged. The three roles are `research`/`reasoning`/`implementation`. Cleanup
  most plausibly uses `'research'` (balanced tier, normal budget) — it is not
  decomposition/validation. (Decision belongs to the S3 PRD/PRP, but `research` is
  the safe default matching the cleanup persona's "reorganize docs" nature.)
- **`createBaseConfig(persona, role='research')`** (lines 230-261): generic; needs
  NO edit — adding `cleanup` to the union + token map is sufficient. It derives
  `name` (`${Capitalized}Agent` → `CleanupAgent`), `model` (via `ROLE_CONFIG`),
  `maxTokens` (via `PERSONA_TOKEN_LIMITS`).
- **Factory pattern to mirror** — `createCoderAgent` / `createQAAgent`
  (lines 360-410). Shape:
  ```ts
  export function createCoderAgent(): Agent {
    const baseConfig = createBaseConfig('coder', 'implementation');
    const config = { ...baseConfig, system: PRP_BUILDER_PROMPT, mcps: MCP_TOOLS };
    logger().debug({ persona: 'coder', model: config.model }, 'Creating agent');
    return createAgent(config);
  }
  ```
  `createQAAgent` is identical but `createBaseConfig('qa', 'reasoning')` +
  `BUG_HUNT_PROMPT`.
  → add a new `createCleanupAgent(): Agent` factory mirroring this shape, with
  `createBaseConfig('cleanup', 'research')` and `system: CLEANUP_PROMPT`, plus
  `mcps: MCP_TOOLS` (cleanup does fs ops — see §1 warning). Place it after
  `createQAAgent` (after line 410, before the re-exports at line 412+).
- **`MCP_TOOLS`** (lines 83-84): `MCPServer[] = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP]`
  (singletons, lines 75-81). Already exported. Cleanup should reuse this array
  (not new instances).
- **Imports at top** (lines 56-61): `TASK_BREAKDOWN_PROMPT`, `PRP_BLUEPRINT_PROMPT`,
  `PRP_BUILDER_PROMPT`, `BUG_HUNT_PROMPT` are imported from `./prompts.js`. → add
  `CLEANUP_PROMPT` to this import list once §3 adds the constant.

## 3. `prompts.ts` — where `CLEANUP_PROMPT` goes

File: `src/agents/prompts.ts`.

- **Declaration pattern** (verified on `BUG_HUNT_PROMPT`, lines 918-924; identical
  for `TASK_BREAKDOWN_PROMPT` lines 47-50, `PRP_BLUEPRINT_PROMPT` lines 182-185,
  `PRP_BUILDER_PROMPT` lines ~662-665): template literal, with
  `PRD_PREMERGED_DECLARATION` injected as the first body line after the H1:
  ```ts
  export const BUG_HUNT_PROMPT = `
  # Creative Bug Finding - End-to-End PRD Validation

  ${PRD_PREMERGED_DECLARATION}

  You are a creative QA engineer ...
  ` as const;
  ```
  - Note: only `BUG_HUNT_PROMPT`, `PRP_BLUEPRINT_PROMPT`, `PRP_BUILDER_PROMPT`,
    `TASK_BREAKDOWN_PROMPT` inject `PRD_PREMERGED_DECLARATION`. The two DELTA
    prompts (`DELTA_PRD_PROMPT` ~line 746, `DELTA_ANALYSIS_PROMPT` ~line 800) also
    inject it. `as const` is used on DELTA_PRD/DELTA_ANALYSIS; the four agent
    prompts do NOT use `as const`.
- **`PRD_PREMERGED_DECLARATION`** (lines 34-37): the shared note string. The
  cleanup agent **may not need PRD context at all** (it operates on a subtask's
  artifacts, not the PRD). Whether to inject it is a PRP decision; the
  established pattern injects it into every agent system prompt.
- **`PROMPTS` map** (lines 1042-1053):
  ```ts
  export const PROMPTS = {
    TASK_BREAKDOWN: TASK_BREAKDOWN_PROMPT,
    PRP_BLUEPRINT: PRP_BLUEPRINT_PROMPT,
    PRP_BUILDER: PRP_BUILDER_PROMPT,
    DELTA_PRD: DELTA_PRD_PROMPT,
    DELTA_ANALYSIS: DELTA_ANALYSIS_PROMPT,
    BUG_HUNT: BUG_HUNT_PROMPT,
  } as const;
  export type PromptKey = keyof typeof PROMPTS;
  ```
  → add `CLEANUP: CLEANUP_PROMPT,` to this object (extends `PromptKey`
  automatically).
- **Where the constant goes**: declare `export const CLEANUP_PROMPT = \`...\`` in
  the body region — logically right before `BUG_HUNT_PROMPT` (line 910 area) or
  after it. Each prompt has a JSDoc block with a `Source:` line (e.g.
  `Source: PROMPTS.md lines 1059-1174`).

## 4. Test pattern — `tests/unit/agents/commit-message-agent.test.ts`

File: `tests/unit/agents/commit-message-agent.test.ts` (full file, 0-165).

- **`vi.mock` pattern** (two mocks):
  1. Mock `createBaseConfig` (lines 31-42) so the factory needs no real
     harness/env:
     ```ts
     vi.mock('../../../src/agents/agent-factory.js', () => ({
       createBaseConfig: vi.fn(() => ({
         name: 'ResearcherAgent', model: 'zai/glm-5.2', harness: 'pi',
         enableCache: true, enableReflection: true, maxTokens: 4096,
         system: 'placeholder',
         env: { ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '' },
       })),
     }));
     ```
  2. Mock `createAgent` from `groundswell` (lines 48-50) to capture the config:
     ```ts
     vi.mock('groundswell', () => ({
       createAgent: vi.fn((cfg: unknown) => ({ __cfg: cfg })),
     }));
     ```
- **Imports after mocks** (lines 52-54): `createAgent` (groundswell),
  `createBaseConfig` (factory), `createCommitMessageAgent` (SUT). Then
  `vi.mocked(...)` aliases (lines 56-57).
- **Assertion style**: `mockCreateBaseConfig` called-with checks + reading the
  captured config via `mockCreateAgent.mock.calls[0][0] as { field: type }`.
  Examples: `expect(mockCreateBaseConfig).toHaveBeenCalledWith('researcher',
  'research')`; `expect(cfg.mcps).toBeUndefined()`; `expect(cfg.maxTokens).toBe(512)`;
  string-content checks on `cfg.system` (`toContain('Conventional Commits')`).
- **For a cleanup-agent test** (`tests/unit/agents/cleanup-agent.test.ts`): mirror
  this exactly, but assert `cfg.mcps` is **defined** (cleanup carries MCP_TOOLS),
  `cfg.name === 'CleanupAgent'`, and `cfg.system` contains the forbidden-paths
  rules (`'plan/'`, `'PRD.md'`, `'PRP.md'`). `createBaseConfig('cleanup',
  'research')` assertion confirms the union was extended.

## 5. The injection seam — `cleanup-runner.ts` (S2, already built)

> **Status: S2 is IMPLEMENTED, not just planned.** `src/core/cleanup-runner.ts`
> exists (2678 bytes) and `task-orchestrator.ts` is already wired to it. S3's job
> is to **replace the no-op `createCleanupRunner` default** with a runner that
> invokes the cleanup persona.

File: `src/core/cleanup-runner.ts` (full file, 0-86). Exact seam types:

```ts
import type { Subtask } from './models.js';   // TYPE-ONLY (avoid cycle)

export interface CleanupContext {
  readonly sessionPath: string;   // plan/{seq}_{hash}/ (or bugfix child)
  readonly subtask: Subtask;
  readonly repoRoot: string;      // process.cwd()
}
export interface CleanupResult {
  readonly success: boolean;
  readonly summary?: string;
  readonly error?: string;
}
export type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>;

export function createCleanupRunner(): CleanupRunner {     // line 61 — the no-op default
  return async (_ctx: CleanupContext): Promise<CleanupResult> => ({
    success: true,
    summary: 'cleanup disabled (no persona wired yet)',
  });
}
```

- The S3 replacement runner signature: `(ctx: CleanupContext) => Promise<CleanupResult>`.
- It receives `sessionPath` (the item's `plan/{seq}_{hash}/` work dir),
  `subtask`, and `repoRoot`. This is the scope the cleanup agent operates on.
- **Injection seam** in `task-orchestrator.ts`:
  - `import { createCleanupRunner, type CleanupRunner } from './cleanup-runner.js';`
    (lines 63-64).
  - `TaskOrchestratorOptions` (lines 81-89): `readonly cleanupRunner?:
    CleanupRunner;` — "P3.M1.T3.S3 wires the real cleanup-agent persona here."
  - Private field `readonly #cleanupRunner: CleanupRunner;` (line 152).
  - Constructor (line 182): `options?: TaskOrchestratorOptions` (trailing,
    backward-compatible). Line 191:
    `this.#cleanupRunner = options?.cleanupRunner ?? createCleanupRunner();`.
  - Call site (line 1056): `await this.#cleanupRunner({ sessionPath, subtask,
    repoRoot })`, wrapped in its own try/catch that **swallows** errors (cleanup
    is non-fatal; outer catch would mark the subtask Failed). See
    `task-orchestrator.ts:1050-1073`.

## 6. PRD rules the `CLEANUP_PROMPT` must encode

Quoted verbatim from `PRD.md`.

### §4.2 step 4 — the cleanup job (PRD.md:73-76)
> - **Cleanup:** Temporary artifacts are removed; documentation is moved to `docs/`.
> - **State is saved:** `tasks.json` updated.

(Preceding line 72: "Pre-cleanup commit (survival)... the cleanup agent is
forbidden from touching `plan/`; see §5.1"; following line 77: "Post-cleanup
commit: The cleanup agent's documentation reorganization is committed in a second
`stagecoach` call.")

### §5.1 — critical-file deletion protection prompt layer (PRD.md:192-202)
> - **Prompt layer:** every deletion-capable agent prompt (cleanup, bug hunter,
>   bug-fix breakdown, post-validation fix) **forbids** `rm` / `git rm` /
>   `git clean` / `mv` against `PRD.md`, any `PRP.md`, or anything under `plan/`,
>   and forbids treating pipeline-state files as "temporary."

This is the exact rule the `CLEANUP_PROMPT` must encode: forbid
`rm`/`git rm`/`git clean`/`mv` on `PRD.md`, `**/PRP.md`, and `plan/**`; forbid
treating `PRD.md`/`PRP.md`/`tasks.json` as temporary.

### §9.3.2 — stateless single-shot constraint (PRD.md:560-565)
> - **Stateless single-shot invocations:** Agent calls that are stateless by nature
>   (**cleanup**, mid-session task update, validation, post-validation fix,
>   bug-finder, per-item PRP execution) **MUST NOT create or resume sessions.**
>   They are single-shot or operate on freshly-built prompts, so enabling session
>   persistence only creates orphaned sessions that serve no purpose (the bash
>   equivalent is the `--no-session` flag).

Implication for the persona: `enableReflection: false` is NOT mandated by this
line (that's about session persistence, not reflection loops), but the cleanup
agent should be configured as a single-shot. Whether reflection/cache stay on is
a PRP decision; commit-message-agent sets both false, the coder/qa factories
leave them true (from `createBaseConfig`).

## 7. Summary — minimum changes for the cleanup persona

| File | Change |
|------|--------|
| `src/agents/prompts.ts` | ADD `export const CLEANUP_PROMPT = \`...\`` (with `PRD_PREMERGED_DECLARATION` + the §5.1 forbidden-paths rules + §4.2 job: rm temp, mv docs→docs/, save tasks.json); ADD `CLEANUP: CLEANUP_PROMPT` to `PROMPTS` (line ~1048). |
| `src/agents/agent-factory.ts` | ADD `'cleanup'` to `AgentPersona` (line 98); ADD `cleanup: 4096` to `PERSONA_TOKEN_LIMITS` (line 177); ADD `CLEANUP_PROMPT` to the `./prompts.js` import (line 56); ADD `createCleanupAgent()` factory (mirror `createCoderAgent`, `createBaseConfig('cleanup','research')`, `mcps: MCP_TOOLS`). |
| `src/core/cleanup-runner.ts` | REPLACE the no-op `createCleanupRunner` (line 61) with a runner that invokes `createCleanupAgent()` — OR add a factory param. (PRP design decision.) |
| `tests/unit/agents/cleanup-agent.test.ts` | NEW — mirror `commit-message-agent.test.ts` mock pattern; assert `name==='CleanupAgent'`, `mcps` defined, `system` contains forbidden-paths rules. |

No other files need changes — the orchestrator seam, the `TaskOrchestratorOptions`
injection, and the two-phase commit flow are all in place from S2.