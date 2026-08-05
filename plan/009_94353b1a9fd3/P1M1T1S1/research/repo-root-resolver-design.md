# Research — P1.M1.T1.S1 (resolveRepositoryRoot + bootstrap chdir)

Foundation for PRD §9.8 (Repository Root Resolution). S1 = the resolver engine
+ `NotARepositoryError` + module-singleton accessors + `main()` wiring (capture
INVOCATION_CWD, resolve, chdir). Consumed by S2 (`--repo-root` flag) and
P2.M1.T1.S2 (`.hack` loader needs repoRoot).

## 1. Bootstrap ordering today (src/index.ts main(), verified)

`main()` at **src/index.ts:110**; invoked via `void main().then(code…).catch(…)`
(bottom of file). Order (line numbers confirmed):
1. `parseCLIArgs()` — **L112** (Commander; `--help`/`--version`/usage errors `process.exit` HERE).
2. subcommand early-return — L113–119 (`if ('subcommand' in parseResult) return 0`).
3. `const args: ValidatedCLIArgs = parseResult;` — ~L121.
4. `setupGlobalHandlers(args.verbose)` — L125.
5. `configureEnvironment()` — **L128**.
6. `getLogger('App', …)` — L131–135. … dry-run/validate-prd early returns … `configureHarness()` L208 → `runAuthPreflight()` L213 → `ensureHarnessInitialized()` L218 → `new PRPPipeline(...)` L245 → `pipeline.run()` L258.

**S1 insertion:** capture `INVOCATION_CWD` at MODULE scope (top of index.ts,
evaluated at import — strictly before main()) → satisfies both "module-level
const" and "before parseCLIArgs". Then in main(), AFTER step 2 (subcommand
return) and BEFORE step 5 (`configureEnvironment`), call
`resolveRepositoryRoot(INVOCATION_CWD)` + `process.chdir(repoRoot)`. Earliest
point after CLI parsing — matches "first thing after CLI parsing". (S2 will
pass `{ explicit: args.repoRoot }` once the flag lands.)

`main().catch()` (bottom of file) has dedicated clean-render arms for
`AuthPreflightError`, `HarnessProviderMismatchError`, `UnsupportedHarnessError`
(`❌ ${message}` + exit 1); else generic. **S1 does NOT add a NotARepositoryError
arm** — that clean-render + exit-code + child-inheritance UX is **P1.M1.T2.S1**.
S1 just throws the typed error; the generic arm renders it (acceptable for S1).

## 2. No repo-root logic exists (confirmed)

