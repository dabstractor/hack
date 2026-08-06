# Session 011 — §9.9 Implementation Status (research surfaces)

Exact files, line ranges, and test patterns the §9.9 implementation touches.
All line numbers verified against the working tree at session-creation time.

## A. REQ-G1 — prompt layer (gate-construction guardrails)

The runtime prompts live in **`src/agents/prompts.ts`** (NOT the legacy
`PROMPTS.md` — that file is the ported-from reference doc; `src/agents/` is
never re-imported from it at runtime). Two prompt bodies need new rules:

### A.1 Blueprint prompt — `PRP_BLUEPRINT_PROMPT` (Researcher, §6.2)

- File: `src/agents/prompts.ts`
- The gate-construction rules block is the list beginning at **line 285**
  (`**Validation Gates**: … CRITICAL RULES for gate commands:`), bullets at
  lines **286–292**. It already has:
  - L286 "ONE command per gate."
  - "Prefer standard tooling …"
  - "NEVER write `grep` patterns with mixed single/double quotes."
  - "NEVER embed heredocs, `for` loops, or multi-line scripts …"
  - L290 "If a scope boundary check is needed … express it as … a success
    criterion the coder follows rather than a shell gate."  ← partial G1.2
- **Missing (to add):**
  - **G1.1** — forbid negative file/directory existence gates explicitly:
    `test ! -f|-e|-d <path>`, `! test -f|-e|-d <path>`, `[ ! -f|-e|-d ]`,
    `! [ -f|-e|-d ]`. State file existence is owned by the task graph.
  - **G1.2** — strengthen the existing scope-boundary rule: a "do not
    create/modify file X" or "do not import Y" constraint MUST be a Success
    Criterion OR a `manual: true` Level-4 gate, never a shell gate.
  - **G1.3** — cleanup / throwaway-deletion is a cleanup instruction, not a
    shell gate; a "the artifact is gone" check MUST be `manual: true`.
  - **G1.5** — negated *content* gates (`! grep -q …`) are permitted ONLY on
    the task's own deliverable when the asserted absence is permanent; never
    about another task's file.
- The existing gate rules (one command per gate, prefer standard tooling, no
  mixed-quote grep, no heredocs) remain in force.

### A.2 Builder prompt — `PRP_BUILDER_PROMPT` (Coder, §6.3)

