# Research 01 — Prompt Delivery Mechanism Audit (groundswell + src/)

**Question**: Does ANY code path in the agent runtime deliver an LLM prompt
as a command-line argv string (BAD — capped by `MAX_ARG_STRLEN = 131072`,
fails `E2BIG`) instead of a programmatic message body (GOOD)?

**Source**: `scout` subagent codebase recon over `node_modules/groundswell/`
+ `src/agents/` + `src/tools/` + `src/utils/`.

## VERDICT: NO argv-based prompt delivery exists. Confirmed programmatic.

### Evidence chain (end-to-end)

1. **`node_modules/groundswell/` is the published dist v1.0.1, NOT an
   npm-linked symlink.** `package.json` → `main: ./dist/index.js`.

2. **ZERO `child_process` usage in the entire groundswell library:**
   `grep -rn "child_process\|spawnSync\|execSync\|spawn(\|execFile" \
   node_modules/groundswell/dist/` → **0 matches.** Groundswell physically
   cannot shell out; there is no process-spawning facility at all.

3. **`Agent.prompt()` → harness path is 100% programmatic:**
   - `node_modules/groundswell/dist/core/agent.js`:
     - `prompt(prompt, overrides)` @ **L187** → `executePrompt()`.
     - `executePrompt()` @ **L458**: builds
       `userMessage = prompt.buildUserMessage()` (a plain JS **string**).
     - Builds a `HarnessRequest` object @ **L598-607**:
       `{ prompt: userMessage, options: { model, systemPrompt, tools,
       sessionId, hooks } }`.
     - Calls `harness.execute(harnessRequest, toolExecutor, harnessHooks)`
       (the harness is a registry key `'pi'` | `'claude-code'`, resolved from
       `HarnessRegistry` @ L497 — NOT a CLI binary).

4. **Pi harness — in-process SDK call (GOOD):**
   - `node_modules/groundswell/dist/harnesses/pi-harness.js`:
     - SDK import @ **L91**: `this.sdk = await
       import("@earendil-works/pi-coding-agent")` (a Node ESM **module**,
       not a CLI binary).
     - `execute()` @ **L165**: `this.sdk.createAgentSession({...})` @ L188-195
       (in-process session object).
     - Prompt delivery @ **L245**: `await session.prompt(request.prompt)` —
       a **method argument** on the in-process SDK session. Results arrive
       via `session.subscribe(listener)` @ L242. **No argv.**

5. **Claude-Code harness — in-process SDK call (GOOD):**
   - `node_modules/groundswell/dist/harnesses/claude-code-harness.js`:
     - SDK import @ **L183**: `await import("@anthropic-ai/claude-agent-sdk")`.
     - Prompt delivery @ **L393**: `this.sdk.query({ prompt: request.prompt,
       options: sdkOptions })` + `streamInput()` AsyncGenerator @ L407-419.
       `prompt` is a **JS string field**, not argv. Messages consumed via
       `for await (const m of queryResult)` @ L421.

6. **`createPrompt()` returns a `Prompt` OBJECT** (`factory.js:75`), exposing
   `.buildUserMessage()`. Callers pass structured config, never a raw shell
   string.

### Project call sites — all pass a `Prompt` object programmatically

| File:line | Call | Shape |
|---|---|---|
| `src/agents/prp-executor.ts:311-315` | `createPrompt({ user, responseFormat })` | builds `Prompt` object |
| `src/agents/prp-executor.ts:333` | `withAgentDeadline(this.#coderAgent.prompt(injectedPrompt))` | programmatic |
| `src/agents/prp-executor.ts:639` | `this.#coderAgent.prompt(fixPrompt)` | programmatic |
| `src/agents/prp-generator.ts:718` | `withAgentDeadline(this.#researcherAgent.prompt(prompt))` | programmatic |
| `src/agents/prp-runtime.ts:203` | `this.#executor.execute(prp, prpPath)` | delegates to executor |
| `src/agents/agent-factory.ts:320` | `harness: resolvedHarness()` | harness is a registry KEY (`'pi'`/`'claude-code'`), not a CLI |

### The spawn/exec calls in `src/` — NONE pass LLM prompt text as argv

Every `spawn`/`execSync` in `src/` is tooling/utility work, not on the LLM
prompt-delivery path:

| File:line | Command | Purpose |
|---|---|---|
| `src/tools/bash-mcp.ts:178` | `spawn(command, { shell: true })` | runs a **validation gate** command (one shell string via `/bin/sh -c`) — see note below |
| `src/utils/typecheck-runner.ts:215` | `spawn('npx', ['tsc',...])` | TS typecheck |
| `src/utils/groundswell-linker.ts:429,576,868` | `spawn('npm', ['link'/'list'])` | npm link (dev wiring) |
| `src/utils/validate-groundswell-link.ts:229` | `spawn('npm', ['list','groundswell','--json'])` | verify npm link |
| `src/utils/resource-monitor.ts:258,297` | `execSync('lsof …')`, `execSync('ulimit -n')` | FD/resource monitoring |
| `src/utils/cli-help-executor.ts:166` | `spawn('npm', ['run','dev','--','--help'])` | capture --help text |
| `src/utils/prd-validation-executor.ts:179` | `spawn(...)` | PRD validation script |
| `src/utils/full-test-suite-runner.ts:259` | `spawn('npm', ['run','test:run'])` | run tests |
| `src/utils/single-test-runner.ts:227` | `spawn('npm', ['run','test:run','--',file])` | run one test |
| `src/scripts/validate-groundswell.ts:103,409,428` | `execSync('npm ...')` | CLI validation script |

`grep -rn "pi\.dev\|'-p'\|\"-p\"\|--prompt\b" src/ node_modules/groundswell/dist/`
→ **0 relevant matches.** No prompt-as-flag CLI invocation exists.

### NOTE on `src/tools/bash-mcp.ts` (the file named in the work-item contract)

`bash-mcp.ts:178` runs `spawn(command, { shell: true })`. The `command` here
is a **validation-gate command** (`gate.command`, prp-executor.ts:543), NOT an
LLM prompt. Even so, the audit must verify:
- (a) `gate.command` is never a PRP/PRD prompt string (it's a shell command
  like `npm test`).
- (b) The command is passed as a **single** `spawn(command, {shell:true})`
  string → `/bin/sh -c "<command>"` → the command IS a single argv element.
  A >128KB validation command WOULD hit `MAX_ARG_STRLEN` — but validation
  commands are short shell scripts, never >128KB. The PRD §9.3.3 argv
  concern is specifically about **agent prompts**, which never reach this
  code path (they go through `agent.prompt()` → harness SDK).

The audit therefore CONFIRMS the main path is safe; the test should lock in
the invariant that bash-mcp's `command` is a validation-gate shell command,
and that no agent prompt string is ever routed through `execute_bash` /
`executeBashCommand` as a command argument.

## CONCLUSION

The pipeline is ALREADY compliant with PRD §9.3.3 "Prompt Delivery (no
argv-size limit)". No refactor is required. This subtask is a **defensive
guard + audit**: add a regression test that LOCKS IN the invariant so a
future change cannot reintroduce argv prompt delivery.