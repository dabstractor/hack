# Research Notes — P1.M1.T2.S1 (commit the Groundswell working-tree fix)

## Verified state of `~/projects/groundswell` working tree (before writing PRP)

```
$ git status --short
 M src/__tests__/unit/harnesses-types.test.ts
 M src/__tests__/unit/providers/pi-harness-initialize.test.ts
 M src/__tests__/unit/providers/pi-harness-resolvemodel.test.ts
 M src/harnesses/pi-harness.ts
 M src/types/harnesses.ts
```
- Branch: `main` (the only branch; remote `origin git@github.com:groundswell-ai/groundswell`).
- HEAD: `6b77dbe chore(release): 1.0.0 [skip ci]` (the initial semantic-release commit).
- **5 modified files, +111/-11 lines** (verified via `git diff --stat`).
- **No staged files, no untracked files** — clean except for the 5 modifications.

## Core diff (verified via `git diff`)

`src/harnesses/pi-harness.ts` — two lines at the initialize() body (the JSDoc + comments also updated):
```diff
-    this.authStorage = AuthStorage.inMemory();
-    this.modelRegistry = ModelRegistry.inMemory(this.authStorage);
+    this.authStorage = options?.authStorage ?? AuthStorage.create();
+    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
```

`src/types/harnesses.ts` — adds `import type { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';`
and two optional fields to `HarnessOptions`: `authStorage?: AuthStorage;` and `modelRegistry?: ModelRegistry;`.

Plus 3 test files (`harnesses-types.test.ts`, `pi-harness-initialize.test.ts`, `pi-harness-resolvemodel.test.ts`).

## dist/ is gitignored + already rebuilt

- `~/projects/groundswell/dist/harnesses/pi-harness.js` md5 = `d3de7234…` (FIXED, contains `AuthStorage.create()`).
- hacky-hack stale `node_modules/groundswell/dist/harnesses/pi-harness.js` md5 = `54cea962…` (STALE, `inMemory()`).
- `grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js` → shows `AuthStorage.create()` at line 103 (and comments at 72/99).
- `dist/` is gitignored in groundswell → `git status` does NOT list it → it will NOT be part of the commit.
  `npm run build` rebuilds it idempotently (CI also rebuilds before publishing).

## Release mechanism (from deployment_strategy.md §"Option B")

- Groundswell uses **semantic-release** (`.releaserc.json` + `@semantic-release/npm`).
- Conventional commit `fix(harnesses): …` → **patch** → semantic-release (on push to main) auto-publishes
  **v1.0.1** + tags. Confirmed by the prior `2ce5432 ci: replace release-please with semantic-release…` commit
  ("semantic-release analyzes conventional commits directly and publishes on push, no PR needed").
- **THIS SUBTASK only commits.** Push → CI publish → npm → hacky-hack lockfile bump is a separate,
  CI-gated follow-up (and the `npm link` local verification is P1.M1.T2.S2, not this task).

## Commit message (from the contract + strategy)

```
fix(harnesses): use file-backed AuthStorage.create() over inMemory() to honor ~/.pi/agent/auth.json (PRD §9.2.6)
```
This is a valid Angular/Conventional Commit: type=`fix`, scope=`harnesses`, subject is imperative,
`(PRD §9.2.6)` footer-style reference. semantic-release classifies it as a patch.

## Scope discipline (CRITICAL)

- This subtask is **commit + rebuild dist + verify** ONLY — in the **groundswell** repo.
- NO changes to ANY hacky-hack file (that is P1.M1.T2.S2 — the `npm link` + verification).
- NO push to GitHub (CI-gated; out of scope).
- NO `npm publish` (CI-gated; out of scope).
- NO `npm link` (that is P1.M1.T2.S2).
- The commit must include **all 5** files (the 2 source + 3 test files) — they are one atomic change
  (the types addition enables the pi-harness option-injection; the tests assert the new behavior).
  Committing a subset would leave the repo in a broken half-state.

## Verification gate (must pass before declaring done)

```bash
cd ~/projects/groundswell
git status --short                    # → empty working tree (all 5 committed)
git log -1 --format='%s'              # → "fix(harnesses): use file-backed AuthStorage.create()…"
npm run build                          # rebuild dist (idempotent)
grep -n 'AuthStorage\.\(create\|inMemory\)()' dist/harnesses/pi-harness.js
# → MUST show: this.authStorage = options?.authStorage ?? AuthStorage.create();
#   and MUST NOT show AuthStorage.inMemory() in the constructor body.
```
