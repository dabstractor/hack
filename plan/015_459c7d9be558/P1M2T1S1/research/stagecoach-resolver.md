# Research — `stagecoach-ai` dependency + `resolveStagecoachBinary()` resolver

Findings anchoring P1.M2.T1.S1 (PRD §9.10.1 stagecoach binary delegation, step 1).
All line numbers verified against the working tree; package facts verified in
`architecture/stagecoach-and-agent-factory.md §1.1–§1.4`.

## 1. The `stagecoach-ai` npm package (architecture §1.1–§1.4 — verified)

- **v0.1.16**, public on npm, MIT. `bin: { stagecoach → ./bin/stagecoach.js }`.
- **`postinstall` (`install.cjs`)** downloads the per-platform Go binary (goreleaser
  matrix linux/darwin/windows × amd64/arm64) into the versioned cache:
  `~/.stagecoach/versions/<version>/<goos>-<goarch>/stagecoach` (overridable via
  `STAGECOACH_CACHE_DIR`). SHA256-verified, aborts before write on mismatch.
- **Runtime resolution (`bin/stagecoach.js` shim, §1.4):**
  ```js
  const cacheRoot = process.env.STAGECOACH_CACHE_DIR ||
    path.join(os.homedir(), '.stagecoach', 'versions');
  const cachedBin = path.join(cacheRoot, pkg.version, `${goos}-${goarch}`, binaryName);
  if (!fs.existsSync(cachedBin)) { stderr('…not installed…'); process.exit(1); }
  spawnSync(cachedBin, argv.slice(2), { stdio:'inherit', env: process.env });
  ```
  `pkg.version` = the `stagecoach-ai` package's own version. **The pipeline should
  resolve the binary the SAME way** (PRD §9.10.1: "resolves the binary via the
  dependency's resolved path and execs it directly").
- **`--ignore-scripts` guard:** if postinstall was blocked, the shim exits 1 with a
  clear message — **never a silent no-op**. The resolver MUST mirror this (throw, not
  silently fall back) per §9.10.1 acceptance: "Removing the stagecoach binary at
  runtime produces a clear, actionable error (not a silent fallback)."

➡️ This task adds the **dependency** + the **resolver**; P1.M2.T2.S1 does the actual
`stagecoach --dry-run --single` exec. The resolver is consumed by T2.S1.

## 2. AgentError — the throw type (errors.ts:425, verified)

```ts
export class AgentError extends PipelineError {
  readonly code = ErrorCodes.PIPELINE_AGENT_LLM_FAILED;
  constructor(message: string, context?: PipelineErrorContext, cause?: Error) { … }
}
```
`new AgentError(message)` is the established call shape (change-classifier.ts:130/163/178,
prp-generator.ts:724+, git-commit.ts:357/389/395, retry.ts:720). The resolver throws
`AgentError` on a missing binary/dep — **not** a silent fallback (contract + §9.10.1).
Import from `./errors.js` (`src/utils/errors.ts`).

## 3. ESM interop — `createRequire` (the codebase precedent, verified)

The project is `"type": "module"` (ESM) — **bare `require.resolve` is unavailable**.
The established pattern is `src/utils/logger.ts:48-51`:
```ts
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
```
➡️ The resolver reads the installed `stagecoach-ai` version via:
`nodeRequire.resolve('stagecoach-ai/package.json')` → `readFileSync` → `JSON.parse().version`.
This mirrors the shim's `pkg.version` source and works under ESM. `import.meta.resolve`
is an alternative but only stable Node ≥20.6; `createRequire` works on all Node 20+.

## 4. The goos/goarch mapping (Node → Go/goreleaser)

goreleaser names use Go's `GOOS`/`GOARCH`, NOT Node's `process.platform`/`process.arch`:
- **goos:** `process.platform === 'win32'` → `'windows'`; else `process.platform` (`'linux'`, `'darwin'`).
- **goarch:** `process.arch === 'arm64'` → `'arm64'`; `process.arch === 'x64'` → `'amd64'`
  (Node reports `x64`, goreleaser names `amd64`). Other arches (ia32…) are unsupported →
  the computed path won't exist → `existsSync` false → `AgentError` (acceptable fail-fast).
- **binaryName:** `'stagecoach.exe'` on windows, `'stagecoach'` elsewhere.

Extract this as a pure exported helper `platformArch()` so the mapping is directly
unit-testable (deterministic given `process.platform`/`process.arch`).

## 5. The resolver design (mirrors the shim §1.4 exactly)

```ts
export function resolveStagecoachBinary(): string {
  // 1. Read the installed stagecoach-ai version (the cache is versioned).
  let version: string;
  try {
    const pkgJsonPath = nodeRequire.resolve('stagecoach-ai/package.json');
    version = (JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version: string }).version;
  } catch {
    throw new AgentError(
      'stagecoach-ai dependency not installed. Run `npm install` (it brings the stagecoach ' +
        'native binary via postinstall; no separate install / PATH needed). See §9.10.1.'
    );
  }
  // 2. Compute the per-platform cache path (mirrors bin/stagecoach.js exactly).
  const { goos, goarch, binaryName } = platformArch();
  const cacheRoot =
    process.env.STAGECOACH_CACHE_DIR || path.join(os.homedir(), '.stagecoach', 'versions');
  const binPath = path.join(cacheRoot, version, `${goos}-${goarch}`, binaryName);
  // 3. Fail fast with an actionable error if the binary is missing (postinstall blocked).
  if (!existsSync(binPath)) {
    throw new AgentError(
      `stagecoach native binary not found at ${binPath}. Run \`npm install\` to install it ` +
        '(no separate install / PATH needed). See §9.10.1.'
    );
  }
  return binPath;
}
```
- **Missing binary → AgentError** (contract's exact message). **Missing dep → AgentError**
  (defensive: a bare `MODULE_NOT_FOUND` would be a confusing deep error; the catch gives the
  actionable `npm install` message). Both are `AgentError`, never a silent fallback.
- The path format `…/.stagecoach/versions/<version>/<goos>-<goarch>/stagecoach` is byte-identical
  to the shim's — so the resolver and `npx stagecoach` resolve the SAME binary.
- `STAGECOACH_CACHE_DIR` honored (mirrors the shim) — lets tests/CI redirect the cache.

## 6. package.json — where the dep goes (verified)

`package.json` deps are alphabetical. `"stagecoach-ai": "^0.1.16"` slots after `smol-toml`
(`sm` < `st`) and before `terser` (`st` < `te`):
```json
"simple-git": "^3.30.0",
"smol-toml": "^1.6.1",
"stagecoach-ai": "^0.1.16",
"terser": "^5.46.0",
```
Adding the dep + running `npm install` updates `package-lock.json` and triggers stagecoach-ai's
`postinstall` (downloads the native binary into `~/.stagecoach/`). The implementer MUST run
`npm install` after editing package.json. (`^0.1.16` per the contract.)

## 7. Testability — hermetic mocks (the dep may be absent at test time)

`vitest.config.ts` enforces 100% coverage on `src/`. The new module's branches:
- `platformArch`: win32/linux/darwin → goos; x64/arm64 → goarch; .exe vs stagecoach.
- `resolveStagecoachBinary`: dep-resolve-success, dep-resolve-fail (catch), binary-exists,
  binary-missing (existsSync false), `STAGECOACH_CACHE_DIR` override.

To make tests hermetic (independent of whether stagecoach-ai is actually installed):
- `vi.mock('node:module', () => ({ createRequire: vi.fn(() => ({ resolve: vi.fn((id) => '/fake/node_modules/' + id) })) }))`
  — controls `nodeRequire.resolve` so it never hits the real node_modules.
- `vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))` —
  `readFileSync` returns `'{"version":"0.1.16"}'` for the package.json path; `existsSync`
  true (happy path) / false (missing-binary path).
- `platformArch` tested directly by stubbing `process.platform`/`process.arch` via
  `Object.defineProperty(process, 'platform', { value: 'win32' })` (and arch) — OR by
  accepting it reads the real test-runner platform for one case + stubbing for the others.
- `STAGECOACH_CACHE_DIR`: `vi.stubEnv('STAGECOACH_CACHE_DIR', '/tmp/sc-cache')` → assert the
  returned path uses that root; `afterEach(() => vi.unstubAllEnvs())`.

This covers every branch deterministically without needing the real binary on disk.

## 8. Scope boundaries

- **S1 = `src/utils/stagecoach-resolver.ts` (NEW) + its unit test (NEW) + `package.json` (+
  `package-lock.json` via `npm install`).** Nothing else.
- **Consumed by P1.M2.T2.S1** (`generateCommitMessage` → `stagecoach --dry-run --single`),
  which also does the exec + provider/model/format forwarding. S1 ONLY resolves the path.
- **Do NOT touch `src/utils/git-commit.ts`** — it currently has the in-process stagecoach
  agent (lines 250+, "STAGECOACH (LLM COMMIT-MESSAGE GENERATION)"); T2.S1/T3.S1 rewrite it.
  S1 does not edit it. (T3.S3 owns the generation-timeout path there now.)
- **File-disjoint from the parallel P1.M1.T4.S1** (`src/agents/prompts.ts` + `PROMPTS.md` —
  prompt text). Zero overlap.
- DOCS: Mode A — JSDoc on `resolveStagecoachBinary` citing §9.10.1 ("Shipped with this tool —
  npm dependency, per-platform native binary via postinstall, no separate install, no PATH
  lookup") + the `npm install brings stagecoach transitively` note.

## 9. Validation

- `npm install` (after the package.json edit) — installs stagecoach-ai + runs its postinstall.
- `npm run typecheck` (tsc -p tsconfig.build.json, src/) — clean. `createRequire` + the new
  module typecheck (the `nodeRequire.resolve` return is a string; `readFileSync` is typed).
- `npm run lint && npm run format:check` — clean.
- `npx vitest run tests/unit/utils/stagecoach-resolver.test.ts` — GREEN (hermetic mocks).
- `npx vitest run tests/unit/utils/stagecoach-resolver.test.ts --coverage` — the new module 100%.
- Do NOT run the full `npm run test:run` as the gate (note: `scripts.validate` includes
  `test:run`; for THIS task gate on typecheck + lint + format:check + the targeted suite — the
  full suite has orthogonal pre-existing failures per the session's other PRPs).