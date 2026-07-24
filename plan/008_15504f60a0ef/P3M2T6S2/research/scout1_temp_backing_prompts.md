# Scout: Does any temp file back an LLM agent PROMPT today?

**Scope:** `src/agents/`, `src/tools/`, `src/core/`, `src/utils/`, `src/scripts/`, `src/workflows/`, `src/commands/`, and the deployed groundswell harnesses in `node_modules/groundswell/dist/harnesses/`.
**Question (PRD §9.3.3):** Does ANY temp file back agent-prompt delivery, or is delivery 100% programmatic (no temp backing)?
**Answer:** Delivery is **100% programmatic**. No temp file backs any agent prompt. The S2 strategy is **PREVENTIVE** (registry to *prevent* a future regression), not TARGETED.

---

## Files Retrieved

1. `node_modules/groundswell/dist/harnesses/pi-harness.js` (L245, L348) — Pi harness prompt-delivery site.
2. `node_modules/groundswell/dist/harnesses/claude-code-harness.js` (L393–410, L558–572) — Claude-Code harness prompt-delivery site.
3. `src/agents/prompt-delivery.ts` (L1–88) — S1 audit pin + defensive `assertPromptNotRoutedViaArgv` guard + `isPromptDeliveryProgrammatic = true`.
4. `src/agents/prp-executor.ts` (L302–334, L610–645) — builds a `Prompt` via `createPrompt()` then calls `this.#coderAgent.prompt(prompt)`; retry path uses `retryAgentPrompt(() => ...prompt(fixPrompt), …)`.
5. `src/agents/prp-generator.ts` (L408, L824, L718) — `writeFile` = PRP cache metadata + PRP markdown artifact; prompt delivered via `this.#researcherAgent.prompt(prompt)`.
6. `src/agents/prp-runtime.ts` (L281, L290, L294) — `writeFile` = validation-results.json / execution-summary.md / artifacts-list.json.
7. `src/tools/bash-mcp.ts` (L1–330) — `spawn(command, { shell: true, stdio: ['ignore','pipe','pipe'] })`; no temp file, stdin ignored.
8. `src/core/session-utils.ts` (L95–195, L1084–1089) — `atomicWrite()` temp+rename for tasks.json/PRP/PRD-snapshot; `writeFile(snapshotPath)` for PRD snapshot.
9. `src/utils/metrics-collector.ts` (L720–740) — `writeFile(tempPath, JSON.stringify(snapshot))` then rename = metrics export.
10. `src/utils/cache-manager.ts` (L369–377) — atomic rename-then-unlink for cache entry removal.
11. `src/scripts/validate-groundswell.ts` (L309–320, L426) — `mkdtempSync` + `writeFileSync` of an `auth.json` test fixture and a downloaded tarball.
12. Other write sites (all NON-prompt, see table): `src/workflows/prp-pipeline.ts:1557/1606/1716`, `src/commands/process-code.command.ts:120`, `src/core/session-manager.ts:670/1008`, `src/utils/package-json-updater.ts:315`, `src/utils/build-logger.ts:265/288`, `src/utils/groundswell-linker.ts:1098/1131`, `src/utils/verify-groundswell-version.ts:958/1010`, `src/utils/validate-groundswell-link.ts:394`.

---

## Harnesses: prompt delivery is purely programmatic (NO temp file)

**Grep on both harness files** for `writeFile|writeFileSync|mkdtemp|mkdtempSync|os.tmpdir|tmpdir|tempPath|tempFile|\.tmp|fs\.|spawn` → **NO matches in either file.** Neither harness imports `node:fs` at all.

- **Pi (`pi-harness.js:245`):**
  ```js
  await session.prompt(request.prompt); // resolves when the turn/loop is processed
  ```
  In-process SDK method call. The same pattern repeats for streaming at L348 (`.prompt(request.prompt)`). The prompt string lives only in `HarnessRequest.prompt` (an in-memory object).

- **Claude-Code (`claude-code-harness.js:393`):**
  ```js
  const queryResult = this.sdk.query({
      prompt: isContinuation ? "" : request.prompt,
      options: sdkOptions,
  });
  // ... for continuation, history + new message flow via queryResult.streamInput(...)
  ```
  `request.prompt` is passed as the `prompt` field of the SDK options object, and for continuations the new user message flows through `queryResult.streamInput()` (L400–410, L564–572) as an async-generator yield — a programmatic stream, not a file.

**Conclusion:** Both groundswell harnesses deliver the prompt as a programmatic message body (in-process SDK call / stream). No temp file is created, written, or referenced anywhere on the prompt path.

---

## Temp-file write sites — per-site classification

