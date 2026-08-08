# S3 Research — README blurb: per-role reasoning axis + link target + validation surface

This is a Mode B changeset-level doc update (README.md only). The whole task is:
add ONE concise blurb surfacing that reasoning level is independently configurable
per role, decoupled from model selection, with a link to CONFIGURATION.md. No `src/`.

## 1. The insertion point — README `### Model Tiers` (line 458)

README.md `## Configuration` (line 383) → `### Model Tiers` (line 458-465) is THE
agent/model-configuration summary a user reads. It currently lists the three tiers:

```markdown
### Model Tiers

- **High** (glm-5.2): Highest quality, used for Architect agent
- **Balanced** (glm-5.2): Balanced quality/speed, default for planning & research roles
- **Fast** (glm-5-turbo): Fastest, used for the implementation role (simple operations)

> Tier names were renamed `opus`→`high`, `sonnet`→`balanced`, `haiku`→`fast` (PRD §9.2.8).
> The legacy `ANTHROPIC_DEFAULT_*` env vars still work with a one-time deprecation warning.
```

Reasoning level is the OTHER axis (orthogonal to tier — PRD §9.2.9), so a sibling
`>` blockquote note placed right after the existing "Tier names were renamed" note
is the natural, discoverable home. The existing note block proves the `>` pattern
is idiomatic in this section.

There is a SECOND model-config spot — `### z.ai Configuration → "Model Tiers:"` table
(~line 525-531) with "(complex reasoning)" mentions — but that is API-endpoint
config prose, not the canonical role/tier summary. The `### Model Tiers` section
under `## Configuration` is the authoritative one; one blurb there is sufficient
(the contract: "wherever agent/model configuration is summarized, add a concise
mention" — singular blurb, feature-scope).

## 2. NO existing reasoning/thinking mention in README → zero duplication risk

`grep -niE "reasoning|thinking|PRP_REASONING" README.md` returns only incidental
"complex reasoning" / "Complex reasoning" descriptors (lines 144, 531). There is
NO mention of the per-role reasoning config surface. So S3 is the first to surface
it; no edit-duplication with prior README content.

## 3. The link target — `docs/CONFIGURATION.md#reasoning-levels` (S1, Complete)

S1 (Complete) added the canonical reference in `docs/CONFIGURATION.md`:
- `### Reasoning Levels` env-var subsection at **line 233** (anchor `#reasoning-levels`).
- `## Models, Roles & Reasoning Budget` section at line 439.

The blurb links to `docs/CONFIGURATION.md#reasoning-levels` — the most precise
anchor for the vocab + per-role env vars + defaults (the detail the blurb defers).
Anchor slug: "Reasoning Levels" → lowercase, spaces→hyphens → `reasoning-levels`.
**Verified unique** (only line 233 matches `^#{1,6} reasoning levels`).

README's existing link convention (verified): relative path from repo root,
e.g. line 410 `docs/CONFIGURATION.md#hack-configuration-file`, line 426/427/428
`docs/CONFIGURATION.md#resilience-tuning`, line 438 `docs/CONFIGURATION.md`.
So `docs/CONFIGURATION.md#reasoning-levels` matches the convention exactly.

## 4. The validation surface for README.md (IMPORTANT — narrower than docs/)

README.md lives at the repo ROOT, not in `docs/`. Therefore:
- `npm run format:check` (prettier --check `**/*.{ts,js,json,md,yml,yaml}`, line 44)
  **DOES cover README.md** — `.prettierignore` (node_modules/dist/coverage/plan/etc.)
  does NOT list README.md. This is the PRIMARY deterministic gate for README.
- `npm run format` (prettier --write) likewise covers README — run it after editing.
- `npm run docs:check` (tsx scripts/check-docs.ts) is scoped to `./docs`
  (constructor `docsPath = './docs'`, line 33; `getMarkdownFiles()` walks docs/).
  It does **NOT** scan README.md → it will not validate (nor break on) the README link.
- `npm run docs:lint` (markdownlint `docs/**/*.md`) does NOT cover README.md.
- `npm run docs:links` (markdown-link-check `docs/**/*.md || true`) does NOT cover
  README.md (and is non-gating anyway).

**Implication**: the README link must be verified MANUALLY (the anchor resolves +
the relative path is correct) because no automated gate checks root-level .md links.
Verification = `grep -nE "^### Reasoning Levels" docs/CONFIGURATION.md` returns
exactly one hit (line 233) + the slug `#reasoning-levels` matches. Prettier
(format:check) catches formatting/structure nits but NOT broken anchors.

## 5. Scope boundary — file-disjoint from S1/S2; no table duplication

- **S1** (Complete) owns `docs/CONFIGURATION.md` — the env-var + `.hack` knob tables +
  vocab/defaults/empty/fail-fast. **S2** (Implementing) owns `docs/ARCHITECTURE.md` —
  the two-axes architecture description.
- **S3** owns `README.md` ONLY. It surfaces the capability + a POINTER. It must NOT
  duplicate the per-role env-var table or the vocab/defaults detail — that lives in
  CONFIGURATION.md (the blurb links there). Feature-blurb scope only.
- DO NOT edit PRD.md, tasks.json, prd_snapshot.md, PROMPTS.md, any `src/`, or
  docs/CONFIGURATION.md / docs/ARCHITECTURE.md. `git diff --name-only` must show
  ONLY `README.md`.

## 6. The blurb wording (concise, ≤5 lines, surfaces capability + pointer)

Placed as a `>` blockquote immediately AFTER the existing "Tier names were renamed"
note (after README line 465), so the reading order is: tiers → tier-rename note →
reasoning-is-a-separate-axis note:

```markdown
> **Reasoning is a separate, per-role axis** (PRD §9.2.9): each agent role's
> extended-thinking budget is independently configurable — `off` / `minimal` / `low`
> / `medium` / `high` / `xhigh` — and is decoupled from model selection, so you can
> run a strong model with thinking off or a fast model with thinking on. See
> [Configuration → Reasoning Levels](docs/CONFIGURATION.md#reasoning-levels) for the
> per-role env vars and defaults.
```

This is the deliverable. It states: (a) per-role + independent; (b) the vocab;
(c) decoupled from model selection (the §9.2.9 headline); (d) a link to the detail.
It does NOT list env vars or defaults (CONFIGURATION owns those). Feature-blurb scope.

## 7. Optional polish (NOT required by the contract)

A one-line bullet under `## Features` (after the "4 AI Engines" bullet, line 144)
would add discoverability from the top-of-README feature list:
`- **Per-Role Reasoning**: independently tune each agent role's extended-thinking budget, decoupled from model tier ([Configuration → Reasoning Levels](docs/CONFIGURATION.md#reasoning-levels)).`
This is OPTIONAL — the `### Model Tiers` blurb alone satisfies the contract. If
added, it must use the same link + stay one line (feature-list scope). Default:
skip unless the implementer wants the extra discoverability.