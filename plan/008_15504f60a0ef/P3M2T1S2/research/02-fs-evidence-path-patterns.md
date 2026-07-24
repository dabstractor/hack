# Filesystem-Evidence Path Patterns (codebase ground truth)

## PRP path convention (the codebase's ACTUAL pattern)
Verified by reading `src/agents/prp-generator.ts:232-233` and `src/agents/prp-runtime.ts:195`:

```ts
// prp-generator.ts getCachePath / generation
const sanitized = taskId.replace(/\./g, '_');
return join(this.sessionPath, 'prps', `${sanitized}.md`);   // e.g. plan/005_.../prps/P1M1T1.S1.md
//                                                            NO — sanitized removes dots:
//                                                            plan/005_.../prps/P1M1T1S1.md

// prp-generator.ts generation ALSO writes JSON to:
const prpOutputPath = join(this.sessionPath, 'prps', `${sanitizedId}.json`);

// prp-runtime.ts execution reads:
const sanitizedId = subtask.id.replace(/\./g, '_');
const prpPath = join(this.#sessionPath, 'prps', `${sanitizedId}.md`);
```

**So the runtime PRP path is: `{sessionPath}/prps/{sanitizedId}.md`** where
`sanitizedId = itemId.replace(/\./g, '_')` (e.g. `P1.M1.T1.S2` → `P1M1T1S2`).

## `models.ts:1478` documents a SECOND convention
```
prpPath: 'plan/001_14b9dc2a33c7/P1M2T2S2/PRP.md'
@format plan/{sequence}_{hash}/{taskId}/PRP.md
```
This is the **per-item-directory** layout: `{sessionPath}/{sanitizedId}/PRP.md`. It is the layout
this very session uses (`plan/008_15504f60a0ef/P3M2T1S2/PRP.md` and `.../P3M2T1S2/research/`).

## `research/` directory convention
- The PRP-blueprint prompt (PROMPTS.md / src/agents/prompts.ts:243) instructs the researcher to
  "Store all research notes in the work item's research/ subdirectory."
- There is **no runtime helper** that creates or reads a `research/` directory — it is created by
  the researcher agent itself under the work-item directory (`{sanitizedId}/research/` in the
  per-item layout; the legacy `prps/` layout has no research/ subdirectory).

## Implication for the FS-evidence probe (the S2 decision)
The work item says: *"if join(sessionPath, itemId, 'PRP.md') exists **(or the PRP path pattern
used by the codebase)** → set status to 'Ready'; if join(sessionPath, itemId, 'research/')
exists → set status to 'Researching'."*

Because the codebase has TWO layouts, the FS-evidence helper MUST probe BOTH for the PRP
(`Ready`), and the per-item-dir `research/` for `Researching`:

```
For itemId `P1.M1.T1.S2` → sanitized `P1M1T1S2`:
  PRP candidates (Ready evidence):
    A. join(sessionPath, sanitizedId, 'PRP.md')            # per-item-dir layout (models.ts format)
    B. join(sessionPath, 'prps', `${sanitizedId}.md`)      # runtime layout (prp-generator/prp-runtime)
  research/ candidates (Researching evidence):
    A. join(sessionPath, sanitizedId, 'research')          # per-item-dir layout (this session's layout)
```
- If ANY PRP candidate exists → `Ready`.
- elif ANY research/ candidate exists (as a directory) → `Researching`.
- else → leave at the reverted (restored-blob) status (likely `Planned`).

This is robust to both layouts and future-proofs against a migration to the per-item-dir layout.
The work item explicitly authorizes "or the PRP path pattern used by the codebase" — probing
both is the conservative, correct reading.

## `sessionPath` resolution inside recoverTasksJson
`recoverTasksJson` already computes `sessionDir = dirname(resolve(tasksPath))` at the top.
`sessionDir` IS the session path (`plan/{sequence}_{hash}` for a normal session, or
`.../bugfix/{sequence}_{hash}` for a bugfix session). So the FS-evidence helper joins candidate
paths against `sessionDir`. No new path plumbing needed.

## `exists` checks: file vs directory
Use `node:fs/promises` `stat`:
```ts
import { stat } from 'node:fs/promises';
async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}
async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}
```
- PRP existence: `pathExists(prpCandidate)` (file or symlink-to-file).
- research/ existence: `dirExists(researchCandidate)` (must be a DIRECTORY — a stray file named
  `research` must not flip an item to Researching).