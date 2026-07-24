# PRP — P3.M2.T6.S1: Audit agent invocations for argv prompt delivery

---

## Goal

**Feature Goal**: Complete a **defensive guard + audit** for PRD §9.3.3
(h4.10) "Prompt Delivery (no argv-size limit)". PRD §9.3.3 mandates:

> Prompts frequently embed the full PRD and can exceed 128 KB. They MUST be
> delivered to the agent as a programmatic message body (stdin/stream), never
> as an argv string — argv strings are capped by the kernel's
> `MAX_ARG_STRLEN` (131,072 bytes) and fail with a hard `E2BIG` that no
> wrapper can recover from.

This subtask is the **first half** of P3.M2.T6 "Prompt Delivery (No
argv-Size Limit)". It (a) AUDITS every agent-invocation code path
(`src/agents/*` + `src/tools/bash-mcp.ts`) for any pattern that passes a
prompt as a command-line argument, (b) VERIFIES the main path uses
`session.prompt(request.prompt)` programmatically (not argv), (c) REFACTORS
any argv path to stdin/stream (the audit found NONE — so no refactor is
required — see research/01), and (d) ADDS a regression test that locks in
the invariant so a future commit cannot reintroduce argv prompt delivery.

The **second half** (P3.M2.T6.S2 — temp-file cleanup on graceful and
hard-killed exits) is a SEPARATE subtask with its own PRP; this PRP does NOT
touch temp-file cleanup.

**Deliverable** (1 new production file + 1 new test file; **no** existing
source files modified, **no** config, **no** new dependencies, **no** new
modules under `src/agents/`):

1. **`src/agents/prompt-delivery.ts`** (NEW) — a small, dependency-free
   module that (i) pins the `MAX_ARG_STRLEN` constant (131,072 bytes) as a
   named, documented value with a PRD §9.3.3 + kernel reference, (ii)
   exports an `assertPromptNotRoutedViaArgv(prompt: string, label: string):
   void` guard that THROWS a descriptive `Error` if `prompt.length >
   MAX_ARG_STRLEN` (defensive — a prompt that large reaching an argv call
   site would `E2BIG`), and (iii) exports `isPromptDeliveryProgrammatic =
   true` as a frozen boolean sentinel that the test imports to assert the
   runtime wiring is the programmatic harness path. The guard + constant are
   the *named, importable* surface the test asserts against, and they give a
   future maintainer a single, obvious place to read the argv constraint.
2. **`tests/unit/agents/prompt-delivery.test.ts`** (NEW) — the regression
   suite. Two `describe` blocks:
   - **`assertPromptNotRoutedViaArgv`** — unit tests for the guard: a prompt
     under the limit passes silently; a prompt at/over the limit throws with
     a message citing `MAX_ARG_STRLEN` / `E2BIG` / PRD §9.3.3.
   - **`argv prompt delivery — static invariant audit (PRD §9.3.3)`** — the
     AUDIT test. It reads the agent-runtime source files at runtime
     (`src/agents/prp-executor.ts`, `src/agents/prp-generator.ts`,
     `src/agents/prp-runtime.ts`, `src/agents/agent-factory.ts`,
     `src/tools/bash-mcp.ts`) via `readFileSync` and asserts the static
     invariant: NONE of these files contains a `spawn(`/`exec(`/`execSync(`/
     `execFile(` call whose argv references a prompt-named identifier
     (`injectedPrompt`, `fixPrompt`, `prompt`, `request.prompt`,
     `*Prompt`-suffixed variables). This is the test that FAILS LOUDLY the
     moment a future commit reintroduces argv prompt delivery. It uses a
     targeted regex (see Implementation Blueprint) to keep false positives at
     zero (the current codebase has none).

**Why a NEW module instead of editing existing files?** The audit CONFIRMED
the pipeline is already compliant (research/01 §VERDICT: all prompt text
flows `Prompt.buildUserMessage()` → `HarnessRequest.prompt` →
`session.prompt(request.prompt)` / `sdk.query({prompt})` — never argv). There
is nothing to refactor. A new, self-contained `prompt-delivery.ts` is the
minimum surface that (a) documents the constraint in code, (b) gives the
test a concrete import to assert against, and (c) avoids touching the
already-correct agent files (zero risk of regressions in the runtime path).

**Success Definition**:
- The `MAX_ARG_STRLEN` constant (131,072) is pinned in code with a PRD
  §9.3.3 + kernel `fs/exec.c` reference (no magic number).
- `assertPromptNotRoutedViaArgv(prompt, label)` throws for any prompt ≥
  `MAX_ARG_STRLEN` bytes; passes silently otherwise.
- The static-invariant audit test PASSES today (proving the codebase has no
  argv prompt-delivery pattern) and is written so it FAILS if a future
  commit adds one.
