# Research Notes — P1.M2.T1.S2 (docs:lint green)

Environment-verified findings (markdownlint-cli **0.49.0**, this repo, 2026-06-21).

## 1. Baseline violation counts (full `npm run docs:lint`)

**Total: 975 violations across 22 files.**

| Rule                         | All docs | hand-written only (excl. docs/api) |
| ---------------------------- | -------- | ---------------------------------- |
| MD013/line-length            | 626      | 514                                |
| MD034/no-bare-urls           | 104      | 104                                |
| MD036/no-emphasis-as-heading | 98       | 98                                 |
| MD040/fenced-code-language   | 65       | 56                                 |
| MD024/no-duplicate-heading   | 32       | 26                                 |
| MD060/table-column-style     | 18       | 0 (all in docs/api)                |
| MD031/blanks-around-fences   | 13       | 13                                 |
| MD051/link-fragments         | 6        | 6                                  |
| MD029/ol-prefix              | 6        | 6                                  |
| MD032/blanks-around-lists    | 3        | 0 (all in docs/api)                |
| MD025/single-h1              | 2        | 2                                  |
| MD001/heading-increment      | 2        | 2                                  |

- `docs/api/**` (generated typedoc) = 148 violations → exclude via `.markdownlintignore`.
- `docs/research/**` = 289 violations, hand-written (committed) → in scope.

## 2. Verified `--fix` behavior (experiment on docs/research/cli-progress-research.md)

**Auto-fixed (content-preserving):**

- MD034/no-bare-urls → wraps `https://x` as `<https://x>`
- MD031/blanks-around-fences → adds blank lines
- MD029/ol-prefix → renumbers ordered-list markers

**NOT auto-fixable** (require config or manual edit):

- MD013/line-length, MD024/no-duplicate-heading, MD036/no-emphasis-as-heading,
  MD040/fenced-code-language, MD051/link-fragments, MD025/single-h1, MD001/heading-increment

Experiment: `markdownlint <file> --fix` wrapped 18 bare URLs and left MD013/MD024 untouched.

## 3. Verified `.markdownlintignore` exclusion

- `.markdownlintignore` containing `docs/api/` drops docs/api violations 148 → 0 under the
  existing glob `docs/**/*.md`. No package.json script change needed.
- `.gitignore` already lists `docs/api/` ("# Generated API documentation (TypeDoc)").

## 4. Config decision (`.markdownlint.json`)

```json
{
  "default": true,
  "MD013": false,
  "MD024": { "siblings_only": true },
  "MD036": false
}
```

- **MD013 disabled**: 514 prose line-length hits, not auto-fixable; contract explicitly sanctions
  this disable ("e.g. line-length for readable prose").
- **MD036 disabled**: 98 emphasis-as-heading hits (intentional pseudo-headers inside lists); not
  auto-fixable; hand-fixing risks altering layout.
- **MD024 tuned (not disabled)**: `siblings_only:true` is the documented recommended mode for docs
  — allows repeated subsection names under different parents, still catches true duplicates.

## 5. prettier compatibility

- `.prettierrc`: `tabWidth:2`, `printWidth:80`, `singleQuote`, `endOfLine:lf`.
- `.markdownlint.json` must be 2-space indent + trailing newline to pass `prettier --check`
  (format glob includes `*.json`).
- `.markdownlintignore` has no extension match in the format glob → prettier skips it.
- prettier and markdownlint AGREE on MD031/029/034 fixes → stable to run `format` after `--fix`.

## 6. Known manual-fix locations

- MD051: CONFIGURATION.md:161, INSTALLATION.md:657, research/technical-documentation-best-practices.md:14,18,19
- MD025 + MD001: research/technical-documentation-best-practices.md (~127,133,149,1369)

## 7. Reference docs (URLs)

- Rules: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/Rules.md
- MD013: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/md013.md
- MD024: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/md024.md
- MD036: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/md036.md
- MD040: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/md040.md
- MD051: https://github.com/DavidAnson/markdownlint/blob/v0.36.1/doc/md051.md
- CLI config/ignore: https://github.com/igorshubovych/markdownlint-cli#configuration
