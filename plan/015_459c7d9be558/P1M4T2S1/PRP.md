# PRP — P1.M4.T2.S1: Per-persona MCP tool subsets + tests

> Project 015 "Commit Generation & Agent Tool Safety" · **PRD §9.10.3 Agent Tool-Access Scoping.**
> Implements the per-role tool matrix so agent tool access is **scoped by role, not granted
> universally** (PRD §9.10.3 verbatim: *"Agent tool access is scoped by role, not granted
> universally"*).
>
> **Parallel-coordination note:** P1.M4.T1.S1 (the bash denylist) is being implemented concurrently
> and edits ONLY `src/tools/bash-mcp.ts` (+ its test). Its output — `isDeniedCommand()` /
> `DenylistResult` wired INSIDE `executeBashCommand` — is ALREADY landed in source (verified). This
> item assumes that denylist is in place: the **qa** persona reuses the existing `BASH_MCP` singleton,
> which now refuses remote/default-branch mutations before spawn. This item does NOT touch
> `bash-mcp.ts` (no overlap). P1.M4.T3.S1 (universal remote-mutation prohibition in agent PROMPTS) is
> still PLANNED and edits prompt text — disjoint from these tool-wiring files.

---

## Goal

**Feature Goal**: Replace the single uniform `MCP_TOOLS = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP]` array
handed to EVERY persona with a `buildToolSet(persona)` function that returns a per-role MCP server
array per the §9.10.3 matrix — no `bash` and read-only git (`git_status`+`git_diff` only) for
architect/researcher/coder/cleanup; denylisted `bash` + full git for qa — so no agent that researches,
plans, implements, or cleans up can mutate git state or run arbitrary shell, and only the validation
(qa) agent can run the test gates (fenced by the T1.S1 denylist).

**Deliverable**:
1. **NEW** `ReadOnlyGitMCP` class in `src/tools/git-mcp.ts` — a read-only git MCP server exposing only
   `git_status` + `git_diff` (extends `MCPHandler`, reuses the existing exported tool schemas +
   executors).
2. **MODIFIED** `src/agents/agent-factory.ts` — adds `READ_ONLY_GIT_MCP` singleton, a `RESTRICTED_TOOLS`
   constant, and `export function buildToolSet(persona: AgentPersona): MCPServer[]`; rewires all 5
   factory functions (`createArchitectAgent`/`createResearcherAgent`/`createCoderAgent`/`createQAAgent`/
   `createCleanupAgent`) from `mcps: MCP_TOOLS` to `mcps: buildToolSet('<persona>')`. `MCP_TOOLS` stays
   exported (it is the full/qa set, still consumed by tests).
3. **MODIFIED** `tests/unit/agents/agent-factory.test.ts` — add a `buildToolSet` describe asserting the
   exact per-persona tool-name matrix (the §9.10.3 acceptance criteria); keep the existing `MCP_TOOLS`
   describe (still valid).
4. **MODIFIED** the other `MCP_TOOLS` consumers that this change breaks: `tests/unit/agents/cleanup-agent.test.ts`,
   `tests/unit/tools/mcp-tool-parity.test.ts`, `tests/integration/coder-agent-config.test.ts`
   (verify `tests/integration/qa-agent.test.ts` — should pass unchanged since qa→MCP_TOOLS).

**Success Definition**:
- `buildToolSet('architect'|'researcher'|'coder'|'cleanup')` exposes exactly `{file_read, file_write,
  glob_files, grep_search, git_status, git_diff}` — NO `execute_bash`, NO `git_add`, NO `git_commit`.
- `buildToolSet('qa')` exposes exactly `{file_read, file_write, glob_files, grep_search, execute_bash,
  git_status, git_diff, git_add, git_commit}`.
- All 5 factory functions pass `mcps: buildToolSet(<persona>)` (verified by intercepting the
  `createAgent` config in the test, mirroring the existing delegating-spy pattern).
- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npx vitest run tests/unit/agents/agent-factory.test.ts` + the 3–4 updated consumer files → green.
- `git diff --stat` shows changes confined to `src/tools/git-mcp.ts`, `src/agents/agent-factory.ts`, and
  the listed test files. **No change to `src/tools/bash-mcp.ts`** (T1.S1 owns it) and **no new agent
  behavior beyond the tool matrix** (pure tool-surface scoping).

## User Persona (if applicable)

**Target User**: Pipeline operator / security reviewer. The incident (§9.10.3) was a `pi`+`glm` agent
using an unguarded shell + authed `gh` to flip a GitHub default branch. End users are unaffected.

**Use Case**: An architect/researcher/coder/cleanup agent must NOT be able to run `git commit`,
`git push`, `git remote`, or any shell — it can only read repo state (`git_status`/`git_diff`) and
read/write files. A qa agent CAN run `npx vitest` / `npm test` / `npx tsc` (fenced by the denylist) and
inspect + stage + commit via structured git tools.

**User Journey**: agent created via `create<Persona>Agent()` → `buildToolSet(persona)` selects the
MCP server array → passed to `createAgent({..., mcps})` → harness exposes only those tools to the LLM
→ an attempt to call a non-exposed tool is impossible (the tool isn't in the LLM's tool list).

**Pain Points Addressed**: removes the **capability** (not just the wording) for any non-qa agent to
mutate git or run shell — the root-cause mitigation for incident 2.

## Why

- **Closes the §9.10.3 capability gap.** Today every persona gets `execute_bash` + `git_add` +
  `git_commit`. The matrix removes those from research/planner/coder/cleanup at the tool layer (the
  agent literally never sees the tool), which is stronger than a prompt prohibition.
- **Completes the T1.S1 defense-in-depth.** T1.S1 fences the bash tool that DOES exist (the denylist);
  this item ensures only the qa persona even receives a bash tool.
- **Scope discipline.** Pure tool-surface scoping on existing, in-spec personas — no new persona, no new
  tool, no behavior change beyond which tools each persona sees. The `ReadOnlyGitMCP` reuses existing
  exported executors (no new git logic).

## What

1. **`src/tools/git-mcp.ts`** — add `export class ReadOnlyGitMCP extends MCPHandler` (`name='git'`,
   `transport='inprocess'`, `tools=[gitStatusTool, gitDiffTool]`, registers only the 2 read-only
   executors). The existing `GitMCP` (4 tools) is unchanged.
2. **`src/agents/agent-factory.ts`** — add `READ_ONLY_GIT_MCP` singleton, `RESTRICTED_TOOLS` constant,
   `buildToolSet(persona)`; rewire the 5 factories.
3. **Tests** — assert the per-persona matrix; update the consumers that break.

### Success Criteria

- [ ] `ReadOnlyGitMCP` exists, exposes only `git_status`+`git_diff`, follows the `GitMCP` class pattern.
- [ ] `buildToolSet` returns the exact matrix (architect/researcher/coder/cleanup → restricted; qa → full).
- [ ] All 5 factories call `buildToolSet(<persona>)` (no remaining `mcps: MCP_TOOLS` in a factory).
- [ ] The 4 listed consumer test files are green (3 updated + qa verified).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

## All Needed Context

### Context Completeness Check

If an implementer knew nothing about this codebase, would they have everything needed? **Yes.** This
PRP names the exact files, the MCPHandler registration mechanics (with the d.ts evidence), the per-persona
matrix, the `ReadOnlyGitMCP` class shape, the `buildToolSet` signature + body, the 5 factory edit sites,
the full list of test files that break (with per-file breakage analysis), and the validation commands.
The companion `research/findings.md` holds the raw evidence.

### Documentation & References

```yaml
# MUST READ — the PRD contract + the codebase primer
- docfile: plan/015_459c7d9be558/architecture/stagecoach-and-agent-factory.md
  why: §2.1 (singleton MCPs + uniform MCP_TOOLS), §2.2 (exact tool names), §2.3 (AgentPersona + factories),
       §2.5 (NO commit persona — commit is internal smartCommit), §2.6/§2.7 (GitMCP/BashMCP class patterns),
       §2.8 (the three subsetting options + the buildToolSet recommendation).
  section: "PART 2" §2.1–§2.8.
  critical: "There is NO 'Commit' persona" + "all agents currently share MCP_TOOLS uniformly" — this item
            replaces that uniformity.

# Companion research (matrix, registration model, consumer breakage analysis)
- docfile: plan/015_459c7d9be558/P1M4T2S1/research/findings.md
  why: §3 (MCPHandler registration → why a separate ReadOnlyGitMCP instance is the clean subset mechanism),
       §5 (the 5 MCP_TOOLS test consumers + per-file breakage), §6 (out-of-scope BashMCP sites).
  section: §5 (CRITICAL — test breakage) + §3 (registration model).

# The parallel item's output (assumed landed — verified in source)
- docfile: plan/015_459c7d9be558/P1M4T1S1/PRP.md
  why: T1.S1 adds isDeniedCommand()/DenylistResult INSIDE executeBashCommand (fail-closed). The qa persona
       reuses the existing BASH_MCP singleton, which now carries that denylist. This item does NOT touch
       bash-mcp.ts. (The denylist is already present in src/tools/bash-mcp.ts — confirmed by direct read.)
  critical: buildToolSet('qa') returns the EXISTING BASH_MCP — do NOT construct a second BashMCP.

# ── SRC to MODIFY ──
- file: src/agents/agent-factory.ts
  why: THE primary file. Singletons at :83-85, MCP_TOOLS at :87, 5 factories each with `mcps: MCP_TOOLS`.
  pattern: add READ_ONLY_GIT_MCP singleton + RESTRICTED_TOOLS const + buildToolSet(persona); replace the
           5 `mcps: MCP_TOOLS` spreads with `mcps: buildToolSet('<persona>')`. createBaseConfig does NOT
           set mcps (factories do) — confirmed.
  gotcha: keep `export { MCP_TOOLS }` — it is consumed by 5 test files; buildToolSet('qa') should RETURN
          MCP_TOOLS (object identity) so qa-agent.test.ts passes unchanged.

- file: src/tools/git-mcp.ts
  why: home of GitMCP + the exported gitStatusTool/gitDiffTool/gitStatus/gitDiff. Add ReadOnlyGitMCP here.
  pattern: mirror GitMCP's class exactly but tools=[gitStatusTool, gitDiffTool] + only 2 registerToolExecutor calls.
  gotcha: name='git' (same namespace — correct; no persona holds two 'git' servers). Do NOT change GitMCP.

# ── SRC READ-ONLY (the registration mechanics + the denylist) ──
- file: node_modules/groundswell/dist/core/mcp-handler.d.ts
  why: MCPHandler.registerServer({name,transport,tools}) populates the discoverable tools;
       registerToolExecutor(serverName,toolName,fn) the callback. getTools()/toPiCustomTools() iterate
       registeredTools. Each INSTANCE holds its own maps → a separate instance subsetting is clean.
- file: node_modules/groundswell/dist/types/sdk-primitives.d.ts:34
  why: MCPServer interface { name:string; transport:'stdio'|'inprocess'; tools?:Tool[] }.
- file: src/tools/bash-mcp.ts
  why: READ-ONLY. Confirms isDeniedCommand() + DenylistResult are already exported + wired into
       executeBashCommand (T1.S1 landed). The qa BASH_MCP singleton inherits it.

# ── TEST patterns to mirror ──
- file: tests/unit/agents/agent-factory.test.ts
  why: the delegating-spy vi.mock('groundswell') pattern (wraps createAgent, passes through the rest);
       the `MCP_TOOLS` describe (length 3, distinct names); the "agent creation functions" describe.
  pattern: add a `buildToolSet` describe that, for each persona, enumerates the exposed tool names
           (via `(await ...).tools` or getTools()) and asserts the exact set. Intercept the createAgent
           config to assert each factory passes buildToolSet(<persona>).

# ── PRD ──
- docfile: PRD.md (§9.10.3)
  why: the per-role matrix + acceptance criteria (the validation bar).
  section: "9.10.3 Agent Tool-Access Scoping & Remote-Mutation Prohibition".
```

### Current Codebase tree (files in scope + the registration seam)

```bash
src/agents/agent-factory.ts          # MODIFY — buildToolSet + READ_ONLY_GIT_MCP + RESTRICTED_TOOLS + rewire 5 factories
src/tools/git-mcp.ts                 # MODIFY — add ReadOnlyGitMCP class (GitMCP unchanged)
src/tools/bash-mcp.ts                # READ-ONLY (T1.S1 denylist — do NOT touch)
src/tools/filesystem-mcp.ts          # READ-ONLY (stays full for all personas)
node_modules/groundswell/.../mcp-handler.d.ts  # READ-ONLY (MCPHandler registration mechanics)
tests/unit/agents/agent-factory.test.ts        # MODIFY — add buildToolSet describe
tests/unit/agents/cleanup-agent.test.ts        # MODIFY — cleanup now carries RESTRICTED_TOOLS, not MCP_TOOLS
tests/unit/tools/mcp-tool-parity.test.ts       # MODIFY — researcher no longer === MCP_TOOLS / 9 tools
tests/integration/coder-agent-config.test.ts   # MODIFY — coder now RESTRICTED
tests/integration/qa-agent.test.ts             # VERIFY (likely passes — qa === MCP_TOOLS)
```

### Desired Codebase tree with files to be added/changed

```bash
src/tools/git-mcp.ts                 # + ReadOnlyGitMCP class (read-only git server)
src/agents/agent-factory.ts          # + buildToolSet + singletons; 5 factories rewired
tests/unit/agents/agent-factory.test.ts        # + buildToolSet matrix describe
tests/unit/agents/cleanup-agent.test.ts        # updated assertion
tests/unit/tools/mcp-tool-parity.test.ts       # updated assertion
tests/integration/coder-agent-config.test.ts   # updated assertion
# No new files under src/ beyond the ReadOnlyGitMCP class (it lives IN git-mcp.ts).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — MCPHandler registration is PER-INSTANCE. Each GitMCP/BashMCP/FilesystemMCP holds its OWN
//   private servers/registeredTools/toolExecutors maps (mcp-handler.d.ts). A SEPARATE ReadOnlyGitMCP
//   instance that registerServer()s only git_status+git_diff and registers only those 2 executors
//   exposes EXACTLY those 2 tools. Do NOT try to "unregister" tools from the shared GitMCP singleton.

// CRITICAL — keep `export { MCP_TOOLS }` and make buildToolSet('qa') RETURN MCP_TOOLS (object identity).
//   tests/integration/qa-agent.test.ts:359 asserts qa config.mcps === MCP_TOOLS; returning the same
//   instance keeps it green. For architect/researcher/coder/cleanup return a module-level RESTRICTED_TOOLS
//   CONSTANT (not a fresh array per call) so mcp-tool-parity identity assertions can be satisfied.

// CRITICAL — the change breaks 3–4 OTHER test files (not just agent-factory.test.ts). The item
//   description names only agent-factory.test.ts, but MCP_TOOLS is consumed by cleanup-agent.test.ts,
//   mcp-tool-parity.test.ts, coder-agent-config.test.ts (and qa-agent.test.ts). Run each after the
//   change and update the broken ones — the build cannot go green otherwise.

// GOTCHA — ReadOnlyGitMCP.name MUST be 'git' (it is the tool namespace prefix → git__git_status).
//   No single persona ever holds two 'git' servers (qa gets full GitMCP; others get ReadOnlyGitMCP),
//   so there is no name collision within any agent's mcps array.

// GOTCHA — do NOT touch src/tools/bash-mcp.ts (T1.S1 owns it, parallel item) or the direct-execution
//   BashMCP sites in prp-executor.ts:272 / validation-workflow.ts:318 (those run validation gates
//   directly, NOT as agent tools — out of scope).

// CRITICAL — NEVER weaken an assertion to go green. Update the literal to the new (correct) tool set.
//   This is pure tool-surface scoping of in-spec personas — no src/ behavior change beyond which tools
//   each persona sees. Do NOT add new tools, new personas, or new git commands.
```

## Implementation Blueprint

### Data models and structure

No production data models change. The additions are:
- A new `ReadOnlyGitMCP` class (an MCP server variant), structurally identical to `GitMCP` minus 2 tools.
- A `buildToolSet(persona): MCPServer[]` selector + two module-level tool-array constants.

### Implementation Tasks (ordered by dependencies)

```yaml
# ───────────────────────────────── TASK 1: ReadOnlyGitMCP (git-mcp.ts) ─────────────────────────────────
Task 1: ADD class ReadOnlyGitMCP to src/tools/git-mcp.ts (alongside GitMCP; GitMCP UNCHANGED)
  - IMPLEMENT: `export class ReadOnlyGitMCP extends MCPHandler { readonly name='git'; readonly transport='inprocess' as const; readonly tools=[gitStatusTool, gitDiffTool]; constructor(){ super(); this.registerServer({name:this.name,transport:this.transport,tools:this.tools}); this.registerToolExecutor('git','git_status', async (i:unknown)=>gitStatus(i as GitStatusInput)); this.registerToolExecutor('git','git_diff', async (i:unknown)=>gitDiff(i as GitDiffInput)); } }`
  - FOLLOW pattern: the existing GitMCP class in the SAME file (identical structure, fewer tools/executors).
  - REUSE: the already-exported gitStatusTool, gitDiffTool (schemas) + gitStatus, gitDiff (executors) — NO new git logic.
  - NAMING: ReadOnlyGitMCP (PascalCase). name='git' (namespace — same as GitMCP; intentional).
  - PLACEMENT: src/tools/git-mcp.ts, immediately after the GitMCP class. Export it from the file's export block.
  - GOTCHA: do NOT modify GitMCP. Add a JSDoc citing §9.10.3 ("read-only git for non-validation personas").

# ───────────────────────────────── TASK 2: buildToolSet + singletons (agent-factory.ts) ─────────────────────────────────
Task 2: MODIFY src/agents/agent-factory.ts — add buildToolSet + wire factories
  - IMPORT: add ReadOnlyGitMCP to the existing `import { GitMCP } from '../tools/git-mcp.js'` line.
  - ADD singleton: `const READ_ONLY_GIT_MCP = new ReadOnlyGitMCP();` (next to the existing BASH_MCP/FILESYSTEM_MCP/GIT_MCP).
  - ADD constant: `const RESTRICTED_TOOLS: MCPServer[] = [FILESYSTEM_MCP, READ_ONLY_GIT_MCP];` (no bash; read-only git).
  - KEEP: `const MCP_TOOLS: MCPServer[] = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP];` (the FULL set = qa's set).
  - ADD + EXPORT:
      /**
       * Per-persona MCP tool matrix (PRD §9.10.3 — "Agent tool access is scoped by role, not granted universally").
       * - qa (Validation): filesystem + denylisted bash (T1.S1) + FULL git (status/diff/add/commit) — runs test gates.
       * - architect/researcher/coder/cleanup (Research/Planner/Coder/Cleanup): filesystem + READ-ONLY git
       *   (git_status/git_diff only) — NO bash, NO git_add/git_commit. These roles must not mutate git or run shell.
       * Cleanup maps to the Coder-equivalent (implementation-tier; no bash, read-only git).
       */
      export function buildToolSet(persona: AgentPersona): MCPServer[] {
        return persona === 'qa' ? MCP_TOOLS : RESTRICTED_TOOLS;
      }
  - REWIRE the 5 factories: replace `mcps: MCP_TOOLS,` with `mcps: buildToolSet('architect'|'researcher'|'coder'|'qa'|'cleanup'),`
    in createArchitectAgent, createResearcherAgent, createCoderAgent, createQAAgent, createCleanupAgent.
    (createQAAgent: buildToolSet('qa'). The persona literal is clear/self-documenting at each site.)
  - KEEP `export { MCP_TOOLS };` at file end (consumed by tests; qa returns it).
  - FOLLOW pattern: the existing singleton declarations + factory mcps spreads.
  - VERIFY no remaining `mcps: MCP_TOOLS` inside any factory (grep).

# ───────────────────────────────── TASK 3: agent-factory.test.ts — buildToolSet matrix ─────────────────────────────────
Task 3: MODIFY tests/unit/agents/agent-factory.test.ts — add the per-persona matrix describe
  - IMPORT: add buildToolSet (and ReadOnlyGitMCP if asserting identity) to the existing agent-factory import.
  - ADD describe('buildToolSet (PRD §9.10.3 per-role tool matrix)', () => { ... }) with:
      • a helper `toolNames(persona) = buildToolSet(persona).flatMap(m => (m.tools ?? []).map(t => t.name)).sort()`
      • it('qa (Validation) gets filesystem + denylisted bash + FULL git', () => {
          expect(toolNames('qa')).toEqual(['execute_bash','file_read','file_write','git_add','git_commit','git_diff','git_status','glob_files','grep_search'].sort());
        });
      • it.each(['architect','researcher','coder','cleanup'] as AgentPersona[])('%s gets filesystem + read-only git (NO bash, NO git_add/git_commit)', (p) => {
          const names = toolNames(p);
          expect(names).toEqual(['file_read','file_write','git_diff','git_status','glob_files','grep_search'].sort());
          expect(names).not.toContain('execute_bash');
          expect(names).not.toContain('git_add');
          expect(names).not.toContain('git_commit');
        });
      • it('qa tool set is object-identical to MCP_TOOLS (no second BashMCP)', () => {
          expect(buildToolSet('qa')).toBe(MCP_TOOLS);
        });
  - ADD (in the existing 'agent creation functions' describe or a new one): intercept the createAgent config
    and assert each factory passes the persona's tool set. Pattern: `const cfg = vi.mocked(createAgent).mock.calls.at(-1)?.[0] as any;`
    then `expect(cfg.mcps).toBe(buildToolSet('<persona>'))` after calling create<Persona>Agent(). (Mirror the
    existing delegating-spy: createAgent is wrapped but real, so calls are recorded.)
  - KEEP the existing 'MCP_TOOLS' describe (still valid — MCP_TOOLS is the full set).
  - FOLLOW pattern: the file's existing describe/it/it.each + the delegating-spy createAgent mock.

# ───────────────────────────────── TASK 4: update the broken MCP_TOOLS consumers ─────────────────────────────────
Task 4: FIX the 3–4 other test files that break (run each first to confirm; update the broken ones)
  - RUN first: `npx vitest run tests/unit/agents/cleanup-agent.test.ts tests/unit/tools/mcp-tool-parity.test.ts tests/integration/coder-agent-config.test.ts tests/integration/qa-agent.test.ts` — capture failures.
  - tests/unit/agents/cleanup-agent.test.ts:106 'should carry MCP_TOOLS (cleanup mutates the filesystem)':
      cleanup now carries RESTRICTED_TOOLS (filesystem + read-only git), NOT MCP_TOOLS. Update the assertion to
      the cleanup tool set (it still has filesystem — the test's INTENT holds). e.g. assert mcps exposes file_*
      and git_status/git_diff but NOT execute_bash / git_commit. Import buildToolSet.
  - tests/unit/tools/mcp-tool-parity.test.ts: uses createBaseConfig('researcher') + asserts config.mcps === MCP_TOOLS
      and 9 tools. researcher is now RESTRICTED (6 tools) and !== MCP_TOOLS. Update: either (a) switch the
      fixture persona to 'qa' (still === MCP_TOOLS, 9 tools — preserves the parity intent), OR (b) re-assert
      against buildToolSet('researcher'). Prefer (a) if the test's purpose is "both harnesses reference the
      identical set" — use qa so identity + count hold. Document the choice in the test.
  - tests/integration/coder-agent-config.test.ts (~:190): coder is now RESTRICTED. Update its mcps assertion to
      the coder tool set (no bash, read-only git). Import buildToolSet.
  - tests/integration/qa-agent.test.ts:359: qa config.mcps === MCP_TOOLS — should PASS unchanged (qa→MCP_TOOLS).
      VERIFY by running; only edit if it breaks.
  - DO NOT weaken assertions to force green — update the literal to the correct tool set per the matrix.

# ───────────────────────────────── TASK 5: VERIFY ─────────────────────────────────
Task 5: VERIFY static gates + the affected test files green + scope guard
  - RUN: npm run typecheck && npm run lint && npm run format:check   → clean
  - RUN: npx vitest run tests/unit/agents/agent-factory.test.ts      → green (incl. new buildToolSet describe)
  - RUN: npx vitest run tests/unit/agents/cleanup-agent.test.ts tests/unit/tools/mcp-tool-parity.test.ts tests/integration/coder-agent-config.test.ts tests/integration/qa-agent.test.ts  → green
  - RUN: grep -n "mcps: MCP_TOOLS" src/agents/agent-factory.ts       → EMPTY (all 5 factories rewired)
  - RUN: git diff --stat                                              → only git-mcp.ts, agent-factory.ts, + the listed test files
```

### Implementation Patterns & Key Details

```ts
// ── ReadOnlyGitMCP (src/tools/git-mcp.ts) — mirror GitMCP, fewer tools ───────────────────────
import { MCPHandler, type Tool } from 'groundswell';
// (gitStatusTool, gitDiffTool, gitStatus, gitDiff, GitStatusInput, GitDiffInput already defined/exported above)
export class ReadOnlyGitMCP extends MCPHandler {
  public readonly name = 'git';
  public readonly transport = 'inprocess' as const;
  public readonly tools: Tool[] = [gitStatusTool, gitDiffTool];
  constructor() {
    super();
    this.registerServer({ name: this.name, transport: this.transport, tools: this.tools });
    this.registerToolExecutor('git', 'git_status', async (input: unknown) => gitStatus(input as GitStatusInput));
    this.registerToolExecutor('git', 'git_diff', async (input: unknown) => gitDiff(input as GitDiffInput));
  }
}

// ── buildToolSet (src/agents/agent-factory.ts) ──────────────────────────────────────────────
const READ_ONLY_GIT_MCP = new ReadOnlyGitMCP();
const RESTRICTED_TOOLS: MCPServer[] = [FILESYSTEM_MCP, READ_ONLY_GIT_MCP]; // no bash; read-only git
// MCP_TOOLS stays = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP] (the full set = qa)
export function buildToolSet(persona: AgentPersona): MCPServer[] {
  // PRD §9.10.3: tool access scoped by role. qa=Validation runs test gates (denylisted bash + full git);
  // architect/researcher/coder/cleanup get read-only git + filesystem, NO bash, NO git_add/git_commit.
  return persona === 'qa' ? MCP_TOOLS : RESTRICTED_TOOLS;
}
// each factory: const config = { ...baseConfig, system: PROMPT, mcps: buildToolSet('<persona>') };

// ── Test: enumerate exposed tools per persona (the §9.10.3 acceptance bar) ───────────────────
const toolNames = (persona: AgentPersona) =>
  buildToolSet(persona).flatMap(m => (m.tools ?? []).map(t => t.name)).sort();
// qa      → ['execute_bash','file_read','file_write','git_add','git_commit','git_diff','git_status','glob_files','grep_search']
// others  → ['file_read','file_write','git_diff','git_status','glob_files','grep_search']
```

### Integration Points

```yaml
DATABASE: none
CONFIG:   none
ROUTES:   none
GIT:      none
# The change is pure tool-surface wiring. Integration surface:
#  - src/tools/git-mcp.ts exports ReadOnlyGitMCP (consumed by agent-factory.ts).
#  - src/agents/agent-factory.ts exports buildToolSet (consumed by its 5 factories + tests).
#  - createAgent (groundswell) receives mcps: MCPServer[] per persona; the harness exposes only those tools.
# No env vars, no package.json, no new deps. No change to bash-mcp.ts / filesystem-mcp.ts / prompts.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit ; expect clean (ReadOnlyGitMCP + buildToolSet typecheck)
npm run lint             # eslint . --ext .ts ; expect clean for edited files
npm run format:check     # prettier --check ; expect clean
# If prettier complains: npx prettier --write src/tools/git-mcp.ts src/agents/agent-factory.ts <test files>
# Expected: Zero errors. Read any output and fix before proceeding.
```

### Level 2: Unit Tests (the primary gate — the per-persona matrix)

```bash
# The new buildToolSet describe + the existing MCP_TOOLS describe:
npx vitest run tests/unit/agents/agent-factory.test.ts
# Expected: green; the matrix tests assert the EXACT tool-name set per persona (no execute_bash /
# git_add / git_commit for architect/researcher/coder/cleanup; full set for qa).

# The consumers this change touches:
npx vitest run tests/unit/agents/cleanup-agent.test.ts
npx vitest run tests/unit/tools/mcp-tool-parity.test.ts
npx vitest run tests/integration/coder-agent-config.test.ts
npx vitest run tests/integration/qa-agent.test.ts
# Expected: all green (3 updated + qa verified). If any fails, read the assertion and update the literal
# to the correct tool set per the matrix — do NOT weaken it.
```

### Level 3: System Validation (no regression across the suite)

```bash
# Confirm no other MCP_TOOLS consumer regressed + the denylist (T1.S1) still fences the qa bash:
npx vitest run --reporter=dot 2>&1 | tail -n 30
# Expected: no NEW failures vs. the pre-change baseline. (If T1.S1's bash-mcp.test.ts is also green,
# the qa bash tool is denylisted as required.)
npm run typecheck   # confirm clean (catches stray edits)
```

### Level 4: Creative & Domain-Specific Validation (the §9.10.3 acceptance criteria)

```bash
# Scope guard — only the intended files changed; bash-mcp.ts untouched (T1.S1 owns it):
git diff --stat -- src/tools/bash-mcp.ts    # EXPECT: empty
git diff --stat -- src/tools/filesystem-mcp.ts  # EXPECT: empty
git diff --stat                              # EXPECT: git-mcp.ts, agent-factory.ts, + listed test files

# §9.10.3 acceptance: no non-qa factory exposes bash / git_add / git_commit:
grep -n "mcps: MCP_TOOLS" src/agents/agent-factory.ts   # EXPECT: empty (all rewired to buildToolSet)
grep -n "buildToolSet(" src/agents/agent-factory.ts     # EXPECT: 1 def + 5 call sites

# Tool-matrix self-check (run inline):
node --input-type=module -e "
import('./dist/agents/agent-factory.js').then(({buildToolSet}) => {
  for (const p of ['architect','researcher','coder','cleanup','qa']) {
    const n = buildToolSet(p).flatMap(m=>(m.tools??[]).map(t=>t.name)).sort();
    console.log(p, n);
  }
});" 2>/dev/null || echo "(skip — dist not built; rely on the vitest matrix tests in Level 2)"
# Expected: architect/researcher/coder/cleanup → [file_read,file_write,git_diff,git_status,glob_files,grep_search];
#           qa → [+ execute_bash, git_add, git_commit].
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/agents/agent-factory.test.ts` green (incl. the new `buildToolSet` matrix describe).
- [ ] `cleanup-agent.test.ts`, `mcp-tool-parity.test.ts`, `coder-agent-config.test.ts`, `qa-agent.test.ts` green.
- [ ] `npx vitest run --reporter=dot`: no new failures vs. baseline.
- [ ] `git diff --stat` confined to `git-mcp.ts`, `agent-factory.ts`, + the listed test files; `bash-mcp.ts`/`filesystem-mcp.ts` untouched.

### Feature Validation (§9.10.3 acceptance criteria)

- [ ] architect/researcher/coder/cleanup tool set contains NO `execute_bash` and NO `git_*` beyond `git_status`/`git_diff`.
- [ ] qa tool set contains `execute_bash` (denylisted via T1.S1) + full git (`git_status`/`git_diff`/`git_add`/`git_commit`).
- [ ] Each factory passes `mcps: buildToolSet(<persona>)` (intercepted createAgent config).
- [ ] `ReadOnlyGitMCP` exposes exactly `git_status`+`git_diff` (no git_add/git_commit leak).
- [ ] No agent tool, in any role, can reach a remote ref / default branch (no `git push`/`git remote` tool exists; bash denylist fences the qa shell).

### Code Quality Validation

- [ ] `ReadOnlyGitMCP` mirrors the `GitMCP` class pattern exactly (extends MCPHandler; registerServer + registerToolExecutor in constructor).
- [ ] `buildToolSet` returns module-level constants (object identity per persona-group) — no fresh arrays per call.
- [ ] JSDoc on `buildToolSet` + `ReadOnlyGitMCP` cites PRD §9.10.3 ("tool access scoped by role, not granted universally").
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] JSDoc documents the per-role matrix on `buildToolSet` (qa=Validation runs gates; others=read-only + no bash; cleanup=Coder-equivalent).
- [ ] No new env vars, no package.json change.
- [ ] Commit message uses the project's format (no `[PRP Auto]` / no `Co-Authored-By` — §9.10.2). If a task-prefix convention exists, use `P1.M4.T2.S1: <subject>`.

---

## Anti-Patterns to Avoid

- ❌ Don't try to "unregister" tools from the shared `GIT_MCP` singleton — MCPHandler registration is
  per-instance; create a SEPARATE `ReadOnlyGitMCP` instance that only registers 2 tools.
- ❌ Don't make `buildToolSet` return a fresh array per call for non-qa personas — return the module-level
  `RESTRICTED_TOOLS` constant so object-identity tests (`config.mcps === ...`) can be satisfied.
- ❌ Don't drop the `MCP_TOOLS` export or stop having `buildToolSet('qa')` return it — `qa-agent.test.ts`
  and `mcp-tool-parity.test.ts` rely on qa === MCP_TOOLS identity.
- ❌ Don't touch `src/tools/bash-mcp.ts` (T1.S1 owns it, parallel item) or the direct-execution BashMCP
  sites in `prp-executor.ts` / `validation-workflow.ts` (out of scope).
- ❌ Don't ignore the 3–4 other test files that consume `MCP_TOOLS` — the build cannot go green without
  updating `cleanup-agent.test.ts`, `mcp-tool-parity.test.ts`, and `coder-agent-config.test.ts`.
- ❌ Don't weaken an assertion (e.g. drop a `git_commit` check) to force green — update the literal to the
  correct per-persona tool set.
- ❌ Don't add new git tools, new personas, or a "commit persona" — there is none (commit is internal
  `smartCommit`). This is pure tool-surface scoping of the 5 existing personas.
- ❌ Don't name `ReadOnlyGitMCP` anything but `'git'` — it is the tool namespace; renaming would break
  `git__git_status` tool resolution.
- ❌ Don't prepend `[PRP Auto]` / `Co-Authored-By` to the commit (forbidden per §9.10.2).

---

## Confidence Score

**9/10** — one-pass success likelihood. The change is small and surgical: one ~20-line class mirroring an
existing one, one ~6-line selector, and 5 one-line factory rewires. The MCPHandler registration model is
fully understood (per-instance maps → a separate ReadOnlyGitMCP instance is the clean subset). The one
residual risk — breaking the 3–4 other `MCP_TOOLS` test consumers — is explicitly enumerated with a per-file
breakage analysis and a run-first-then-update task, so it cannot surprise the implementer. The matrix itself
is pinned to the item-description contract (qa→full git) with the PRD §9.10.3 "—" imprecision flagged and
resolved. The §9.10.3 acceptance criteria map directly to enumerable tool-name assertions in the test.