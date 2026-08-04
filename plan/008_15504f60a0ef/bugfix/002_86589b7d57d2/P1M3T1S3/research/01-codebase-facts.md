# Research Notes — P1.M3.T1.S3 (Update stagecoach system prompt)

> Source of truth for the PRP. Every claim below is verified against the working tree
> (HEAD) and the architecture contract. Captured via direct reads (no delegation needed —
> the surface is small and fully self-contained in 2 files + 1 architecture doc).

## 1. The deliverable surface (the ONLY 2 files S4 touches)

### 1a. `src/agents/commit-message-agent.ts` — the const to rewrite

The `COMMIT_MESSAGE_SYSTEM` const lives at **lines 66–77** (a backtick template literal). Current text:

```ts
const COMMIT_MESSAGE_SYSTEM = `You generate concise git commit messages from staged diffs.

Follow Conventional Commits (https://www.conventionalcommits.org/):
- Type prefix: feat, fix, refactor, docs, chore, test, perf, build, ci.
- Subject line in imperative mood, ≤72 characters, no trailing period.
- Optional blank line + body explaining WHY (not WHAT — the diff shows what).
- If a work-item id appears in changed paths (e.g. P3.M1.T3.S1), reference it in the subject.

HARD RULES:
- Output ONLY the commit message (subject + optional body). No explanation.
- No markdown fences, no leading/trailing whitespace, no preamble.
- Do NOT include "[PRP Auto]", "Co-Authored-By", or any trailer — the caller adds those.
- If the diff is empty or whitespace-only, output the single word "skip".`;
```

**Two instructions to REMOVE** (the Conventional-Commit mandate + the P-id-in-subject rule):
1. The whole `Follow Conventional Commits …` block, specifically the `- Type prefix: feat, fix, …` line.
2. The `- If a work-item id appears in changed paths (e.g. P3.M1.T3.S1), reference it in the subject.` line.

**HARD RULES block to KEEP verbatim** (lines 73–77): output-only, no fences/preamble, no `[PRP Auto]`/`Co-Authored-By`/trailer, `skip` for empty diff. The caller (`formatCommitMessage`, S2) adds the trailer + (in task-prefix mode) the position prefix.

### 1b. Stale prose in the SAME file that describes the const (must track the change)

- **Line 8** (module `@remarks`): `* descriptive conventional-commit messages from a staged diff (PRD §5.1` → reword to `* descriptive commit messages from a staged diff (PRD §5.1` (the agent no longer emits a Conventional-Commit type).
- **Lines 27–31** (module `@remarks`, the caller-wrap description):
  ```
  * The agent emits ONLY the commit message (subject + optional body). The caller
  * (generateCommitMessage in src/utils/git-commit.ts) wraps the output with
  * the [PRP Auto] prefix and Co-Authored-By trailer via formatCommitMessage.
  * The system prompt forbids the agent from emitting the prefix/trailer.
  ```
  → `[PRP Auto]` becomes stale after **S2** (P1.M3.T1.S2) removes the banner from `formatCommitMessage`. Reword to describe the post-S2 wrap: `… wraps the output via formatCommitMessage, which layers the standardized task-prefix (or emits plain per PRD §5.1) and appends the Co-Authored-By trailer.` (Comment-only; true in the post-S2 end-state S4 lands into.)
- **Lines 56–64** (`COMMIT_MESSAGE_SYSTEM` JSDoc): says `System prompt instructing the agent to emit a conventional-commit message.` + `Mirrors the Conventional Commits 1.0.0 spec (https://www.conventionalcommits.org/en/v1.0.0/).` → rewrite to `System prompt instructing the agent to emit a plain descriptive imperative summary.` and drop the Conventional-Commits-spec mirror. (Directly documents the const being rewritten → MUST track it.)

### 1c. `tests/unit/agents/commit-message-agent.test.ts` — the assertion to update

The prompt-content test is **lines 127–143** (`it('should set a system prompt instructing conventional-commit output', …)`). Current asserts:

```ts
const cfg = mockCreateAgent.mock.calls[0][0] as { system: string };
expect(cfg.system).toContain('Conventional Commits');   // REMOVE — no longer Conventional-Commits
expect(cfg.system).toContain('imperative');             // KEEP (imperative mood stays)
// MUST forbid prefix/trailer so formatCommitMessage does not double-wrap.
expect(cfg.system).toContain('[PRP Auto]');             // KEEP (the "do NOT include [PRP Auto]" hard rule stays)
expect(cfg.system).toContain('Co-Authored-By');         // KEEP (the "do NOT include Co-Authored-By" hard rule stays)
```

**New assertion contract (per item MOCKING point 5):**
- MUST NO LONGER require a Conventional-Commit type → drop the `toContain('Conventional Commits')` assertion (and assert the prompt does NOT mandate a type prefix, e.g. `expect(cfg.system).not.toMatch(/type prefix|feat, fix|Conventional Commits/i)`).
- MUST NOT instruct referencing the P-id in the subject → add `expect(cfg.system).not.toMatch(/reference it in the subject|reference the.*id/i)`.
- MUST STILL forbid emitting `[PRP Auto]`/`Co-Authored-By` → keep `toContain('[PRP Auto]')` + `toContain('Co-Authored-By')` (the hard-rule text still mentions these tokens, so the assertion still passes — the hard rule is unchanged).
- KEEP `toContain('imperative')`.

The test's other 9 assertions (persona/role, name, maxTokens, enableReflection, enableCache, mcps undefined, stateless, model/harness/env) are UNAFFECTED — they assert config fields, not prompt text.

## 2. The contract this realizes

### 2a. Architecture doc — `architecture/bug-003-commit-format.md` §"Stagecoach prompt" (verbatim)

> `COMMIT_MESSAGE_SYSTEM` currently instructs Conventional Commits ("Type prefix: feat, fix…";
> "If a work-item id appears in changed paths, reference it in the subject"). The §5.1 example
> `1.2.1.1: add createDeferredPromise utility and utils barrel` has NO type/scope — the
> task-prefix carries categorization. The prompt must be relaxed so the agent emits a **plain
> descriptive imperative summary** (no Conventional-Commit type, no `(P-id)` scope); the
> task-prefix is layered on by the caller. The agent's existing "Do NOT include [PRP Auto]/
> Co-Authored-By" hard rule stays valid.

§"S4 — stagecoach prompt update" (verbatim):

> `commit-message-agent.ts:69-77`: change to instruct a plain descriptive imperative summary,
> no Conventional-Commit type and no `(P-id)` scope (the task-prefix now encodes position). Keep
> "Output ONLY the commit message", the "skip" empty-diff rule, and the "no banner/trailer" rule.

### 2b. PRD §5.1 — the example subject the agent must now produce

`1.2.1.1: add createDeferredPromise utility and utils barrel` — the **descriptive** part is
`add createDeferredPromise utility and utils barrel`: a plain imperative summary, NO `feat:` /
`fix:` type prefix, NO `(scope)`. The caller (S2 `formatCommitMessage` + S3 `smartCommit`) layers
the `1.2.1.1:` task-prefix. In **plain mode** (`PRP_COMMIT_FORMAT=plain`) the caller uses the
agent's summary **verbatim**. So the agent MUST emit a clean descriptive imperative subject in
BOTH modes.

## 3. The caller flow (why the hard rules stay)

`smartCommit` (src/utils/git-commit.ts:~480–525) → on the `generateMessage:true` path calls
`generateCommitMessage(diff)` (the stagecoach boundary, :155–200) which returns the agent's
**trimmed descriptive message only** (no prefix/trailer — the function throws on `'skip'`/empty).
The caller then wraps it via `formatCommitMessage(generated)` (S2 rework: task-prefix or plain
subject + `Co-Authored-By` trailer). So:

- The agent MUST NOT emit `[PRP Auto]`/`Co-Authored-By` (caller adds the trailer; S2 adds the
  prefix). KEEP this hard rule. (S2 ALSO strips a stray `[PRP Auto] ` as defense-in-depth, but the
  agent should still be told not to emit it.)
- The agent MUST emit `'skip'` for an empty diff (the `generateCommitMessage` boundary treats
  `'skip'`/empty as a generation failure → AgentError → retry → fallback). KEEP this hard rule.

## 4. Out-of-scope (hard boundaries — do NOT touch in S4)

- `src/utils/git-commit.ts` — S2 owns it (`formatCommitMessage` rework + its own JSDoc + the
  `generateCommitMessage` JSDoc example `'feat(api): add endpoint'` at :~190, which S2 updates).
  NOTE: that example is in S2's file, NOT S4's. S4 must not edit git-commit.ts.
- `src/config/constants.ts` — S1 (DONE): `getPrpCommitFormat`/`PrpCommitFormat`.
- `tests/unit/utils/git-commit.test.ts` — S2 owns it.
- `tests/integration/smart-commit.test.ts` — S3 (P1.M3.T2.S1) wires `position` through `smartCommit`.
- `docs/CONFIGURATION.md` — S1 (DONE).
- The `createCommitMessageAgent()` factory body (lines 103–122): NO change (persona/role/
  maxTokens/reflection/cache/stateless all stay). S4 changes ONLY the `system:` field's source
  const + the descriptive JSDoc around it.

## 5. Sibling references that are COMMENT-ONLY (safe, no edit needed)

- `tests/unit/agents/cleanup-agent.test.ts:9,12,26` — references `commit-message-agent` in prose
  only; does NOT assert on its prompt. UNAFFECTED.
- `tests/unit/protected-files.test.ts:31–34` — mocks `createCommitMessageAgent` as a no-op for the
  import chain; does NOT assert on the prompt. UNAFFECTED.

## 6. Validation commands (verified against package.json + vitest.config.ts)

- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json`
- `npm run lint` → `eslint . --ext .ts`
- `npm run format:check` → `prettier --check "**/*.{ts,js,json,md,yml,yaml}"`
- `npm run fix` → `lint:fix + format` (run BEFORE format:check — JSDoc reflow)
- `npx vitest run tests/unit/agents/commit-message-agent.test.ts` — the EDITED file (gate).
- `vitest.config.ts` enforces **100% coverage thresholds** (branches/functions/lines). S4 changes
  NO executable code (const text + JSDoc + assertions), so coverage is UNAFFECTED — but the gate
  still applies to the file globally.
- Do NOT run full `npm run test:run` — pre-existing RED (178 failures, BUG-004 / P1.M4 scope).

## 7. Confidence drivers

- 2 files, ~15 lines of actual code change (a const string + 1 test block), zero executable-logic
  change. Lowest-risk slice in the BUG-003 set.
- The exact text to remove (Conventional-Commits block + P-id-in-subject line) and the exact hard
  rules to keep are enumerated verbatim above.
- The architecture doc prescribes the S4 outcome explicitly (§"Stagecoach prompt" + §"S4").
- No conflict with the parallel S2: disjoint files (commit-message-agent.ts vs git-commit.ts). The
  only shared concern is the stale `[PRP Auto]` prose at commit-message-agent.ts:30 — S4 owns that
  line (it's in S4's file) and rewords it to the post-S2 wording.