| # | Site | What is written | PROMPT? | Backs delivery? |
|---|------|-----------------|---------|-----------------|
| 1 | `groundswell/.../pi-harness.js:245` | (none — SDK call) | n/a | n/a |
| 2 | `groundswell/.../claude-code-harness.js:393` | (none — SDK call) | n/a | n/a |
| 3 | `src/agents/prp-executor.ts:311–333` | `createPrompt()` → in-memory Prompt object → `#coderAgent.prompt(prompt)` | n/a (in-memory) | **No — programmatic** |
| 4 | `src/agents/prp-executor.ts:616–639` | `createPrompt()` fix prompt → `retryAgentPrompt(() => #coderAgent.prompt(fixPrompt))` | n/a (in-memory) | **No — programmatic; retry re-calls prompt(), no file** |
| 5 | `src/agents/prp-generator.ts:408` | PRP **cache metadata** JSON | No | No |
| 6 | `src/agents/prp-generator.ts:824` | **PRP markdown artifact** (`prps/<task>.md`) | No | No |
| 7 | `src/agents/prp-runtime.ts:281/290/294` | validation-results.json / execution-summary.md / artifacts-list.json | No | No |
| 8 | `src/tools/bash-mcp.ts:240` | `spawn(command,{shell:true})`, `stdio:['ignore','pipe','pipe']`; command is a **validation shell command** (e.g. `npm test`) | No (not a prompt; stdin ignored) | No |
| 9 | `src/core/session-utils.ts:114–145` | `atomicWrite` temp+rename for **tasks.json / PRP** files | No | No |
| 10 | `src/core/session-utils.ts:1089` | **PRD snapshot** markdown | No | No |
| 11 | `src/core/session-manager.ts:670` | `parent_session.txt` (session id) | No | No |
| 12 | `src/core/session-manager.ts:1008` | recovery JSON | No | No |
| 13 | `src/utils/metrics-collector.ts:722–729` | **metrics snapshot** JSON → temp+rename | No | No |
| 14 | `src/utils/cache-manager.ts:369–375` | atomic rename-then-unlink for **cache entry removal** | No | No |
| 15 | `src/scripts/validate-groundswell.ts:309–320` | `mkdtempSync` + `writeFileSync(auth.json)` test fixture | No (auth fixture) | No |
| 16 | `src/scripts/validate-groundswell.ts:426` | `mkdtempSync` + curl/tar of published tarball | No | No |
| 17 | `src/workflows/prp-pipeline.ts:1557/1606/1716` | ERROR_REPORT.md / report files | No | No |
| 18 | `src/commands/process-code.command.ts:120` | processed **code output** | No | No |
| 19 | `src/utils/package-json-updater.ts:315` | package.json | No | No |
| 20 | `src/utils/build-logger.ts:265/288` | build log markdown | No | No |
| 21 | `src/utils/groundswell-linker.ts:1098/1131` | README | No | No |
| 22 | `src/utils/verify-groundswell-version.ts:958/1010` | verification artifact | No | No |
| 23 | `src/utils/validate-groundswell-link.ts:394` | test file content | No | No |
| 24 | `src/tools/filesystem-mcp.ts:364` | MCP `writeFile` tool (agent-authored files) | No | No |
| 25 | `src/agents/prompts/prp-blueprint-prompt.ts:210` | variable named `writeFileBanner` (a string banner in a prompt template) | n/a — name only, no FS call | No |

**Every** temp-file / `writeFile` / `mkdtemp` site writes either (a) an agent **output/artifact** (PRP, report, summary, PRD snapshot), (b) **state** (tasks.json, recovery, metrics, cache), or (c) a **test fixture** (auth.json, tarball). **None** writes an LLM prompt to back delivery.

---

## Retry-loop behavior (PRD §9.3.3 "re-written on every attempt")

The only retry path for prompts is `retryAgentPrompt(() => this.#coderAgent.prompt(fixPrompt), …)` in `prp-executor.ts:639` (and the execute path at L333). Because the prompt is an **in-memory `Prompt` object** re-passed to `agent.prompt()` on every attempt, there is no temp file to (re-)write. The "re-write on every attempt" clause of §9.3.3 is satisfied **vacuously** — there is no temp file backing the retry loop. A PREVENTIVE registry should pin this invariant.

---

## VERDICT

**No temp file backs any agent prompt today. Prompt delivery is 100% programmatic:**

```
Prompt.buildUserMessage()  →  HarnessRequest.prompt (in-memory string)
   →  Pi:      session.prompt(request.prompt)              [pi-harness.js:245]
   →  Claude:  sdk.query({prompt}) + streamInput()         [claude-code-harness.js:393]
```

No `writeFile`/`mkdtemp`/`tmpdir`/`.tmp`/`fs.*`/`spawn` on the prompt path in any agent, tool, harness, or util. The 24 other temp-file write sites all target outputs/state/fixtures, never a prompt.

**Strategy for S2:** **PREVENTIVE** — implement a registry/invariant guard that *prevents* any future code path from backing a prompt with a temp file (and asserts the existing programmatic invariant), rather than a TARGETED fix to a named file:line (there is no such file:line). The existing `src/agents/prompt-delivery.ts` (from S1) already pins the argv half of §9.3.3; S2 should extend that module to pin the "no temp file backs a prompt" half (e.g., a frozen sentinel `isPromptDeliveryProgrammatic = true` plus a regression test asserting no `writeFile`/`mkdtemp` symbol appears on the `Agent.prompt → harness` call path).

---

## Residual risks

- The preventive registry must not over-match: many legitimate `writeFile` sites (artifacts, state, MCP filesystem tool, test fixtures) must remain legal. The registry/test should be scoped to the **prompt delivery path** (the `Agent.prompt` → harness call chain), not a blanket ban on `fs.writeFile`.
- The harnesses live in `node_modules/groundswell/dist` (a published dependency). If a future groundswell version introduces temp-file-backed prompt delivery, the registry (in-repo) would NOT catch it. Recommend pinning a harness-level integration test that asserts `session.prompt`/`sdk.query` receive the prompt via their argument/stream API and that no temp file is created in `os.tmpdir()` during a prompt call.
- `scripts/validate-groundswell.ts` (L309, L426) is the only code that calls `mkdtemp`/`tmpdir` at all in the repo; it is a validation script, not the runtime prompt path. Confirm S2's preventive test excludes `src/scripts/**` to avoid false positives.