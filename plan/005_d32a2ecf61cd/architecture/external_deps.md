# External Dependencies — Session 005

## Groundswell (local, read-only)

- Linked via `package.json`: `"groundswell": "file:.yalc/groundswell"`.
- **Read-only from this project.** Do NOT edit `~/projects/groundswell/src`.
- This session requires **no new Groundswell exports.** All R1–R4 work is internal to
  hacky-hack (`src/core`, `src/agents`, `src/config`, `src/utils`, `src/tools`).
- APIs in use (confirmed present in built `dist/`): `createPrompt`, `Prompt`, `Agent`,
  `createAgent`, `configureHarnesses`, `parseModelSpec`, `@Workflow`/`@Step`/`@Task`
  decorators, `ObservedState`. None of these change this session.

## simple-git (in-repo via git-mcp.ts)

`src/tools/git-mcp.ts` wraps `simple-git`. Capabilities relevant to R4:
- `.log({ file: '<path>' })` — commit history for a file (NEW usage this session).
- `.show('<commit>:<path>')` — fetch a prior blob of a file (NEW usage this session).
- `.checkout(...)` / raw `git show <commit>:<path> > file` — restore a prior version
  (NEW usage this session).
- `.status()`, `.diff()`, `.add()`, `.commit()` — already wrapped (unchanged).

These are all standard `simple-git` features (documented in the `simple-git` package);
no new dependency is required, only new wrapper functions in `git-mcp.ts`.

## Other runtime deps (unchanged)

`commander` (CLI), `zod` (schemas — `BacklogSchema`, `PRPDocumentSchema`), `pino` (logging),
`fast-glob`, `chalk`/`cli-progress`/`cli-table3` (display), `diff`, `ms`, `terser`, `tiktoken`.

## No new npm dependencies required

R1–R4 are implementable entirely with the existing dependency set. Any subtask that
appears to need a new dependency should re-verify against `simple-git`/`zod` first.
