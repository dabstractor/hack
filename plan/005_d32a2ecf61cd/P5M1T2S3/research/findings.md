# Research Findings — P5.M1.T2.S3 (issue_feedback injection)

## 1. Target files (verified present, exact lines)

### `src/agents/prompts/prp-blueprint-prompt.ts`
- **`constructUserPrompt(task, backlog, codebasePath?)`** — builds the USER message. Already demonstrates the EXACT
  conditional-section pattern to mirror for feedback: the `codebaseSection` string is `''` when `codebasePath` is
  undefined/empty, else a templated block. Inject the feedback block the SAME way (build `feedbackSection` string,
  splice into the returned template). The returned template ends with `---\n\n${PRP_BLUEPRINT_PROMPT}`.
- **`createPRPBlueprintPrompt(task, backlog, codebasePath?): Prompt<PRPDocument>`** — public export (~L250). Wraps
  `createPrompt({ user: constructUserPrompt(...), system: PRP_BLUEPRINT_PROMPT, responseFormat, enableReflection })`.
  Add optional 4th param `issueFeedback?: string`, thread into `constructUserPrompt`.

### `src/agents/prp-generator.ts`
- **`PRPGenerator.generate(task, backlog): Promise<PRPDocument>`** (~L588). Add optional 3rd param
  `issueFeedback?: string`; pass to `createPRPBlueprintPrompt(task, backlog, process.cwd(), issueFeedback)` at ~L617.
- **Cache-read block** (~L573-609): `if (!this.#noCache) { ... #isCacheRecent → #loadCachedPRP → hash match → HIT }`.
  `#computeTaskHash` keys on `id/title/context_scope` ONLY — it does NOT include `issueFeedback`. ⇒ A feedback-aware
  re-research would serve the STALE cached PRP if the file still exists. **Decision:** bypass cache READ when
  `issueFeedback` is provided and non-empty (`if (!this.#noCache && !issueFeedback)`). Cache WRITE stays as-is
  (overwrites with the feedback-aware PRP). This keeps the no-feedback path byte-identical (work-item constraint:
  "the normal path is unchanged") and is belt-and-suspenders vs S4 deleting the stale PRP.

## 2. The `<issue_feedback>` block does NOT exist in the source `PRP_BLUEPRINT_PROMPT`
- `grep -n "issue_feedback\|Issue Feedback\|Re-planning" src/agents/prompts.ts` → **NO matches**.
- The system HEREDOC `PRP_BLUEPRINT_PROMPT` (src/agents/prompts.ts ~L157) does NOT contain an `<issue_feedback>`
  placeholder. ⇒ S3 injects a NEW block into the USER prompt (via `constructUserPrompt`), per the work item
  ("constructUserPrompt builds the user message; inject into the user prompt"). Do NOT modify the HEREDOC.

## 3. Real-world block precedent (mirror this structure)
The orchestrator's own outer task wrapper already injects an `## Issue Feedback (Re-planning)` section +
`<issue_feedback>…</issue_feedback>` block with CRITICAL framing ("You MUST address the feedback..."). Use the same
delimited-block convention + framing so the Researcher re-researches with the gap addressed.

## 4. Call-site safety (4th optional param is backward-compatible)
- `createPRPBlueprintPrompt` is called positionally with ≤3 args EVERYWHERE (src + all tests incl.
  `agent-context-injection.test.ts`, `prp-blueprint-agent.test.ts`, `agents.test.ts`, `prp-generator-integration.test.ts`).
  Adding an OPTIONAL 4th param changes no existing call. The `index.ts` re-export is signature-less (`export {}`),
  auto-adapts.
- `PRPGenerator.generate` is called with 2 args at `research-queue.ts:230` and `:338`. Adding optional 3rd param keeps
  both valid (S4 will add the feedback-aware call).

## 5. Test blast-radius (must update in the SAME commit — implementation_notes.md §7)
- **`tests/unit/agents/prompts/prp-blueprint-prompt.test.ts`** — imports via `#/prompts/index.js` alias
  (`#` → `src/agents`, vitest.config.ts resolve.alias). Pattern: SETUP (grab subtask from `mockBacklog`) → EXECUTE
  (`createPRPBlueprintPrompt(task, mockBacklog, ...)`) → VERIFY (`expect(prompt.user).toContain(...)`).
  ADD: 2 tests — (a) feedback block present when provided, (b) absent when omitted/empty.
- **`tests/unit/agents/prp-generator.test.ts`** — mocks `createPRPBlueprintPrompt` (`vi.mock` + `as any`).
  - **BREAKS at line 219**: `expect(mockCreatePRPBlueprintPrompt).toHaveBeenCalledWith(task, backlog, expect.stringContaining('hacky-hack'))`
    — vitest `toHaveBeenCalledWith` is strict on arg COUNT. After S3, `generate()` calls with 4 args (4th `undefined`
    when no feedback). ⇒ UPDATE to add `, undefined` as 4th expected arg (the no-feedback test). Then ADD a new test:
    `generate(task, backlog, feedback)` → assert `toHaveBeenCalledWith(task, backlog, expect.stringContaining('hacky-hack'), feedback)`.
  - Note the mock returns `{ system: 'system', user: 'user', responseFormat: {} }` — fine; we assert call args only.
- **`tests/integration/prp-generator-integration.test.ts:332`** — does NOT assert call args (comment: "we verify the
  result is correct"); only checks `result.taskId`. ⇒ NOT affected. Confirmed safe.

## 6. Validation commands (verified from package.json)
- `npm run validate` = `npm run lint && npm run format:check && npm run typecheck`
  (eslint . --ext .ts + prettier --check + tsc --noEmit -p tsconfig.build.json).
- `npm run test:run` = `vitest run`.
- If prettier --check fails on new JSDoc/strings: `npm run format` (writes) then re-validate.

## 7. ESM import gotcha (repo-wide)
`.ts` source files import with `.js` specifiers; tests use `.js` for src imports OR the `#/` vitest alias.
WRONG: `from '../../src/agents/prompts/prp-blueprint-prompt'`; RIGHT: `from '../../src/agents/prompts/prp-blueprint-prompt.js'`.

## 8. Scope guardrails (do NOT touch)
- `src/core/task-orchestrator.ts` — S4 (the issue→Planned + re-research flow bounded by getIssueRetryMax()).
- `src/agents/prp-executor.ts`, `src/agents/prp-runtime.ts` — S2 (ExecutionResult.outcome/issueMessage plumbing).
- `src/config/constants.ts` — S1 (ISSUE_RETRY_MAX, parallel).
- `src/agents/prompts.ts` HEREDOC `PRP_BLUEPRINT_PROMPT` — UNCHANGED (inject via constructUserPrompt, not the HEREDOC).
- The actual reading of `result.issueMessage` + writing `issue_feedback.md` + deleting the stale PRP = S4. S3 only
  provides the param plumbing + the prompt block.

## 9. S2 dependency (parallel-execution contract)
S2 (`plan/005_d32a2ecf61cd/P5M1T2S2/PRP.md`) extends `ExecutionResult` with `outcome?: 'success'|'fail'|'issue'` +
`issueMessage?: string`. S4 reads those and passes the feedback STRING into `generate(task, backlog, feedback)`.
S3 consumes NOTHING from S2 at the type level — S3 is purely the prompt/generator plumbing that S4 will call.
Zero file overlap with S2 (S2 edits prp-executor.ts + prp-runtime.ts; S3 edits prp-blueprint-prompt.ts + prp-generator.ts).