`grep` for findRepoRoot/walkUp/findUp/`git rev-parse --show-toplevel`/`process.chdir` →
**0 hits in src/**. Every downstream site reads `process.cwd()` inline (~30 sites,
listed in architecture/system_context.md §2.2). The single-bootstrap-`chdir`
strategy (§9.8.3) means **zero per-site changes** — after `process.chdir(repoRoot)`
all `resolve(...)`/`process.cwd()` naturally resolve to repo root.

## 3. The dir-or-file `.git` detection pattern (mirror this)

`src/tools/git-mcp.ts:202-213` `validateRepositoryPath` uses `existsSync` (true for
BOTH directory and file → `.git` as a **file** = worktree/submodule `gitdir:` pointer
is accepted, §9.8.4). It does NO upward walk (only checks the exact path). The new
resolver MIRRORS the dir-or-file acceptance via `existsSync(join(dir, '.git'))` but
ADD the upward traversal. **Do NOT modify validateRepositoryPath** (after chdir its
default `process.cwd()` is correct).

## 4. The resolver (src/utils/repo-root.ts) — design

```ts
import { existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

export interface ResolveRepoOpts { explicit?: string }   // S2 wires --repo-root → opts.explicit

export class NotARepositoryError extends Error {
  readonly searchedFrom: string;
  readonly explicit: boolean;
  constructor(searchedFrom: string, opts?: { explicit?: boolean }) {
    const remediation = opts?.explicit
      ? `--repo-root path "${searchedFrom}" does not contain a .git entry.`
      : `No .git entry found at or above "${searchedFrom}". Run inside a git repository, or pass --repo-root <path>.`;
    super(remediation);
    this.name = 'NotARepositoryError';
    this.searchedFrom = searchedFrom;
    this.explicit = opts?.explicit ?? false;
  }
}

// Module singleton (set by resolveRepositoryRoot; read by accessors).
let _repoRoot: string | undefined;
let _invocationCwd: string | undefined;

export function resolveRepositoryRoot(
  startDir: string,
  opts?: ResolveRepoOpts
): { repoRoot: string; invocationCwd: string } {
  const invocationCwd = startDir;
  const found = opts?.explicit
    ? resolveExplicit(opts.explicit)        // §9.8.6 explicit override
    : traverseUp(startDir);                  // §9.8.2 default upward walk
  const repoRoot = realpathSync(found);      // canonicalize (§9.8.2)
  _repoRoot = repoRoot;
  _invocationCwd = invocationCwd;
  return { repoRoot, invocationCwd };
}

export function getRepoRoot(): string {
  if (_repoRoot === undefined) throw new Error('Repository root not resolved yet (resolveRepositoryRoot must run during bootstrap).');
  return _repoRoot;
}
export function getInvocationCwd(): string {
  if (_invocationCwd === undefined) throw new Error('Invocation CWD not captured yet (resolveRepositoryRoot must run during bootstrap).');
  return _invocationCwd;
}

function traverseUp(startDir: string): string {
  let dir = resolve(startDir);                // absolute
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;   // nearest ancestor wins (§9.8.2)
    const parent = dirname(dir);
    if (parent === dir) break;                // filesystem root reached
    dir = parent;
  }
  throw new NotARepositoryError(startDir);    // hard error (§9.8.5)
}

function resolveExplicit(explicit: string): string {
  const abs = resolve(explicit);              // relative to current cwd
  if (!existsSync(join(abs, '.git'))) throw new NotARepositoryError(abs, { explicit: true });
  return abs;
}
```

**Scope decision (documented):** S1 implements the COMPLETE engine — both the
default `traverseUp` AND the `resolveExplicit` branch — because (a) the contract
signature mandates `opts?: { explicit?: string }`; (b) it avoids the unused-param
lint trap; (c) it ships a complete, independently-testable resolver. **S2 owns the
CLI flag** (declare `--repo-root` in Commander, thread `args.repoRoot` into
`resolveRepositoryRoot(INVOCATION_CWD, { explicit: args.repoRoot })`) + any §9.8.6-
specific CLI UX. If the orchestrator intended S2 to own the explicit branch entirely,
S1 can drop `resolveExplicit` + the `explicit` field — but then `opts` is unused (lint).

## 5. Algorithm edge cases (must test)

- `.git` as a DIRECTORY (normal clone) → found.
- `.git` as a FILE (worktree/submodule gitdir pointer) → found (existsSync true for both).
- Nearest-ancestor wins: nested repo inside an outer repo → inner `.git` wins.
- Start dir IS the repo root → found immediately (no walk).
- Walk to filesystem root (`dirname(dir) === dir`) with no `.git` → `NotARepositoryError`.
- `realpathSync` canonicalizes a symlinked repoRoot.
- Explicit path with `.git` → returned; explicit path WITHOUT `.git` → `NotARepositoryError(explicit:true)`.
- Accessor-before-resolution: `getRepoRoot()`/`getInvocationCwd()` before any `resolveRepositoryRoot` → throw.

## 6. Purity / side-effects

- `resolveRepositoryRoot` has ONE intentional side effect: setting the module singleton
  (`_repoRoot`/`_invocationCwd`) + the caller's `process.chdir`. Document both.
- Inputs read-only; `existsSync`/`realpathSync` are read-only fs probes (no writes).

## 7. Test strategy

- **Unit (vi.mock fs):** `tests/unit/utils/repo-root.test.ts`. Mock `node:fs`
  (`existsSync`/`realpathSync`) to synthesize dir structures; assert traversal stops at
  nearest `.git`, root-reached throws, explicit branch, accessor-before-resolution throws.
  Mirror the vi.mock('node:fs', …) style already used in `groundswell-verifier.test.ts`.
- **Integration (real tmpdir):** `tests/integration/utils/repo-root.test.ts` (or co-located).
  Use `mkdtempSync` + `mkdirSync(join(tmp,'.git'))` (dir form) and a `writeFileSync(join(tmp,'.git'),…)`
  (file form); build a nested dir `tmp/a/b/c` and assert `resolveRepositoryRoot(tmp/a/b/c).repoRoot`
  resolves up to `tmp`. Assert `realpathSync` equality. Clean up in afterEach.
- 100% coverage (vitest threshold): every branch — found-at-start, walk-then-found, root-reached,
  explicit-ok, explicit-no-git, accessor-unset (×2) — must be hit.

## 8. Validation

- `npm run typecheck` (tsc --noEmit -p tsconfig.build.json) — clean.
- `npm run lint && npm run format:check` — clean (prettier ERROR-enforced; run `npm run fix`).
- `npx vitest run tests/unit/utils/repo-root.test.ts` (+ integration file) — green, 100% on repo-root.ts.
- Smoke: `npx tsx -e "import {resolveRepositoryRoot} from './src/utils/repo-root.ts'; console.log(resolveRepositoryRoot(process.cwd()))"`
  from inside the hacky-hack repo → prints the repo root.