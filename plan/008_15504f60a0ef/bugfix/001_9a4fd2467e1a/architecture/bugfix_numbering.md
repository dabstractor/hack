# Minor Issues Architecture — Issue 4

## Issue 4: Bugfix Sessions Use Flat Directory Instead of Numbered Iterations (MINOR)

### PRD Requirements

- **§4.4 step 3**: "Each bug hunt iteration that finds bugs should create a new numbered session: `bugfix/001_hash/`, `bugfix/002_hash/`, etc."
- **§5.1**: "Session structure: `plan/NNN_hash/bugfix/NNN_hash/`"

### Current State

`runQACycle()` (line ~1730):
```ts
const bugfixSessionPath = resolve(sessionPath, 'bugfix');  // FLAT dir
await mkdir(bugfixSessionPath, { recursive: true });
// ... copy TEST_RESULTS.md into bugfixSessionPath ...
const fixResults = await this.#runBugFixCycle(bugfixSessionPath, prdContent);
```

`#detectInterruptedBugfix()` (line ~1913):
```ts
const bugfixDir = resolve(sessionPath, 'bugfix');  // checks FLAT dir only
const testResultsPath = resolve(bugfixDir, 'TEST_RESULTS.md');
const tasksPath = resolve(bugfixDir, 'tasks.json');
// ... checks for interrupted state in the flat dir ...
```

**Effect**: Only ONE bugfix iteration exists per session. Running QA again overwrites the previous `bugfix/` directory rather than archiving it as `bugfix/001_hash/` and creating `bugfix/002_hash/`.

### Fix Strategy

Follow the same `NNN_hash` numbering pattern used by the main session manager:

1. **Create a numbered bugfix directory** under `sessionPath/bugfix/NNN_hash/`:
   - `NNN` = next sequence number (scan existing `bugfix/*` dirs for max NNN, increment)
   - `hash` = hash of the bug report content or a short random hash (for uniqueness)
   - e.g., `bugfix/001_a1b2c3d4e5f6/`

2. **Update `#detectInterruptedBugfix()`** to scan ALL numbered children of `bugfix/`:
   - Read `sessionPath/bugfix/` directory listing
   - For each `NNN_hash/` child, check for interrupted state (TEST_RESULTS.md present + tasks.json missing/empty/corrupt)
   - Return the FIRST interrupted child (or the most recent)
   - If a healthy child exists (tasks.json valid), skip it (already completed)

3. **Update `runQACycle()`** to create numbered directories:
   - Before creating a new bugfix dir, scan for the next available NNN
   - Create `bugfix/NNN_hash/` with `mkdir(recursive: true)`
   - Copy TEST_RESULTS.md into the numbered dir

4. **Archive**: Prior iterations are naturally preserved (not overwritten) since each gets a unique numbered directory.

### Session Numbering Helper

The existing session numbering in `session-utils.ts` / `session-manager.ts`:
```ts
const paddedSeq = String(sequence).padStart(3, '0');
const sessionId = `${paddedSeq}_${sessionHash}`;
```

A similar helper for bugfix dirs:
```ts
function nextBugfixSequence(sessionPath: string): number {
  const bugfixDir = resolve(sessionPath, 'bugfix');
  const entries = readdirSync(bugfixDir);  // may throw if not exists
  const seqs = entries
    .map(e => parseInt(e.split('_')[0], 10))
    .filter(n => !isNaN(n));
  return seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
}
```

### Key File Paths

| Symbol | Location | Purpose |
|--------|----------|---------|
| `runQACycle()` | `prp-pipeline.ts:~1700` | Creates bugfix dir |
| `#detectInterruptedBugfix()` | `prp-pipeline.ts:~1913` | Scans for interrupted bugfix |
| `#runBugFixCycle()` | `prp-pipeline.ts:~1868` | Runs fix cycle in bugfix dir |
| `createSessionDirectory()` | `session-utils.ts` | Reference for numbering pattern |
| `SessionManager.createSession()` | `session-manager.ts:~540` | Reference for NNN_hash pattern |

### Mutual Consistency Note

The PRD notes that the detection and creation paths are currently mutually consistent (both use flat `bugfix/`), so resume-interrupted-breakdown works for the flat layout. The fix must maintain this consistency: if creation uses `bugfix/NNN_hash/`, detection must scan `bugfix/NNN_hash/` children.

### FixCycleWorkflow Path Validation

`FixCycleWorkflow` validates that its `sessionPath` contains `'bugfix'` (PRD §5.1). The numbered path `bugfix/001_hash/` still contains `'bugfix'`, so this check passes unchanged.