- A brief code comment in `prompt-delivery.ts` documents the audit result
  ("verified: all agent prompts flow through `session.prompt()` /
  `sdk.query()`, never argv — see research/01").
- `npm run validate` GREEN.
- `git diff --name-only` shows EXACTLY `src/agents/prompt-delivery.ts` and
  `tests/unit/agents/prompt-delivery.test.ts` (no overlap with any sibling
  PRP: P3.M2.T5.S1 owns `src/core/task-orchestrator.ts`; P3.M2.T6.S2 will
  own temp-file cleanup; this PRP touches ONLY the two new files).

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline (no human in the loop), transitively
future maintainers. This subtask is a **regression guard**: it has no runtime
behavior change for the happy path (the guard is only invoked at points where
a prompt is *about to be* routed, and today no such routing reaches argv).
The persona is "the developer six months from now who adds a new harness or a
new tool and is tempted to shell out with the prompt as an argument" — this
PRP makes that mistake fail loudly in CI instead of silently in production.

**Use Case**: A maintainer adds a new agent harness (e.g. a `codex` harness)
and, copying an old pattern, writes
`spawn('codex', ['--prompt', request.prompt])`. The static-invariant test
fails in CI with a message naming the file + the prompt identifier, blocking
the merge. Separately, the `assertPromptNotRoutedViaArgv` guard catches the
case at runtime if a prompt somehow exceeds 128KB before reaching a (future,
hypothetical) argv path.

**User Journey**: CI runs `npm run validate` → `vitest run` executes
`prompt-delivery.test.ts` → the static-invariant test scans
`src/agents/*.ts` + `src/tools/bash-mcp.ts` → finds NO prompt-as-argv pattern
→ PASSES. If the scan HAD found one, the test would FAIL with
`expect(...).toBe(undefined)`-style assertions naming the offending
file:line-shaped match.

**Pain Points Addressed**: PRD §9.3.3 — the silent, unrecoverable `E2BIG`
death that occurs when a >128KB prompt is passed as an argv string. `E2BIG`
is unrecoverable (the new process never `execve()`s, so no parent-side
try/catch can save the run). Today the pipeline is safe by construction
(programmatic SDK delivery), but nothing ENFORCES that — a single future
refactor could reintroduce the failure mode. This PRP converts "safe by
happenstance" into "safe by test".

---

## Why

- **PRD compliance**: PRD §9.3.3 (h4.10) "Prompt Delivery (no argv-size
  limit)" quotes verbatim:
  > Prompts frequently embed the full PRD and can exceed 128 KB. They MUST
  > be delivered to the agent as a programmatic message body (stdin/stream),
  > never as an argv string — argv strings are capped by the kernel's
  > `MAX_ARG_STRLEN` (131,072 bytes) and fail with a hard `E2BIG` that no
  > wrapper can recover from. Any temp files backing these prompts MUST be
  > cleaned up on both graceful and hard-killed exits…
  This PRP implements the **audit + guard** portion (the "never as an argv
  string" clause). The temp-file-cleanup clause is P3.M2.T6.S2 (out of
  scope here).
- **Work-item contract (LOGIC)** — item-by-item mapping:
  - **(a) Audit all agent invocation code paths in `src/agents/`
    (prp-executor.ts, prp-generator.ts, prp-runtime.ts) and `src/tools/`
    (bash-mcp.ts) for any pattern that passes a prompt as a command-line
    argument.** → research/01 is the audit; the static-invariant test
    (Task 3) re-runs the audit in CI on every commit. AUDIT RESULT: **NO
    argv prompt-delivery pattern exists** (research/01 §VERDICT + §"Project
    call sites" + §"The spawn/exec calls in src/").
  - **(b) Verify the main path uses `session.prompt(request.prompt)`
    programmatically (not argv).** → research/01 §Evidence chain #3-#5:
    `Agent.prompt()` → `HarnessRequest.prompt` →
    `PiHarness.execute()` L245 `await session.prompt(request.prompt)` (an
    in-process SDK method call) — confirmed programmatic. The audit
    documents this in `prompt-delivery.ts`.
  - **(c) If any code path shells out with a prompt as an argument, refactor
    it to use stdin/stream.** → NONE found; no refactor required. (If the
    implementer's audit re-discovers a path, they MUST refactor it to
    stdin/stream and ADD a unit test for the refactored path — but research
    confirms there is none.)
  - **(d) Add a test asserting no agent prompt exceeds argv limits via argv
    delivery.** → Task 2 + Task 3: the `assertPromptNotRoutedViaArgv` guard
    unit tests + the static-invariant audit test.
- **Contract item 2 (INPUT)**: *"No prior subtask output consumed."* → This
  PRP is self-contained. It does not depend on P3.M2.T5.S1's output (that
  PRP owns `task-orchestrator.ts`; this PRP owns two new files and does not
  touch it).
- **Contract item 4 (OUTPUT)**: *"Verified no argv prompt delivery. Consumed
  by P3.M2.T6.S2."* → This PRP delivers the verification (audit + guard +
  test). P3.M2.T6.S2 (temp-file cleanup) consumes the SAME PRD §9.3.3 clause
  but a DIFFERENT sentence (temp-file cleanup on exit); S2 is independent of
  S1's code artifacts except that both implement §9.3.3.
- **Contract item 5 (DOCS)**: *"none — no user-facing/config/API surface
  change."* → Mode A only. JSDoc on `prompt-delivery.ts` documenting the
  audit result, the `MAX_ARG_STRLEN` constant, the guard's throw contract,
  and the PRD §9.3.3 reference. No `.env.example`, no `docs/`, no README.
- **No overlap with sibling PRPs**: P3.M2.T5.S1 (Researching in parallel)
  owns `src/core/task-orchestrator.ts`; P3.M2.T4.S2 (Implementing) owns
  `src/tools/git-mcp.ts` + `src/utils/git-commit.ts`. This PRP touches
  NEITHER — it adds `src/agents/prompt-delivery.ts` (new) and
  `tests/unit/agents/prompt-delivery.test.ts` (new). `src/tools/bash-mcp.ts`
  is READ by the audit test but NOT modified (the audit found its `command`
  is always a validation-gate shell command, never a prompt — research/01
  §"NOTE on src/tools/bash-mcp.ts").

---

## What

One new production file (`src/agents/prompt-delivery.ts`), one new test file
(`tests/unit/agents/prompt-delivery.test.ts`). **No** existing source files
modified, **no** config, **no** new dependencies, **no** new modules under
`src/agents/` beyond `prompt-delivery.ts`, **no** workflow changes, **no**
harness changes, **no** `bash-mcp.ts` edits (read-only consumer in the
audit).

### Success Criteria

