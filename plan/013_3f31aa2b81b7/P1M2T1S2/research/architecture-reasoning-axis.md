# Research: ARCHITECTURE.md — per-role reasoning axis + QA split (P1.M2.T1.S2)

Session 013, **PRD §9.2.9 Mode B doc sync** — the `docs/ARCHITECTURE.md` slice.
Verified against the working tree on 2026-08-07. All line numbers from the live tree.

## 1. The two ARCHITECTURE.md sections to EXTEND (not rewrite)

`docs/ARCHITECTURE.md` (1190 lines, ~57KB) has TWO places describing the agent/model
contract. BOTH currently document the OLD hard-wired design and must be extended to the
two-axes (§9.2.9) model:

### A. `#### Agent Types` table — under `### 3. Agent Runtime` (line 319-329)
- Intro (line 321, STALE): "Each persona maps to a model **role** (research / reasoning /
  implementation) that selects **both** the model **tier** and the **reasoning budget** via
  `ROLE_CONFIG` … Tier names are `high` / `balanced` / `fast`."
  → Says the role selects BOTH tier AND budget from one map (the coupled design §9.2.9 severed).
- Table (line 323-329, STALE "Reasoning budget" column): Architect=`xhigh (max)`,
  Researcher=`normal`, Coder=`normal`, QA=`xhigh (max)`, Cleanup=`normal`.

### B. `## Model Roles & Reasoning Budget` (line 681-709) — the PRIMARY section
- Intro (line 683): "The role→{tier, `thinking`} mapping is driven by `ROLE_CONFIG` … the
  single source of truth." (OLD coupled phrasing.)
- Table (line 685-689): Research (balanced, normal), Reasoning (balanced, **`xhigh`**),
  Implementation (fast, normal).
- Bullets (line 691-693): "Reasoning role … at the **maximum** reasoning budget
  (`thinking: 'xhigh'`)"; Research/Implementation "normal (`thinking` omitted)".
- `### How thinking is wired` (line 695-697, STALE vocab): "only the Reasoning role sets
  `thinking: 'xhigh'` … The valid `ThinkingLevel` values are `'off' | 'low' | 'medium' |
  'high' | 'xhigh' | 'max'`." ← includes `max` (dropped), missing `minimal` (added).

**EXTEND, do not rewrite.** Keep the section structure / cross-links (line 709 already
links to `./CONFIGURATION.md#model-roles`); update the intro + table + "How thinking is
wired" to the two-axes model + the new defaults + the corrected vocab.

## 2. The two-axes model (the headline — from system-context §3 + PRD §9.2.3/§9.2.9)

- **Tier (the model)** STILL comes from `ROLE_CONFIG[role].tier` — UNCHANGED. ModelRole
  (`'research' | 'reasoning' | 'implementation'`, agent-factory.ts:132) still selects the
  tier: research/reasoning → `balanced` (`zai/glm-5.2`); implementation → `fast`
  (`zai/glm-5-turbo`). The role→tier model mapping is NOT touched by §9.2.9.
- **Reasoning level** is resolved **per agent-identity** from `PRP_REASONING_<ROLE>`
  (defaults `high`/`high`/`high`/`high`/`off` for research/breakdown/bug-finder/validation/
  impl), via the five getters in `src/config/constants.ts` (`getReasoningAgent` :1681,
  `getReasoningBreakdown` :1709, `getReasoningBugFinder` :1737, `getReasoningValidation`
  :1765, `getReasoningImpl` :1794). Tuning one axis NEVER perturbs the other — a user can
  run a strong model with reasoning off, or a fast model with reasoning on.
- **`createBaseConfig(persona, role, thinking)`** (agent-factory.ts:308-311): `thinking` is
  now a REQUIRED param with NO default — the load-bearing §9.2.9 decoupling. Each factory
  passes its resolved getter value.

## 3. The QA-persona split (system-context §4 — verified 4 callers, NOT 3)

`createQAAgent(reasoningLevel: ReasoningLevel)` (agent-factory.ts:493) is shared by FOUR
callers. Bug-finder + validation MUST resolve DISTINCT levels; delta-analysis +
change-classifier are research-leaning:

| Caller (verified) | Semantic identity | Resolves via | Env var | Default |
| --- | --- | --- | --- | --- |
| `src/workflows/bug-hunt-workflow.ts:276` | bug-finder | `getReasoningBugFinder()` | `PRP_REASONING_BUG_FINDER_AGENT` | `high` |
| `src/workflows/validation-workflow.ts:237` | validation | `getReasoningValidation()` | `PRP_REASONING_VALIDATION_AGENT` | `high` |
| `src/workflows/delta-analysis-workflow.ts:124` | delta-analysis (research-leaning) | `getReasoningAgent()` | `PRP_REASONING_AGENT` | `high` |
| `src/core/change-classifier.ts:117` (`classifyChange`) | change-classification (research-leaning) | `getReasoningAgent()` | `PRP_REASONING_AGENT` | `high` |
| `src/core/change-classifier.ts:168` (`classifyArtifact`) | change-classification (research-leaning) | `getReasoningAgent()` | `PRP_REASONING_AGENT` | `high` |

