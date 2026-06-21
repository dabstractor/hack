# Research Note — P1.M2.T1.S1: Add `markdownlint-cli` to devDependencies

Pure research. Verified against the live npm registry + the local repo. No files outside
this research/ directory were modified.

## 1. The binary-name decision (THE critical fact)

The existing `package.json` scripts invoke a command literally named **`markdownlint`**:

```json
"docs:lint":      "markdownlint \"docs/**/*.md\"",
"docs:lint:fix":  "markdownlint \"docs/**/*.md\" --fix",
```

Two candidate npm packages exist. `npm view <pkg> bin` confirms their installed command names:

| Package                | Latest   | `bin` mapping                                          | Invoked as          | Keeps existing scripts?                 |
| ---------------------- | -------- | ------------------------------------------------------ | ------------------- | --------------------------------------- |
| **`markdownlint-cli`** | `0.49.0` | `{ markdownlint: 'markdownlint.js' }`                  | `markdownlint`      | ✅ YES — no script change               |
| `markdownlint-cli2`    | `0.22.1` | `{ 'markdownlint-cli2': 'markdownlint-cli2-bin.mjs' }` | `markdownlint-cli2` | ❌ NO — requires rewriting both scripts |

**Conclusion:** Install **`markdownlint-cli`** (NOT `markdownlint-cli2`). Its shim is named
exactly `markdownlint`, which is what the scripts already call. The contract's fallback
("adjust the script to `markdownlint-cli2`") is therefore NOT triggered.

## 2. Current state (verified locally)

- `find node_modules -name "markdownlint*"` → **zero matches** (not hoisted, not nested).
- `ls node_modules/.bin/markdownlint*` → **empty** (no shim).
- `package.json` `devDependencies` → **no** `markdownlint*` entry.
- `package.json` `dependencies` → **no** `markdownlint*` entry.
- No `.markdownlint.json`, `.markdownlintrc`, `.markdownlint.yml`, or `markdownlint.config.*`
  exists anywhere in the repo root (markdownlint-cli will therefore run with its built-in
  default rule set).

## 3. Environment

- `node --version` → `v26.2.0`; `npm --version` → `11.16.0`. Modern; fully compatible with
  `markdownlint-cli@0.49.0`.
- `package-lock.json` exists (193 KB). `npm install --save-dev markdownlint-cli` will update
  **both** `package.json` (adds the `^0.49.0` devDep entry) **and** `package-lock.json`
  atomically. This is why npm — not pnpm/yarn — MUST be used: the project pins
  `"groundswell": "file:.yalc/groundswell"` and tracks state in npm's `package-lock.json`.

## 4. What `npm run docs:lint` will do after install (expected S1 behavior)

- The quotes in `markdownlint "docs/**/*.md"` **prevent shell glob expansion** and hand the
  raw glob to `markdownlint-cli`, which globs internally (via `globby`). This is correct as-is.
- With no config file present, `markdownlint-cli` lints every matched file against its default
  rule set. The `docs/**/*.md` glob recurses into `docs/research/` and any `docs/api/*.md`
  (TypeDoc also emits `.md` summaries in some configs — verify post-install).
- **EXPECTED OUTCOME for S1:** the command **executes** (exit is no longer "command not found").
  It is highly likely to **report lint violations** in the 20+ existing `docs/**/*.md` files
  and exit non-zero. **That is acceptable and out of scope for S1** — fixing the violations
  (or adding a `.markdownlint.json` config / inline config) is the entire purpose of
  **P1.M2.T1.S2**. S1's acceptance is "the script _resolves and runs markdownlint_", NOT "lint passes".

## 5. Scope guardrails (prevent scope-creep into S2 / Issue 4)

- **Do NOT** fix markdownlint violations in this subtask (S2 owns it).
- **Do NOT** add a `.markdownlint.json` config here (S2 owns "or add config").
- **Do NOT** edit the `docs:lint` / `docs:lint:fix` script strings — the `markdownlint` shim
  name matches; changing them is unnecessary and would collide with S2.
- **Do NOT** address `markdown-link-check` (`docs:links`) — it is a separate, unrelated tool
  already wrapped in `|| true`; out of scope.
- **Do NOT** touch the Issue-4 typecheck/format gates — `npm run validate` will still fail on
  the pre-existing 18 `ToolExecutor` errors + generated-state `format:check` failures until
  P1.M2.T2 lands. S1's success is **independent** of `npm run validate`.

## 6. Verification commands (post-install)

```bash
ls node_modules/.bin/markdownlint                 # shim present
npx markdownlint --version                        # prints 0.49.x
npm run docs:lint                                 # EXECUTES (may exit non-zero w/ violations — OK for S1)
# Distinguish success from failure:
#   "command not found"            → S1 FAILED (binary missing)
#   markdownlint lint output /     → S1 PASSED (violations are S2's job)
#   "MD0xx/..." violation lines
```

## 7. Authoritative references

- `markdownlint-cli` npm page + `--fix` / config discovery docs:
  https://github.com/igorshubovych/markdownlint-cli#readme
- `markdownlint` rule reference (the default rules S2 will see violated):
  https://github.com/DavidAnson/markdownlint/blob/main/doc/Rules.md
- Config file formats supported (for S2): https://github.com/igorshubovych/markdownlint-cli#configuration