- [ ] **`src/agents/prompt-delivery.ts`** (NEW) exports:
      - `export const MAX_ARG_STRLEN = 131_072;` with a JSDoc block citing
        PRD §9.3.3 and Linux kernel `fs/exec.c` (`PAGE_SIZE * 32`), and
        noting the related `E2BIG` error from `execve(2)` (research/02).
      - `export function assertPromptNotRoutedViaArgv(prompt: string, label:
        string): void` — THROWS `new Error(\`[\${label}] Prompt length
        \${prompt.length} exceeds MAX_ARG_STRLEN (\${MAX_ARG_STRLEN}); would
        fail execve with E2BIG (PRD §9.3.3)\`)` when `prompt.length >
        MAX_ARG_STRLEN`; otherwise returns `void` (no-op). JSDoc documents
        the throw contract + the PRD §9.3.3 mandate + the rationale
        (`E2BIG` is unrecoverable).
      - `export const isPromptDeliveryProgrammatic = true as const;` — a
        frozen sentinel the test asserts, documenting that the runtime
        delivers prompts programmatically (see JSDoc: "verified by audit
        P3.M2.T6.S1 — all agent prompts flow through
        `session.prompt(request.prompt)` / `sdk.query({prompt})`, never
        argv; see research/01").
      - A module-level comment block summarizing the audit result
        (research/01 §VERDICT) so a maintainer reading the file immediately
        knows the pipeline is compliant.
- [ ] **`tests/unit/agents/prompt-delivery.test.ts`** (NEW) with two
      `describe` blocks:
      - **`assertPromptNotRoutedViaArgv`**:
        - TEST 1 (passes under limit): a 1KB prompt string →
          `expect(() => assertPromptNotRoutedViaArgv(small, 'unit')).not.toThrow()`.
        - TEST 2 (throws at/over limit): a prompt of exactly
          `MAX_ARG_STRLEN + 1` bytes (build via `'x'.repeat(MAX_ARG_STRLEN +
          1)`) → `expect(() => assertPromptNotRoutedViaArgv(big,
          'unit')).toThrow(/MAX_ARG_STRLEN/)` and
          `...toThrow(/E2BIG/)` and `...toThrow(/PRD §9.3.3/)` (assert the
          message cites all three so the failure is self-documenting).
        - TEST 3 (boundary): a prompt of exactly `MAX_ARG_STRLEN` bytes
          (NOT over) → does NOT throw (off-by-one safety: the limit is
          exclusive — `>` not `>=` — because `MAX_ARG_STRLEN` is the max
          ALLOWED length, so a string of exactly that length is at the edge;
          document the chosen semantics in JSDoc and test the boundary).
      - **`argv prompt delivery — static invariant audit (PRD §9.3.3)`**:
        - SETUP: read the 5 audit-target source files via
          `readFileSync(resolve(process.cwd(), 'src/agents/prp-executor.ts'))`,
          etc. (resolve relative to repo root; vitest runs from repo root —
          confirmed by `vitest.config.ts` + existing tests that import via
          `../../../src/...`). Also read `src/tools/bash-mcp.ts`.
        - DEFINE the argv-spawn regex (see Implementation Blueprint —
          matches `spawn(`/`exec(`/`execSync(`/`execFile(` followed, on the
          same or next few lines, by a prompt-named identifier). Use a regex
          with the `s` (dotAll) flag and a bounded look-ahead so it catches
          multi-line `spawn(\n  varName` calls but does not match across
          unrelated functions.
        - TEST 4 (no prompt-as-argv in agents): for each of
          `prp-executor.ts`, `prp-generator.ts`, `prp-runtime.ts`,
          `agent-factory.ts` → `expect(scanForPromptArgv(source)).toEqual([])`
          (empty = no match = invariant holds).
        - TEST 5 (bash-mcp command is never a prompt):
          `src/tools/bash-mcp.ts` — assert `scanForPromptArgv(source)` is
          empty (bash-mcp's `spawn(command, {shell:true})` `command` is a
          validation-gate shell command, not an LLM prompt — research/01
          §"NOTE on bash-mcp"). This locks in that `gate.command` (not a
          prompt) is the only thing routed to `spawn`.
        - TEST 6 (sentinel): `expect(isPromptDeliveryProgrammatic).toBe(true)`
          — trivially true today, but documents the audit conclusion in an
          executable assertion.
        - TEST 7 (self-test the scanner): a contrived string
          `"spawn('pi', ['--prompt', injectedPrompt])"` →
          `expect(scanForPromptArgv(contrived)).not.toEqual([])` — proves the
          scanner WOULD catch a real violation (guards against the scanner
          being too loose and always returning `[]`).
- [ ] `npm run validate` GREEN.
- [ ] `git diff --name-only` shows EXACTLY `src/agents/prompt-delivery.ts`
      and `tests/unit/agents/prompt-delivery.test.ts`.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the exact
audit result (research/01 §VERDICT: NO argv path — programmatic delivery
confirmed, with the end-to-end evidence chain `Agent.prompt()` →
`HarnessRequest.prompt` → `session.prompt(request.prompt)` at
groundswell pi-harness.js L245); the exact argv-spawn call sites that DO
exist in `src/` and why none of them carry prompt text (research/01
§"Project call sites" + §"spawn/exec calls in src/" table); the exact
`MAX_ARG_STRLEN` value + authoritative kernel/man-page URLs (research/02 §1-
2); the exact agent-prompt variable names to scan for
(`injectedPrompt`, `fixPrompt`, `prompt`, `request.prompt`) pinned by
research/01 §"Project call sites"; the exact test conventions to follow
(`vi.mock('node:child_process')` + `vi.mocked` bindings + SETUP/EXECUTE/VERIFY
style — research via `tests/unit/tools/bash-mcp.test.ts`); and the explicit
out-of-scope list (P3.M2.T5.S1's task-orchestrator.ts, P3.M2.T6.S2's
temp-file cleanup, the read-only `bash-mcp.ts`).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: https://man7.org/linux/man-pages/man2/execve.2.html#ERRORS
  why: authoritative source for E2BIG (the unrecoverable error when argv exceeds limits).
        Pinned in research/02 §2. Cited in the MAX_ARG_STRLEN JSDoc.

- url: https://github.com/torvalds/linux/blob/master/fs/exec.c
  why: kernel source defining MAX_ARG_STRLEN = PAGE_SIZE * 32 = 131072. Pinned in
        research/02 §1. Cited in the constant's JSDoc as the provenance of 131_072.

- url: https://docs.anthropic.com/en/docs/claude-code/sdk
  why: confirms Claude Agent SDK delivers prompts as message-body content via query()/streamInput(),
        never argv. Supports the audit conclusion (research/01 §Evidence chain #5).

- file: node_modules/groundswell/dist/harnesses/pi-harness.js
  why: THE line that proves programmatic delivery: L245 `await session.prompt(request.prompt)` —
        an in-process SDK method call, NOT argv. research/01 §Evidence chain #4. The audit's
        "verify the main path" contract item (LOGIC b) is satisfied by this line. Read-only —
        this is a published dependency; do NOT modify.

- file: node_modules/groundswell/dist/core/agent.js
  why: Agent.prompt() L187 → executePrompt() L458 builds `userMessage = prompt.buildUserMessage()`
        (a JS string) → HarnessRequest.prompt L598-607. Proves the prompt is a JS string handed to
        the harness, never a shell argv. research/01 §Evidence chain #3.

- file: src/agents/prp-executor.ts
  why: AUDIT TARGET #1. L311-315 createPrompt({user:...}) builds a Prompt object; L333
        withAgentDeadline(this.#coderAgent.prompt(injectedPrompt)) passes it programmatically;
        L616/639 same pattern with fixPrompt. ZERO spawn/exec calls in this file (research/01
        §"confirm NO spawn/exec in agents dir" → NONE). The audit test reads this file and
        asserts no prompt-named identifier appears in a spawn/exec argv position.

- file: src/agents/prp-generator.ts
  why: AUDIT TARGET #2. L667 createPRPBlueprintPrompt(...) → L718
        withAgentDeadline(this.#researcherAgent.prompt(prompt)). Programmatic. ZERO spawn/exec.

- file: src/agents/prp-runtime.ts
  why: AUDIT TARGET #3. L203 this.#executor.execute(prp, prpPath) delegates to PRPExecutor
        (which is the programmatic prompt path). ZERO spawn/exec.

- file: src/agents/agent-factory.ts
  why: AUDIT TARGET #4. L320 harness: resolvedHarness() — harness is a registry KEY ('pi' |
        'claude-code'), L153 type AgentHarness = 'pi' | 'claude-code'. NOT a CLI binary path.
        ZERO spawn/exec. Confirms no argv shell-out is wired into agent construction.

- file: src/tools/bash-mcp.ts
  why: AUDIT TARGET #5. L178 spawn(command, { shell: true }). The `command` here is a
        VALIDATION-GATE command (gate.command — see prp-executor.ts L543/553), NEVER an LLM
        prompt. research/01 §"NOTE on bash-mcp". The audit test reads this file and asserts
        the spawn argv does not reference a prompt-named identifier. READ-ONLY — do NOT modify
        (P3.M2.T2.S1/T2 own the watchdog flags; this PRP only READS bash-mcp.ts in the audit).

- file: tests/unit/tools/bash-mcp.test.ts
  why: THE test-convention reference. L17-19 vi.mock('node:child_process', () => ({ spawn:
        vi.fn() })); L36 import { spawn } from 'node:child_process'; L48 const mockSpawn =
        vi.mocked(spawn). SETUP/EXECUTE/VERIFY comment-block style throughout. The new test
        file follows the SAME import/mock/style conventions (vitest, describe/it/expect,
        relative imports via ../../../src/...). NOTE: the new prompt-delivery.test.ts does NOT
        mock child_process (it does a static FILE SCAN, not a runtime spawn mock) — but it
        follows the same describe/it/expect + SETUP/EXECUTE/VERIFY style.

- file: vitest.config.ts
  why: confirms vitest runs from the repo root (so `resolve(process.cwd(), 'src/agents/...')`
        in the audit test resolves correctly). Existing tests import via ../../../src/... which
        corroborates the root-relative layout.

- file: plan/008_15504f60a0ef/P3M2T6S1/research/01_prompt_delivery_audit.md
  why: THE AUDIT. §VERDICT + §Evidence chain prove programmatic delivery end-to-end;
        §"Project call sites" lists every agent.prompt() call with file:line; §"spawn/exec calls
        in src/" tabulates every spawn/exec with its (non-prompt) purpose; §"NOTE on bash-mcp"
        explains why bash-mcp.ts is safe. The implementer MUST read this before writing the
        module comment + the audit test.

- file: plan/008_15504f60a0ef/P3M2T6S1/research/02_max_arg_strlen_external.md
  why: pins MAX_ARG_STRLEN = 131072 (kernel fs/exec.c), E2BIG (execve(2) man page ERRORS),
        ARG_MAX distinction, and the 3 testing patterns considered (Pattern A static scan chosen).
        The constant value + the "why a defensive test is warranted" rationale come from here.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/
  agent-factory.ts        # AUDIT TARGET (read-only) — harness is a registry key, no spawn
  prp-executor.ts         # AUDIT TARGET (read-only) — agent.prompt(injectedPrompt) programmatic
  prp-generator.ts        # AUDIT TARGET (read-only) — agent.prompt(prompt) programmatic
  prp-runtime.ts          # AUDIT TARGET (read-only) — delegates to PRPExecutor
  prompts/                # (not audited — prompt-builders, no invocation)
  prompts.ts              # (not audited — prompt templates)
  commit-message-agent.ts # (not audited — out of argv-prompt scope)
src/tools/
  bash-mcp.ts             # AUDIT TARGET (read-only) — spawn(command,{shell:true}), command=gate.command
tests/unit/agents/
  (no prompt-delivery.test.ts yet — NEW file this PRP)
tests/unit/tools/
  bash-mcp.test.ts        # READ-ONLY reference for test conventions (vi.mock child_process, SETUP/EXECUTE/VERIFY)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/agents/
  prompt-delivery.ts      # NEW — MAX_ARG_STRLEN constant + assertPromptNotRoutedViaArgv guard +
                          #   isPromptDeliveryProgrammatic sentinel + audit-result module comment.
                          #   No runtime behavior change for the happy path; documents + enforces
                          #   PRD §9.3.3.
tests/unit/agents/
  prompt-delivery.test.ts # NEW — (1) unit tests for assertPromptNotRoutedViaArgv (under/at/over limit);
                          #   (2) static-invariant audit that scans src/agents/*.ts + src/tools/bash-mcp.ts
                          #   for any prompt-as-argv spawn/exec pattern and asserts none exists; (3) sentinel
                          #   assertion; (4) self-test proving the scanner catches a real violation.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (research/01 §VERDICT): The pipeline is ALREADY compliant. Do NOT "fix" anything in
// src/agents/* or src/tools/bash-mcp.ts — the audit found NO argv prompt-delivery path. Any
// edit to those files is OUT OF SCOPE and risks regressions in the runtime path. This PRP adds
// a NEW module + a NEW test; it modifies ZERO existing source files.

// CRITICAL (MAX_ARG_STRLEN value): the constant is EXACTLY 131_072 (PAGE_SIZE * 32, PAGE_SIZE=4096).
// research/02 §1 pins this from kernel fs/exec.c. Do NOT round to 128*1024 in a way that changes
// the value — 128 * 1024 = 131072, which IS correct, but write it as 131_072 (or 128 * 1024 with a
// comment) so the provenance is obvious. The test builds an over-limit string with
// 'x'.repeat(MAX_ARG_STRLEN + 1) — import the SAME constant, do not redeclare a local copy.

// CRITICAL (E2BIG is unrecoverable): the guard's whole purpose is that execve() E2BIG cannot be
// caught/recovered by any wrapper (the new process never starts). JSDoc MUST state this so a future
// maintainer understands why the guard THROWS instead of, e.g., truncating or falling back.

// GOTCHA (audit-test file reads): the static-invariant test reads source files via readFileSync at
// test runtime. vitest runs from the repo root (vitest.config.ts + existing ../../../src/... imports
// confirm this), so resolve(process.cwd(), 'src/agents/prp-executor.ts') resolves correctly. Do NOT
// use import.meta.url path gymnastics — process.cwd() is stable under vitest. If you want extra safety,
// resolve relative to the test file's dirname via fileURLToPath(import.meta.url), but process.cwd() is
// the established convention in this repo's tests.

// GOTCHA (scanner regex precision): the argv-spawn scanner must catch BOTH single-line
// (`spawn('pi', ['--prompt', injectedPrompt])`) and multi-line (`spawn(\n  'pi',\n  ['--prompt', prompt]\n)`)
// calls where a prompt-named identifier is in the argv. Use a regex with these properties:
//   - matches one of: spawn( | exec( | execSync( | execFile( | spawnSync(
//   - followed (within ~200 chars, dotAll) by one of the prompt identifiers:
//     injectedPrompt | fixPrompt | request.prompt | \w+Prompt | 'prompt' | "prompt"
//   - the prompt identifier must be in an ARGUMENT position (after the function paren), not in a
//     comment or a string that is itself the command name. A pragmatic heuristic: match the spawn
//   call open-paren, then look ahead for the identifier BEFORE the matching close — but a full paren
//   matcher is overkill. A bounded look-ahead (\spawn\([^)]{0,400}?\b(injectedPrompt|fixPrompt|...)\b)
//   is sufficient: it matches a spawn call whose arguments (up to the first close-paren) contain a
//   prompt identifier. This has ZERO false positives on the current codebase (verified: src/agents/*
//   have NO spawn calls at all; bash-mcp.ts has one spawn whose command is the bare `command` param).
// Self-test TEST 7 (research: Task 3) guards against the scanner being too loose.

// GOTCHA (scanner must NOT match comments): the regex should not fire on a JSDoc line like
// "* spawn the agent" or "// we spawn a child". Anchor on the function-call form
// (`\bspawn\s*\(`) to avoid matching prose. The `\b` + `\s*\(` anchor is sufficient.

// GOTCHA (bash-mcp.ts is SAFE but in scope): bash-mcp.ts L178 spawn(command, { shell: true }) — the
// `command` is the validation-gate command (gate.command), NOT a prompt. The audit test asserts the
// scanner returns [] for bash-mcp.ts too (TEST 5). If a future commit changed bash-mcp to accept a
// prompt as the command, the scanner would catch it ONLY if the identifier is prompt-named — so the
// scanner's identifier list must include the obvious prompt names (research/01 §"Project call sites":
// injectedPrompt, fixPrompt, prompt, request.prompt, and the \w+Prompt suffix catch-all).

// GOTCHA (no groundswell mocking needed): the static-invariant test does NOT mock groundswell — it
// reads the project's OWN source files (src/agents/*.ts, src/tools/bash-mcp.ts), not groundswell's.
// groundswell is a published dependency; its prompt-delivery path (pi-harness.js L245) is documented
// in research/01 as the proof of programmatic delivery but is NOT under test here (out of scope — we
// guard OUR code, not the dependency's).

// GOTCHA (do not overlap sibling PRPs): P3.M2.T5.S1 (parallel, Researching) owns
// src/core/task-orchestrator.ts — do NOT touch it. P3.M2.T6.S2 (Planned) will own temp-file cleanup —
// do NOT add cleanup code in this PRP. P3.M2.T4.S2 (Implementing) owns git-mcp.ts + git-commit.ts —
// unrelated. This PRP's git diff is EXACTLY two new files.

// GOTCHA (no new dependencies): prompt-delivery.ts uses only node:fs (in the test) and the built-in
// string length — no imports from groundswell, no new npm packages. Keep it dependency-free so the
// guard can never itself be blocked by a missing dep.
```

---

## Implementation Blueprint

### Data models and structure

No domain data models. The module exports one constant, one function, one
sentinel — all leaf-level, no state.

```typescript
/**
 * (Module comment — Mode A) PRD §9.3.3 "Prompt Delivery (no argv-size limit)".
 *
 * AUDIT RESULT (P3.M2.T6.S1): the pipeline is COMPLIANT. Every agent prompt
 * flows `Prompt.buildUserMessage()` → `HarnessRequest.prompt` → the in-process
 * harness SDK — Pi: `session.prompt(request.prompt)` (groundswell
 * pi-harness.js L245); Claude-Code: `sdk.query({prompt})` + `streamInput()`
 * (claude-code-harness.js L393). NO code path in src/agents/* or
 * src/tools/bash-mcp.ts passes an LLM prompt as a command-line argv string.
 * See plan/008_15504f60a0ef/P3M2T6S1/research/01_prompt_delivery_audit.md.
 *
 * This module pins the argv constraint as a named constant + guard so the
 * invariant is (a) documented in code and (b) enforced by the regression
 * test in tests/unit/agents/prompt-delivery.test.ts.
 */

/**
 * Linux kernel per-argument-string limit: `PAGE_SIZE * 32` = 4096 * 32 =
 * 131_072 bytes (128 KiB). A single argv/envp string longer than this causes
 * `execve(2)` to fail with the unrecoverable `E2BIG` (the new process never
 * starts, so no parent-side wrapper can recover). PRD §9.3.3.
 *
 * @see https://github.com/torvalds/linux/blob/master/fs/exec.c (MAX_ARG_STRLEN)
 * @see https://man7.org/linux/man-pages/man2/execve.2.html#ERRORS (E2BIG)
 */
export const MAX_ARG_STRLEN = 131_072;

/**
 * Asserts that `prompt` is short enough to (hypothetically) survive argv
 * delivery. THROWS if `prompt.length > MAX_ARG_STRLEN`.
 *
 * PRD §9.3.3 mandates prompts be delivered as a programmatic message body,
 * never argv. This guard is a DEFENSIVE backstop: if a future code path
 * accidentally routes a prompt toward argv, this throws a self-documenting
 * error BEFORE the unrecoverable `E2BIG`. The happy path (programmatic
 * delivery) never invokes this guard with an oversize prompt.
 *
 * @param prompt - The prompt string about to be delivered.
 * @param label  - A short label (e.g. 'CoderAgent') for the error message.
 * @throws {Error} when `prompt.length > MAX_ARG_STRLEN` (message cites
 *   MAX_ARG_STRLEN, E2BIG, and PRD §9.3.3).
 */
export function assertPromptNotRoutedViaArgv(
  prompt: string,
  label: string
): void {
  if (prompt.length > MAX_ARG_STRLEN) {
    throw new Error(
      `[${label}] Prompt length ${prompt.length} exceeds MAX_ARG_STRLEN ` +
        `(${MAX_ARG_STRLEN}); would fail execve with E2BIG ` +
        `(PRD §9.3.3 — prompts must be delivered as a programmatic message ` +
        `body, never as an argv string).`
    );
  }
}

/**
 * Frozen sentinel asserting the runtime delivers prompts programmatically.
 *
 * Verified by audit P3.M2.T6.S1: all agent prompts flow through
 * `session.prompt(request.prompt)` (Pi harness) / `sdk.query({prompt})`
 * (Claude-Code harness) — in-process SDK method calls, never argv. The
 * regression test imports this to assert the conclusion executably.
 */
export const isPromptDeliveryProgrammatic = true as const;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/agents/prompt-delivery.ts
  - IMPLEMENT: MAX_ARG_STRLEN constant (131_072), assertPromptNotRoutedViaArgv guard,
    isPromptDeliveryProgrammatic sentinel, module-comment audit summary (see Data models block).
  - NAMING: UPPER_SNAKE for the constant, camelCase for the function, camelCase boolean sentinel.
  - DEPENDENCIES: none (no imports — pure leaf module; only the TEST uses node:fs).
  - PLACEMENT: src/agents/ (alongside the other agent-support modules; it documents/guards the
    agent prompt-delivery contract).
  - GOTCHA: keep the module dependency-free (no groundswell, no node:fs import in the production
    module — only the test reads files). This ensures the guard can never be blocked by a missing dep.

Task 2: CREATE tests/unit/agents/prompt-delivery.test.ts — guard unit tests
  - IMPORT: from '../../../src/agents/prompt-delivery.js' — MAX_ARG_STRLEN,
    assertPromptNotRoutedViaArgv, isPromptDeliveryProgrammatic.
  - IMPORT: import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
  - describe('assertPromptNotRoutedViaArgv', () => { ... }) with:
    * TEST 1 (under limit): const small = 'x'.repeat(1024);
      expect(() => assertPromptNotRoutedViaArgv(small, 'unit')).not.toThrow().
    * TEST 2 (over limit): const big = 'x'.repeat(MAX_ARG_STRLEN + 1);
      expect(() => assertPromptNotRoutedViaArgv(big, 'unit')).toThrow();
      const err = ... catch ...; expect(err.message).toMatch(/MAX_ARG_STRLEN/);
      expect(err.message).toMatch(/E2BIG/); expect(err.message).toMatch(/PRD §9.3.3/).
      (Or use multiple .toThrow(/.../) assertions on separate lines — vitest supports regex throws.)
    * TEST 3 (boundary — exactly at limit does NOT throw): const edge = 'x'.repeat(MAX_ARG_STRLEN);
      expect(() => assertPromptNotRoutedViaArgv(edge, 'unit')).not.toThrow().
      (Documents the > vs >= semantics: MAX_ARG_STRLEN is the max ALLOWED length, so a string of
      exactly that length is permitted; the guard uses strict >.)
  - FOLLOW pattern: tests/unit/tools/bash-mcp.test.ts SETUP/EXECUTE/VERIFY comment-block style.

Task 3: CREATE tests/unit/agents/prompt-delivery.test.ts — static-invariant audit
  - DEFINE a scanner helper at the top of the describe (or above it):
        const PROMPT_IDENTIFIERS = [
          'injectedPrompt', 'fixPrompt', 'request\\.prompt',
          '\\w+Prompt',       // catch-all: anyXxxPrompt
        ];
        const ARGV_SPAWN_RE = new RegExp(
          String.raw`\b(?:spawn|exec|execSync|execFile|spawnSync)\s*\(` +
            String.raw`[^)]{0,400}?\b(?:${PROMPT_IDENTIFIERS.join('|')})\b`,
          's'  // dotAll so [^)] spans newlines
        );
        function scanForPromptArgv(source: string): string[] {
          // returns the list of matching substrings (empty = invariant holds)
          const matches: string[] = [];
          let m: RegExpExecArray | null;
          const re = new RegExp(ARGV_SPAWN_RE); // fresh state per call
          while ((m = re.exec(source)) !== null) {
            matches.push(m[0].replace(/\s+/g, ' ').slice(0, 120));
            if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
          }
          return matches;
        }
    NOTE: the [^)]{0,400}? is bounded so the look-ahead cannot run across an entire file (performance +
    false-positive control). The \b word boundaries prevent matching 'prompt' inside a larger word.
    The `s` flag lets [^)] match newlines (multi-line spawn calls).
  - describe('argv prompt delivery — static invariant audit (PRD §9.3.3)', () => { ... }) with:
    * SETUP: const readSrc = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
    * TEST 4 (agents have no prompt-as-argv): for each file in
      ['src/agents/prp-executor.ts', 'src/agents/prp-generator.ts', 'src/agents/prp-runtime.ts',
       'src/agents/agent-factory.ts']:
        expect(scanForPromptArgv(readSrc(file)), `${file} must not pass a prompt as argv`).toEqual([]).
    * TEST 5 (bash-mcp command is never a prompt):
        expect(scanForPromptArgv(readSrc('src/tools/bash-mcp.ts')),
          'bash-mcp spawn command must be a validation-gate command, not a prompt').toEqual([]).
    * TEST 6 (sentinel): expect(isPromptDeliveryProgrammatic).toBe(true).
    * TEST 7 (scanner self-test — catches a real violation):
        const contrived = "spawn('pi', ['--prompt', injectedPrompt])";
        expect(scanForPromptArgv(contrived)).not.toEqual([]);  // proves the scanner is not a no-op
  - GOTCHA (false positives): verify TEST 4/5 PASS today (they must — research/01 confirms no matches).
    If TEST 4/5 FAIL, the scanner regex is too loose; tighten the identifier list or the bounded
    look-ahead. Run `npm test -- prompt-delivery` to confirm before committing.
  - GOTCHA (process.cwd()): vitest runs from repo root (vitest.config.ts). resolve(process.cwd(),
    'src/agents/prp-executor.ts') resolves to <repo>/src/agents/prp-executor.ts. Confirmed by existing
    tests importing via ../../../src/...

Task 4: JSDoc (Mode A — rides with the work)
  - prompt-delivery.ts: module comment (audit summary + research/01 ref), MAX_ARG_STRLEN JSDoc
    (kernel + man-page URLs), assertPromptNotRoutedViaArgv JSDoc (throw contract + PRD §9.3.3 + E2BIG
    rationale), isPromptDeliveryProgrammatic JSDoc (audit conclusion).
  - prompt-delivery.test.ts: describe-block doc comments citing PRD §9.3.3 + research/01 for each
    invariant tested.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the static-invariant scanner. Matches a spawn/exec call whose argv
// (text between the open paren and the first close paren, up to 400 chars,
// across newlines via the `s` flag) contains a prompt-named identifier.

const PROMPT_IDENTIFIERS = [
  'injectedPrompt',   // prp-executor.ts L311
  'fixPrompt',        // prp-executor.ts L616
  'request\\.prompt', // groundswell HarnessRequest.prompt (defensive — if a future harness shells out)
  '\\w+Prompt',       // catch-all: anyXxxPrompt (research/01 §"Project call sites" naming)
];
const ARGV_SPAWN_RE = new RegExp(
  String.raw`\b(?:spawn|exec|execSync|execFile|spawnSync)\s*\([^)]{0,400}?\b(?:${PROMPT_IDENTIFIERS.join('|')})\b`,
  's'
);

// PATTERN: guard with a self-documenting throw (cites the constant, the error code, the PRD clause).
export function assertPromptNotRoutedViaArgv(prompt: string, label: string): void {
  if (prompt.length > MAX_ARG_STRLEN) {
    throw new Error(
      `[${label}] Prompt length ${prompt.length} exceeds MAX_ARG_STRLEN (${MAX_ARG_STRLEN}); ` +
      `would fail execve with E2BIG (PRD §9.3.3 — prompts must be delivered as a programmatic ` +
      `message body, never as an argv string).`
    );
  }
}

// PATTERN: the audit test reads source files at runtime and asserts no prompt-as-argv match.
//   (TEST 4)  for each agent file:  expect(scanForPromptArgv(readSrc(f))).toEqual([]);
//   (TEST 5)  bash-mcp.ts:           expect(scanForPromptArgv(readSrc('src/tools/bash-mcp.ts'))).toEqual([]);
//   (TEST 7)  contrived violation:   expect(scanForPromptArgv("spawn('pi',['--prompt',injectedPrompt])")).not.toEqual([]);

// GOTCHA: the scanner uses [^)]{0,400}? — a bounded, non-greedy look-ahead bounded by the FIRST
// close paren. This means it will NOT match a prompt identifier that appears AFTER a nested close
// paren in the same call (e.g. spawn(foo(bar), prompt)). That is ACCEPTABLE: such a call shape is
// not a realistic prompt-as-argv pattern (the prompt would be a late positional arg, before the
// close paren). If the codebase later adopts such a shape, broaden the regex — but do not over-engineer now.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — this PRP adds a self-contained module + test. It does NOT:
  - modify DATABASE / CONFIG / ROUTES / CLI / harness / workflow / any existing source file.
  - add environment variables.
  - add npm dependencies.
  - change any user-facing, config, or API surface (contract item 5: DOCS = none).
The ONLY consumers of prompt-delivery.ts are:
  - tests/unit/agents/prompt-delivery.test.ts (this PRP).
  - (future, optional) any agent file that wishes to defensively call assertPromptNotRoutedViaArgv
    before delivery — but this PRP does NOT wire such calls (the audit found no argv path, so there
    is no call site to guard). Wiring the guard into a real call site is out of scope and would
    require modifying an existing file (forbidden by the zero-modification scope).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/agents/prompt-delivery.ts
npm run lint         # eslint . --ext .ts (project-wide; the new file must pass)
npm run typecheck    # tsc --noEmit -p tsconfig.build.json
npm run format:check # prettier --check (run `npm run format` if it complains)

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new guard + audit
npm run test:run -- prompt-delivery

# Full suite (ensure no regression — this PRP adds files only, but run to be safe)
npm run test:run

# Expected: All tests pass. The 7 new tests (3 guard + 4 audit) must be GREEN.
# If TEST 4/5 (static scan) FAIL, the scanner regex is too loose — tighten it (see Gotchas).
# If TEST 7 (scanner self-test) FAIL, the scanner is too strict — broaden the identifier list.
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this PRP adds a leaf module + a static-scan test. There is no runtime
# integration to validate (no existing call site invokes the guard; the audit is a source scan).
# The "integration" is: npm run validate (lint + format + typecheck + test) all GREEN.

npm run validate
# Expected: GREEN. This is the gate.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual audit re-verification (optional, for confidence): re-run the exact grep the scout
# subagent ran, to independently confirm zero argv prompt-delivery in src/.
grep -rnE "\b(spawn|exec|execSync|execFile|spawnSync)\s*\(" src/agents/ src/tools/bash-mcp.ts
# Expected: bash-mcp.ts:178 spawn(command, { shell: true }) is the ONLY match, and `command`
# there is a validation-gate command (gate.command), NOT a prompt. The agents/ dir has ZERO matches.

# Confirm no prompt-named identifier flows into any spawn/exec argv:
grep -rnE "\b(spawn|exec|execSync|execFile|spawnSync)\s*\([^)]{0,400}\b(injectedPrompt|fixPrompt|prompt|Prompt)\b" src/
# Expected: ZERO matches (this is the invariant the regression test encodes).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run).
- [ ] All 7 new tests pass: `npm run test:run -- prompt-delivery`.
- [ ] No linting errors: `npm run lint`.
- [ ] No type errors: `npm run typecheck`.
- [ ] No formatting issues: `npm run format:check`.
- [ ] `git diff --name-only` shows EXACTLY
      `src/agents/prompt-delivery.ts` and `tests/unit/agents/prompt-delivery.test.ts`.

### Feature Validation

- [ ] `MAX_ARG_STRLEN` constant == 131_072 with kernel + man-page URLs in JSDoc.
- [ ] `assertPromptNotRoutedViaArgv` throws for `prompt.length > MAX_ARG_STRLEN`; passes otherwise.
- [ ] Throw message cites `MAX_ARG_STRLEN`, `E2BIG`, and `PRD §9.3.3`.
- [ ] Static-invariant audit test PASSES today (TEST 4 + TEST 5) — proving no argv prompt delivery.
- [ ] Scanner self-test (TEST 7) proves the scanner catches a real violation.
- [ ] Audit result documented in `prompt-delivery.ts` module comment (research/01 §VERDICT).
- [ ] No existing source file modified (zero-overlap with sibling PRPs).

### Code Quality Validation

- [ ] Follows existing test conventions (vitest, describe/it/expect, SETUP/EXECUTE/VERIFY style —
      mirroring `tests/unit/tools/bash-mcp.test.ts`).
- [ ] File placement: `src/agents/prompt-delivery.ts` (alongside agent-support modules);
      `tests/unit/agents/prompt-delivery.test.ts` (alongside other agent tests).
- [ ] Anti-patterns avoided (see Anti-Patterns below): no editing existing runtime files, no
      groundswell mocking, no new dependencies, no over-engineered paren matcher.
- [ ] Dependency-free production module (only the test imports `node:fs`).

### Documentation & Deployment

- [ ] JSDoc on all three exports (constant, function, sentinel) with PRD §9.3.3 + research refs.
- [ ] Module comment summarizes the audit result.
- [ ] No environment variables added (contract item 5: DOCS = none).
- [ ] No user-facing / config / API surface change.

---

## Anti-Patterns to Avoid

- ❌ **Don't modify any existing source file.** The audit found the pipeline ALREADY compliant;
  editing `src/agents/*` or `src/tools/bash-mcp.ts` is out of scope and risks runtime regressions.
  This PRP adds TWO new files and nothing else.
- ❌ **Don't mock groundswell.** The static-invariant test reads the PROJECT's source files, not
  groundswell's. Groundswell's prompt-delivery path (pi-harness.js L245) is the documented PROOF
  of programmatic delivery (research/01) but is NOT under test — we guard our code, not the
  dependency's.
- ❌ **Don't add the guard to a real call site.** There is no argv call site to guard (the audit
  found none). Wiring `assertPromptNotRoutedViaArgv` into `prp-executor.ts` would require editing
  that file (forbidden) and would be dead code (the prompt is delivered programmatically, never via
  argv, so the guard would never throw). The guard exists as a named, importable contract + a unit
  test — that is its entire purpose.
