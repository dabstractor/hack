# Groundswell Deployment Strategy — Fixing the Stale Dist (Issue 1)

## Current State (verified)

- hacky-hack depends on `groundswell` via the **npm registry** — `package.json`:
  `"groundswell": "^1.0.0"`.
- `package-lock.json` resolves to a **published tarball**:
  `https://registry.npmjs.org/groundswell/-/groundswell-1.0.0.tgz` (integrity-locked, NOT a
  symlink, NOT a `file:` link, NOT a `git+ssh:` URL).
- `node_modules/groundswell` is a **plain directory** (not a symlink).
  `readlink node_modules/groundswell` → empty; `test -L` → not a symlink.
- `.envrc` contains only z.ai API env vars — **no NODE_PATH, no npm link, no source**.
- There is **no `.npmrc`** in hacky-hack.
- The fix EXISTS in `~/projects/groundswell` working tree (uncommitted):
  - `src/harnesses/pi-harness.ts`: `AuthStorage.inMemory()` → `options?.authStorage ?? AuthStorage.create()`
  - `src/types/harnesses.ts`: adds `authStorage?` / `modelRegistry?` to `HarnessOptions`
  - 3 test files updated.
- The fix is **already rebuilt** in `~/projects/groundswell/dist/` (gitignored, md5 `d3de7234…`).
- The **deployed** dist (`node_modules/groundswell/dist/harnesses/pi-harness.js`, md5 `54cea962…`)
  still has `AuthStorage.inMemory()` at line 95.

## Deployment Options

### Option A — `npm link` (local dev verification; immediate)

```
cd ~/projects/groundswell
git add -A && git commit -m "fix(harnesses): use file-backed AuthStorage.create() over inMemory() (PRD §9.2.6)"
npm run build                      # rebuild dist (already done, but idempotent)
npm link                           # register globally
cd ~/projects/hacky-hack
npm link groundswell               # node_modules/groundswell → symlink to ~/projects/groundswell
```

**Pros:** immediate; no CI round-trip; fully verifiable locally; the already-rebuilt dist is picked up.
**Cons:** machine-local + non-reproducible; NOT captured in lockfile; CI/other devs still get stale
1.0.0; must be reversed before committing (`npm unlink groundswell && npm install`) or the tree is
left hybrid.

**Verdict:** Use for **local verification** of the fix. NOT a permanent deployment.

### Option B — Publish to npm + bump consumed version (the clean, reproducible path)

Groundswell uses **semantic-release** (`.releaserc.json`, `@semantic-release/npm` devDep, remote
`git@github.com:groundswell-ai/groundswell`). Flow:

1. In `~/projects/groundswell`: commit the fix with a **conventional commit** message —
   `fix(harnesses): use file-backed AuthStorage.create() over inMemory() (PRD §9.2.6)`.
   (A `fix:` → patch → next version becomes **1.0.1**.)
2. Push to `main`. semantic-release runs in CI: builds, tests, publishes, tags.
3. In hacky-hack: `npm install groundswell@latest` (the `^1.0.0` range already permits 1.0.1+).
4. Commit the refreshed `package-lock.json`.

**Pros:** fully reproducible; integrity-locked in lockfile; works in CI/prod; honors the project's
lockfile discipline; the intended release mechanism for this repo.
**Cons:** requires push→CI publish round-trip (minutes); npm publish access required.

**Verdict:** The **correct production deployment path.**

## Recommended Approach for This Bugfix

**Both, in sequence:**

1. **Commit the groundswell fix** (both options require this).
2. **`npm link` for immediate local verification** — so the integration test (P1.M1.T1) and
   validator hardening (P1.M1.T3) can be verified green against the fixed code.
3. **Document the publish path** — the groundswell commit is conventional (`fix:`), so once pushed,
   semantic-release will auto-publish 1.0.1. hacky-hack then runs `npm install groundswell@latest`
   and commits the lockfile. This makes the fix permanent and reproducible.

### What the implementer must verify after deployment

```bash
# 1. node_modules/groundswell now uses the fix:
grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
# → expect: this.authStorage = options?.authStorage ?? AuthStorage.create();

# 2. Runtime proof (auth.json-only, no env vars):
# The P1.M1.T1 integration test passes (getApiKey('zai') resolves the seeded key).

# 3. For npm link: confirm symlink:
readlink -f node_modules/groundswell
# → /home/dustin/projects/groundswell
```

## Cross-Repo Considerations

The fix lives in a **separate repository** (`~/projects/groundswell`). The hacky-hack PRP agents
operate primarily in hacky-hack but CAN:
- `cd ~/projects/groundswell && git add/commit` (the fix is already written).
- `cd ~/projects/groundswell && npm run build` (rebuild the gitignored dist).
- `npm link` in both repos.

They CANNOT (without CI/npm access):
- Push to GitHub and wait for semantic-release to publish.
- `npm publish` manually (unless they have the npm credentials).

So the **local** fix path (commit + link) is fully achievable; the **production** publish path is
a documented follow-up that requires CI.

## Groundswell Package Identity

- `name: groundswell`, `version: 1.0.0`, ESM, `main`/`module`/`types` → `./dist/index.js`/`.d.ts`.
- `publishConfig.access: public`, `files: ["dist","LICENSE"]`, `engines.node: >=22.19`.
- Remote: `origin git@github.com:groundswell-ai/groundswell`.
- HEAD: `6b77dbe chore(release): 1.0.0 [skip ci]`.
- `dist/` is gitignored in groundswell — CI rebuilds before publishing.