- File: `src/agents/prompts.ts`
- `PRP_BUILDER_PROMPT` spans **lines 675–744**.
  - `## FORBIDDEN ACTIONS — Critical-File Deletion Protection (PRD §5.1)` at
    **L680** (the no-`rm`/`git rm` of `PRD.md`/`PRP.md`/`plan/` rule).
  - Step **4. Progressive Validation** at **L728–736** ("Execute the level
    validation system from the PRP" / "Each level must pass before proceeding").
  - `**Failure Protocol**` at **L744**.
- **Missing (to add):**
  - **G1.4** — instruct the Coder Agent **not** to delete a throwaway/spike
    artifact during its own turn (cleanup happens after validation), because
    gates are re-executed as a batch against the terminal filesystem state and
    a post-delete tree would fail the artifact's existence gates.
  - A short note that the executor re-runs every gate as a batch on the final
    state (so gates must be monotonic terminal-state assertions).

## B. REQ-G2 — runtime layer (executor hardening)

### B.1 `PRPExecutor.#runValidationGates()`

- File: `src/agents/prp-executor.ts`
- Method `async #runValidationGates(prp: PRPDocument): Promise<ValidationGateResult[]>`
  starts at **line 518**.
  - Manual / null-command skip block: **L528** (`if (gate.manual ||
    gate.command === null) { … skipped: true, success: true … continue; }`).
    ← The neutralization branch mirrors this exact shape.
  - `BashMCP.execute_bash(...)` call: **L548** (`cwd: process.cwd()`).
  - "Stop sequential execution on first failure": **L568**.
- **Missing (to add):** before the `BashMCP` call (after the manual/null skip,
  for a non-null command), test the command with the new pure detector
  `isNegatedFileExistenceGate(gate.command)`. If it returns `true`, push a
  result **identical in shape to the manual-skip result** —
  `{ success: true, command: gate.command, exitCode: null, skipped: true,
  timedOut: false, stdout: '', stderr: '', … }` — and `continue` WITHOUT
  invoking BashMCP. Log the neutralization reason citing §9.9
  ("non-monotonic negative-existence gate neutralized — file existence is
  owned by the task graph / is a cleanup step, not a terminal-state assertion
  (§9.9)"). Skipped gates already count as passed in `execute()`
  (`allPassed = validationResults.every(r => r.success || r.skipped)`), so no
  change to the pass/fail aggregation is needed.

### B.2 The pure detector (new, exported)

- A pure function `isNegatedFileExistenceGate(command: string): boolean`.
  Conservative (G2.3): match ONLY the unambiguous negated-existence forms —
  - leading `!` before `test`/`[`: `! test -f|-e|-d X`, `! [ -f|-e|-d X ]`
  - inner `!` inside `test`/`[`: `test ! -f|-e|-d X`, `[ ! -f|-e|-d X ]`
  - It MUST return **false** for: negated *content* checks (`! grep -q …`)
    (G2.2), positive existence/content checks, and anything ambiguous
    (`test foo`, `grep …`, `npm test`). When in doubt, execute normally.
- Recommended placement: co-located export in `src/agents/prp-executor.ts`
  (sole consumer) OR a tiny `src/agents/gate-semantics.ts` module. Either is
  acceptable; the contract is the function signature + behavior table below.

  | command                       | expected |
  | ----------------------------- | -------- |
  | `! test -f src/hooks/index.ts`| `true`   |
  | `test ! -f x`                 | `true`   |
  | `! [ -e x ]`                  | `true`   |
  | `[ ! -d x ]`                  | `true`   |
  | `! grep -q TODO src/x.ts`     | `false`  |
  | `test -f x`                   | `false`  |
  | `npm test`                    | `false`  |
  | `grep -q foo x`               | `false`  |

### B.3 `ValidationGate` model (NO schema change needed)

- File: `src/core/models.ts`, `interface ValidationGate` at **L1271**,
  `ValidationGateSchema` at **~L1326**. The `manual: boolean` and
  `command: string | null` fields already exist and the `manual ?? command ===
  null` transform (L1372) already maps a null command to manual. The
  neutralization is purely a *runtime* decision in the executor — it does not
  mutate the PRP or the schema. **Do not edit the model.**

## C. Test surfaces (implicit-TDD)

- **Prompt text assertions:** `tests/unit/agents/prompts.test.ts` imports
  `PRP_BLUEPRINT_PROMPT` / `PRP_BUILDER_PROMPT` (L14–15) and asserts
  `expect(typeof …).toBe('string')` / `length > 100`. Add `toContain(...)`
  assertions for the new G1.1/G1.3/G1.4/G1.5 forbidden-form wording (one test
  per prompt body).
- **Detector unit tests:** add a `describe('isNegatedFileExistenceGate')`
  block exercising the table in §B.2 (true / false / ambiguous cases).
- **Executor integration tests:** `tests/unit/agents/prp-executor.test.ts`
  mocks `BashMCP` via `mockExecuteBash = vi.fn()` and the class via
  `mockBashMCP.mockImplementation(() => ({ execute_bash: mockExecuteBash }))`
  (see `beforeEach`, ~L120). The PRP factory is `createMockPRPDocument(taskId)`
  (~L92). Add:
  - A PRP whose Level-N gate is `! test -f src/hooks/index.ts`: assert the run
    succeeds (`outcome:'success'`), that gate's result is `skipped:true` /
    `success:true` / `exitCode:null`, and `mockExecuteBash` is NOT called for
    that command (called only for the other gates). (G2.1)
  - A PRP with a negated *content* gate `! grep -q TODO src/x.ts`: assert
    `mockExecuteBash` IS called for it (it executes normally). (G2.2)
  - An ambiguous gate (`test foo`) executes normally. (G2.3)

## D. Mode B documentation sync (changeset-level)

After the code lands, sync the cross-cutting docs that mention gate semantics
so they do not contradict §9.9:
- `README.md`, `docs/CONFIGURATION.md`, `docs/ARCHITECTURE.md` (gate/PRP
  semantics sections) — verify no claim that gates are a rigid mechanical
  contract survives; add the monotonicity + neutralization contract.
- `PROMPTS.md` (legacy reference doc, PRD §6 / §9.3.4 source) — mirror the
  new G1.x forbidden-form rules into its "Validation Gates" section so the
  ported-from reference does not drift from `src/agents/prompts.ts`.
- `.env.example` — no change expected (no new env var); verify and note.

## E. Agent boundaries & guardrails (carry into PRPs)

- **Implementation agents** (REQ-G2) may edit `src/` and `tests/` ONLY; they
  MUST NOT touch `plan/`, `PRD.md`, or `tasks.json` (PRD §5.2).
- **Prompt edits** (REQ-G1) edit `src/agents/prompts.ts` (the runtime
  prompts); they MUST NOT edit `PRD.md`.
- §9.9 makes no change to `PRD.md` (human-owned), `tasks.json` (pipeline
  state), `prd_snapshot.md`, or any config file.
