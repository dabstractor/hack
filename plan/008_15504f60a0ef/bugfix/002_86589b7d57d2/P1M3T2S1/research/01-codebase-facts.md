# Research Notes — P1.M3.T2.S1 (smartCommit `position` wiring)

> Verified against the working tree at research time. S1 (config) + S2 (formatter/helpers)
> are BOTH COMPLETE; S3 (this item) wires `position` through `SmartCommitOptions` + the
> call sites + tests. S4 (stagecoach prompt) is parallel + file-disjoint.

## 1. Upstream slices (the INPUT contract)

### S1 — config (COMPLETE) — `src/config/constants.ts`
- `DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const` — line **723**.
- `export type PrpCommitFormat = 'task-prefix' | 'plain';` — line **736**.
- `export function getPrpCommitFormat(): PrpCommitFormat` — line **760** (case-SENSITIVE; unknown/empty → default `'task-prefix'`; SINGLE process.env read site).

### S2 — formatter + helpers (COMPLETE) — `src/utils/git-commit.ts`
- `export interface ItemPosition { phase; milestone; task; subtask? }` — exported (above formatCommitMessage).
- `export function parseItemPosition(id): ItemPosition | null` — `P1.M2.T1.S1`→`{1,2,1,1}`; `P1.M2.T1`→`{1,2,1}`; non-match→`null`.
- `export function buildTaskPrefix(pos): string` — `{1,2,1,1}`→`'1.2.1.1'`; `{1,2,1}`→`'1.2.1'` (elision).
- `export function formatCommitMessage(message, position?: ItemPosition | null)` — line **214**. Strips `[PRP Auto] ` (defense-in-depth); branches: `position && getPrpCommitFormat()==='task-prefix'` → `${buildTaskPrefix(pos)}: ${subject}`; else plain subject; ALWAYS appends `\n\nCo-Authored-By: Claude <noreply@anthropic.com>`.
- The `position` param is OPTIONAL → the 3 single-arg wrap sites compile unchanged TODAY (emit plain until S3 threads it).

## 2. The three `smartCommit` → `formatCommitMessage` wrap sites (verified CURRENT line numbers)
**NOTE:** the contract/PRD quoted pre-S2 line numbers `:489/:496/:500`. After S2 the lines shifted; the CURRENT sites are:
- **:626** — generateMessage HAPPY path: `formattedMessage = formatCommitMessage(generated);`
- **:637-639** — generateMessage FALLBACK path (multiline): `formattedMessage = formatCommitMessage(\n          buildFallbackCommitMessage(genError)\n        );`
- **:643** — DEFAULT path (option omitted / `generateMessage!==true`): `formattedMessage = formatCommitMessage(message);`

S3 threads `options.position` into ALL THREE.

## 3. `SmartCommitOptions` (current — `src/utils/git-commit.ts:247-257`)
```ts
export interface SmartCommitOptions {
  /** When `true`, delegate commit-message generation … Default … use the caller-provided `message` verbatim. */
  readonly generateMessage?: boolean;
}
```
S3 ADDS: `readonly position?: ItemPosition | null;` (same module → `ItemPosition` already in scope; NO new import in git-commit.ts). Field is `readonly` to match `generateMessage`. `| null` matches `formatCommitMessage`'s 2nd-param type AND lets a caller pass `parseItemPosition(id)` directly (which may return `null` → graceful plain).

## 4. Call sites — ONLY 2 files call `smartCommit` (verified)
| # | File:line (current) | message | options (current) | Backlog? | S3 action |
|---|---|---|---|---|---|
| 1 | `src/core/task-orchestrator.ts:801` | `` `${subtask.id}: ${subtask.title} (skip-recovery…)` `` | `{ generateMessage: true }` | ✅ subtask | ADD `position: parseItemPosition(subtask.id)` |
| 2 | `src/core/task-orchestrator.ts:1061` | `` `${subtask.id}: ${subtask.title}` `` | `{ generateMessage: true }` | ✅ subtask | ADD `position: parseItemPosition(subtask.id)` |
| 3 | `src/core/task-orchestrator.ts:1113` | `'cleanup: doc reorganization'` | `{ generateMessage: true }` | ❌ non-backlog | OMIT position (plain) |
| 4 | `src/workflows/bug-hunt-workflow.ts:503` | `'chore(qa): bug hunt clean…'` | (NONE — default path) | ❌ non-backlog | OMIT (NO change — already option-less) |

