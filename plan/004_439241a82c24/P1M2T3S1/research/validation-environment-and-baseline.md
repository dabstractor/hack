# Research — P1.M2.T3.S1: Validation Environment & Markdown Lint Baseline

> Load-bearing facts for the validation strategy of a **documentation-only**
> subtask. Captured on 2026-06-20 by direct inspection of the hacky-hack repo.

## 1. The two validation commands named by the work item

The work item says: _"Run `npm run docs:lint` (markdownlint) and
`npm run format:check`; fix lint/format issues introduced."_

| Command                | Definition (package.json)                          | Binary installed?                                                                                     | Reliable? |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| `npm run format:check` | `prettier --check "**/*.{ts,js,json,md,yml,yaml}"` | **Yes** — `prettier@^3.7.4` in devDependencies                                                        | ✅ YES    |
| `npm run docs:lint`    | `markdownlint "docs/**/*.md"` (package.json:56)    | **NO** — `markdownlint`/`markdownlint-cli` NOT in node_modules, NOT in `.bin`, NOT in devDependencies | ❌ NO     |

### Why `npm run docs:lint` fails (and is NOT this task's job to fix)

`markdownlint` (the CLI binary referenced by `docs:lint`) is **not installed**:

```
$ ls node_modules/.bin/markdownlint        → NOT FOUND
$ ls -d node_modules/markdownlint-cli      → NOT FOUND
$ npx --no-install markdownlint docs/CONFIGURATION.md
  → npm error could not determine executable to run
```

devDependencies contains only `eslint`, `prettier`, and `@typescript-eslint/*`
(no markdownlint). Running `npm run docs:lint` therefore errors at the
**package-resolution level** ("could not determine executable to run"), not at
the linting level. This is a **pre-existing environment gap**, not a defect
introduced by this docs task, and fixing it (adding the dependency) is **out of
scope** for a documentation subtask.

### Equivalent check that DOES work

`npx markdownlint-cli2 <file>` auto-installs `markdownlint-cli2@0.22.1`
(markdownlint v0.40.0) on first run and lints the file with **default rules**
(there is **no** `.markdownlint.json` / `.markdownlintrc` / `.markdownlintignore`
in the repo — confirmed). This is the closest runnable equivalent and is what
was used to establish the baseline in §2 below.

## 2. The established markdownlint baseline of `docs/CONFIGURATION.md`

Running `markdownlint-cli2` (default rules) against the **current, untouched**
`docs/CONFIGURATION.md` yields **59 errors** — i.e. the file **already does not
pass markdownlint** before this task touches it. Distinct rules:

```
 57  MD013/line-length         (Expected: 80)   — wide markdown tables + long URL rows
  1  MD051/link-fragments       — a TOC anchor that does not resolve
   1  MD024/no-duplicate-heading — "Model Selection" appears twice
                                  (### Model Selection under Env Vars + ## Model Selection top-level)
```

### What this means for scope

The task's stated intent is _"fix lint/format issues **introduced**"_ — i.e. do
not ADD new violations; it does **not** require making the whole file pass
markdownlint (fixing 57 MD013 table-length errors would mean rewriting every
table in the file, which is a separate cleanup task and out of scope).

**Rule for the implementer:** match the existing table/column style (which
inherently exceeds 80 cols). New tables are acceptable at the same width as the
existing ones (they will trip MD013 just like the rest of the file — that is the
established baseline, not a regression). The hard constraints to avoid are
**NEW** violations of rules the baseline does **not** already trip in the edited
regions — chiefly:

- **MD024/no-duplicate-heading** — there is already one duplicate ("Model
  Selection"). Do **not** add another duplicate heading. Pick a unique heading
  for the new harness subsection (e.g. `### Agent Runtime (Harness)`) and a
  unique anchor.
- **MD051/link-fragments** — there is already one broken TOC anchor. Every TOC
  entry and cross-link added must resolve to a real heading anchor. Verify the
  anchor spelling (GitHub-style: lowercase, spaces→`-`, parens/symbols dropped).
- **MD009/trailing-space, MD012/multiple-blanks, MD040/fenced-code-language,
  MD033/no-inline-html** — none present in baseline; do not introduce.

## 3. `prettier` IS the authoritative gate (and the doc currently passes it)

`npm run format:check` is **installed** and is the real, enforced gate. Verified:

```
$ npx prettier --check "docs/CONFIGURATION.md"
Checking formatting...
All matched files use Prettier code style!     ← PASSES today
```

Prettier enforces the repo `.prettierrc`: `printWidth: 80`, `singleQuote: true`,
`trailingComma: "es5"`, `tabWidth: 2`. Prettier **will reformat markdown
tables** to its own column alignment and **can wrap long lines**. Therefore:

- After editing, run `npm run fix` (lint:fix + `prettier --write`) then
  `npm run format:check` — **must** be green.
- Prettier's table reformatting will keep MD013 (line-length) "violations" where
  wide tables exceed 80 cols — that is fine (matches baseline). Do **not** hand-
  fight prettier; let it format, then verify the result renders correctly.

## 4. `npm run validate` covers the markdown file

`npm run validate` = `npm run lint && npm run format:check && npm run typecheck`.

- `lint` = `eslint . --ext .ts` → **TypeScript only**; does NOT lint markdown.
- `format:check` → **does** check `*.md` (glob includes `md`). ← the gate that matters
- `typecheck` = `tsc --noEmit` → irrelevant for a docs change (no .ts touched).

So **`npm run validate` will pass** for this task iff `format:check` passes
(lint/typecheck are unaffected since no `.ts`/source is changed). This is the
cleanest single command to run as the final gate.

## 5. Conclusion / validation recipe for the implementer

1. **Edit** `docs/CONFIGURATION.md` (add harness env var, provider-qualified
   model format, override behavior, claude-code/zai incompatibility, cross-link
   to `docs/GROUNDSWELL_GUIDE.md#harness-system`). Match existing table style.
2. **Format (authoritative):** `npm run fix` → then `npm run format:check`
   (MUST be green) and `npm run validate` (MUST be green; only format:check is
   relevant).
3. **Markdown lint (best-effort, no-install equivalent):** run
   `npx markdownlint-cli2 docs/CONFIGURATION.md` and compare against the
   **baseline counts** from §2 (57 MD013 / 1 MD051 / 1 MD024, ~59 total). The
   edited file must not introduce violations of rules absent from the baseline
   (no NEW MD024 duplicates, no NEW MD051 broken anchors, no MD009/MD012/MD040).
   An increase in MD013 count from new wide-table rows is acceptable (matches
   the existing style). Do **not** attempt to zero out the pre-existing 59.
4. **Do NOT** run `npm run docs:lint` expecting it to lint — it will fail with
   "could not determine executable to run" because `markdownlint` is not
   installed. That is a pre-existing env gap, out of scope.