- ❌ **Don't write a full paren-matching scanner.** A bounded `[^)]{0,400}?` look-ahead is
  sufficient (zero false positives today, catches realistic prompt-as-argv shapes). A real
  AST/paren matcher is over-engineering and adds a dependency. The self-test (TEST 7) proves the
  scanner is not a no-op.
- ❌ **Don't round MAX_ARG_STRLEN to a different value.** It is EXACTLY 131_072 (kernel
  `PAGE_SIZE * 32`). Write it as `131_072` (or `128 * 1024` with a comment) — do not approximate.
- ❌ **Don't catch/truncate in the guard.** `E2BIG` is unrecoverable; the guard MUST throw (not
  truncate, not warn-and-continue). Truncating a prompt silently corrupts the agent run.
- ❌ **Don't overlap sibling PRPs.** P3.M2.T5.S1 owns `task-orchestrator.ts`; P3.M2.T6.S2 owns
  temp-file cleanup; P3.M2.T4.S2 owns git-mcp.ts/git-commit.ts. This PRP's `git diff --name-only`
  is EXACTLY two new files.
- ❌ **Don't skip the scanner self-test (TEST 7).** Without it, a too-loose regex (e.g. one that
  never matches) would make TEST 4/5 vacuously pass. TEST 7 proves the scanner CAN match a known
  violation, locking in that TEST 4/5 are meaningful.