- `task-orchestrator.ts:43` import: `import { smartCommit } from '../utils/git-commit.js';` → S3 EXTENDS to `import { smartCommit, parseItemPosition } from '../utils/git-commit.js';`. (`ItemPosition` type NOT needed at the call sites — `parseItemPosition` returns it; `SmartCommitOptions.position` infers the type from the field.)
- `bug-hunt-workflow.ts:40` import: `import { smartCommit } from '../utils/git-commit.js';` → NO change (site #4 omits position; no `parseItemPosition` needed).
- Bugfix-session numbering (contract point 3): bugfix sessions have their OWN P/M/T/S ids; `parseItemPosition(subtask.id)` yields the current session's indices → no special-casing. Confirmed: `subtask.id` is always 4-level (`SubtaskSchema` regex `src/core/models.ts:~353/382`).

## 5. Tests — current state + S3 work

### `tests/unit/utils/git-commit.test.ts` (S2 already rewrote the [PRP Auto] assertions)
- `parseItemPosition` (line 230), `buildTaskPrefix` (273), `formatCommitMessage` (298) describe blocks: COMPLETE + GREEN (assert task-prefix/plain/no-[PRP Auto]/trailer).
- `smartCommit` successful-ops (462+): call `smartCommit('/project', 'Test commit')` — NO position → assert plain `'Test commit\n\n…trailer'`. **Still GREEN after S3** (position omitted → plain). NO change.
- `smartCommit generateMessage option` happy path (1032): `smartCommit('/project','fallback',{generateMessage:true})` — NO position → assert plain `'feat(api): add endpoint\n\n…trailer'`. **Still GREEN after S3.** NO change.
- S3 ADDS new smartCommit-level tests verifying `position` FLOWS THROUGH: default-path-with-position → task-prefix; generateMessage-with-position → task-prefix; position `null` → plain. (These are the wiring-verification tests — the only NEW unit coverage in this file.)

### `tests/integration/smart-commit.test.ts` (pre-existing RED — BUG-004 category-a harness-init + format assertions)
- Line **11** comment: `Commit message format: [PRP Auto] {subtask.id}: {subtask.title}` → STALE; update to task-prefix/plain.
- Lines **45-47**: `formatCommitMessage: vi.fn((msg) => '[PRP Auto] ${msg}\n\n…')` → STALE mock; update to drop `[PRP Auto]` (plain subject + trailer).
- Lines **328-346** `should format commit message with subtask ID and title`: asserts `mockSmartCommit.toHaveBeenCalledWith(sessionPath, 'P3.M4.T1.S3: …')` (2 args). After S3 the orchestrator calls smartCommit with 3 args `{ generateMessage:true, position: parseItemPosition('P3.M4.T1.S3') }` → this 2-arg assertion BREAKS. Update to assert the 3rd arg (use `expect.objectContaining({ generateMessage:true, position: parseItemPosition('P3.M4.T1.S3') })`).
- Lines **348-360** `should add [PRP Auto] prefix to commit message`: REWRITE → assert task-prefix/plain + no `[PRP Auto]` (the S3-format test). Rename.
- **COORDINATION NOTE (contract point 5):** this file ALSO needs the BUG-004 category-(a) harness-init fix (P1.M4.T2.S2 — "PiHarness not initialized. Call initialize() first."). S3 owns the FORMAT assertions ONLY; do NOT fix harness-init here. The file stays RED on harness-init until P1.M4.T2.S2. S3's gate for this file = typecheck + logical correctness of the format assertions (cannot be GREEN until P1.M4.T2.S2 lands).

### `tests/unit/agents/commit-message-agent.test.ts` (S4's file — READ-ONLY for S3)
- Verify it still passes (no change). S3 does NOT touch it. The agent's "do NOT emit `[PRP Auto]`/`Co-Authored-By`" hard rule + the `toContain('[PRP Auto]')`/`toContain('Co-Authored-By')` assertions stay valid (S4 owns the prompt relaxation; that's parallel + disjoint).

## 6. npm scripts (verified — package.json)
- `npm run typecheck` = `tsc --noEmit -p tsconfig.build.json`
- `npm run lint` = `eslint . --ext .ts`
- `npm run format:check` = `prettier --check`
- `npm run fix` = `lint:fix && format` (run BEFORE format:check)
- `npm run test:run` = `vitest run` (PRE-EXISTING RED — BUG-004, 178 failures; NOT the S3 gate)

## 7. Scope boundary (what S3 does NOT touch)
- `src/agents/commit-message-agent.ts` + its test — S4 (parallel, disjoint).
- `src/config/constants.ts` — S1 (COMPLETE).
- `formatCommitMessage` / `parseItemPosition` / `buildTaskPrefix` / `ItemPosition` definitions — S2 (COMPLETE); S3 only CONSUMES them.
- Harness-init fix in `tests/integration/smart-commit.test.ts` — P1.M4.T2.S2 (BUG-004). S3 coordinates (format assertions only).
- Full `npm run test:run` green — P1.M4 (BUG-004); NOT the S3 gate.

## 8. Architecture contract source
`plan/008_15504f60a0ef/bugfix/002_86589b7d57d2/architecture/bug-003-commit-format.md` §"Call sites" (table) + §"S3 — wire smartCommit + call sites + update tests" prescribe the EXACT outcome: extend `SmartCommitOptions.position`, thread into BOTH wrap sites, sites #1/#2 pass `parseItemPosition(subtask.id)`, sites #3/#4 omit, update the `[PRP Auto]` test assertions.