**The split:** `createQAAgent` gained a `reasoningLevel` param so the bug-finder and
validation callers (formerly the shared "QA" persona pinned to `xhigh`) now resolve
INDEPENDENT levels. delta-analysis + change-classifier perform PRD-diff/artifact
*analysis/classification* (not adversarial bug-hunting or contract validation) → they
resolve to the research role's level (`getReasoningAgent()`).

## 4. Auxiliary factories NOT in the §9.2.9 vocabulary (system-context §5)

Two `createBaseConfig` consumers are mechanical/single-shot and are NOT among the five
§9.2.9 roles — they hardcode `'off'` (NOT coupled to `PRP_REASONING_IMPL_AGENT`/`_AGENT`):
- `createCleanupAgent` (agent-factory.ts:547, role `'implementation'`) → `'off'`.
- `createCommitMessageAgent` (`src/agents/commit-message-agent.ts:364-367`) → `'off'`
  (single-shot commit-message generation; JSDoc at :341 documents the hardcode).

Tuning the five `PRP_REASONING_*` knobs never surprises these auxiliary agents.

## 5. The Groundswell harness seam (system-context §9 — cross-repo, OUT OF SCOPE)

Verified against `node_modules/groundswell@1.0.1` + `~/projects/groundswell/src`:
`HarnessOptions` has NO thinking/thinkingLevel/maxThinkingTokens field; `extendedThinking`
is only a boolean capability flag. So hacky-hack's `AgentConfig.thinking` is a
**pipeline-internal marker** that Groundswell `createAgent` does NOT consume. Wiring the
level through to the harness (`pi --thinking <level>` / claude-code `maxThinkingTokens`)
requires a **Groundswell API change** — explicitly OUT OF SCOPE for §9.2.9 (noted as a
cross-repo dependency, not implemented). ARCHITECTURE.md must state this honestly: the
level is resolved → validated → stored on `AgentConfig.thinking`; harness-side consumption
is a noted cross-repo dependency. (All §9.2.9 acceptance criteria test config resolution,
not harness behavior.)

## 6. The vocabulary correction (system-context §6)

`ThinkingLevel` is now an **alias** of `ReasoningLevel` (agent-factory.ts:129 — single
source of truth). The canonical vocab (`src/config/constants.ts:1519` `ReasoningLevel` /
  :1534 `REASONING_LEVELS`) is `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` —
**added `minimal`, dropped `max`**. The ARCHITECTURE.md "How thinking is wired" line
(line 697) still lists the OLD set (`'off'|'low'|'medium'|'high'|'xhigh'|'max'`) — must be
corrected. Repo-wide grep confirms no caller sets `'max'`.

## 7. Scope vs the sibling Mode B tasks (file-disjoint)

- **S1 (parallel, P1.M2.T1.S1) = `docs/CONFIGURATION.md`** — the user-facing CONFIG
  reference: the 5 `PRP_REASONING_*` env vars, the 5 `[reasoning]` `.hack` keys,
  vocab/defaults/empty/fail-fast, behavior change, two-axes model. **S2 =
  `docs/ARCHITECTURE.md`** — the architecture-level description. Different files; no merge
  conflict. S2 must NOT duplicate the env-var table / `.hack` keys (CONFIGURATION.md owns
  those); ARCHITECTURE.md cross-links to CONFIGURATION.md (already does at line 709).
- **S3 (P1.M2.T1.S3) = `README.md`** — a one-line mention + link. File-disjoint.
- The "two-axes model" concept appears in BOTH ARCHITECTURE.md and CONFIGURATION.md — that
  is correct and intended (each doc states it at its own level: architecture vs config
  reference). S2 states it at the architecture level and links to CONFIGURATION for the knobs.

## 8. Validation (doc-only — no src/, no tests)

- `npm run format:check` (prettier on `**/*.md`).
- `npm run docs:lint` (markdownlint `docs/**/*.md`).
- `npm run docs:check` (tsx scripts/check-docs.ts).
- `npm run docs:links` (markdown-link-check — the CONFIGURATION.md cross-link must resolve).
- grep gates: stale content GONE (`selects both the model tier AND the reasoning budget`,
  `xhigh (max)`, `'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`); new content PRESENT
  (`orthogonal`, `PRP_REASONING_`, `createQAAgent(reasoningLevel`, `high/high/high/high/off`,
  `cross-repo`).
- `git diff --name-only` shows ONLY `docs/ARCHITECTURE.md`.