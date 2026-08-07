# External Dependencies: BUG-001

## simple-git (^3.30.0)

**Package**: `simple-git`
**Version**: `^3.30.0` (per package.json)
**Purpose**: Programmatic Git interface used by `src/tools/git-mcp.ts` for all git operations.

### Relevant API: `git.log(options)`

**LogOptions type** (from `node_modules/simple-git/dist/src/lib/tasks/log.d.ts`):

```typescript
export type LogOptions<T = DefaultLogFields> = {
    file?: string;
    format?: T;
    from?: string;
    mailMap?: boolean;
    maxCount?: number;       // ← The CORRECT option for limiting commit count
    multiLine?: boolean;
    splitter?: string;
    strictDate?: boolean;
    symmetric?: boolean;
    to?: string;
};
```

**Key behavior**: Unrecognized option keys are passed through as literal positional arguments
to the `git log` CLI command. This is why `maxEntries` (not a valid LogOptions key) results
in `git log maxEntries=5` being executed, which git rejects with a fatal error.

**Correct usage**: `git.log({ maxCount: 5 })` → returns the 5 most recent commits.

**LogResult shape**:
```typescript
interface LogResult {
  all: DefaultLogFields[];    // array of commits, newest-first
  total: number;
  latest: DefaultLogFields;   // first entry
}
interface DefaultLogFields {
  hash: string;
  date: string;
  message: string;            // full message (subject + body)
  refs: string;
  body: string;
  author_name: string;
  author_email: string;
}
```

The `getRecentCommitMessages()` function maps `logResult.all` → `string[]` of messages.

## vitest (^1.6.1)

**Package**: `vitest`
**Version**: `^1.6.1` (per package.json)
**Purpose**: Test runner.

### Relevant APIs for regression-prevention tests

- `mkdtempSync` from `node:fs` + `tmpdir` from `node:os` for temp directory creation
- `rmSync(dir, { recursive: true, force: true })` for cleanup in `afterEach`
- `execFileSync('git', ['init', dir])` or `simpleGit(dir).init()` for initializing a temp repo
- `simpleGit(dir).addConfig('user.email', ...)` + `.addConfig('user.name', ...)` for commit identity
- `simpleGit(dir).commit('message')` for seeding commits

### Existing Temp-Repo Test Pattern (from tests/unit/config/hack-config.test.ts)

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prefix-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
```

No existing test helper creates a fully-initialized temp git repo with commits — this pattern
must be established as part of the regression-prevention tests.

## Node.js Built-ins

- `node:fs` — `mkdtempSync`, `rmSync`, `writeFileSync` for temp file/repo management
- `node:os` — `tmpdir()` for temp directory root
- `node:path` — `join` for path construction
- `node:child_process` — `execFileSync` (alternative to simpleGit for git init/commit in tests)