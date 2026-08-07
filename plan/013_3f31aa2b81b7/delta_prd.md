# Delta PRD — Per-Role Reasoning Level (Extended-Thinking Budget)

> **Scope of this delta.** A single cohesive feature: the extended-thinking
> ("reasoning") budget becomes a **first-class, independently-configurable
> per-role setting**, fully decoupled from model selection. The model id (per
> tier) and the reasoning level (per role) are now two independent axes —
> tuning one never forces a compromise on the other.
>
> This delta corresponds to PRD **§9.2.9** (new) plus conforming edits to
> **§6.1, §9.2.2, §9.2.3, §9.5, and §9.7.5**. No other sections changed.

## 1. What Changed (Diff Summary)

The previous PRD hard-wired reasoning: the reasoning roles (`BREAKDOWN_AGENT`
/ `BUG_FINDER_AGENT` / `VALIDATION_AGENT`) were pinned to the **maximum**
budget (`xhigh`), research ran at an unspecified "normal" budget, and
implementation inherited its model's default. Because the budget was coupled
to model selection in practice, a user who wanted reasoning off for the
implementation step was forced onto a lower-tier model.

The current PRD replaces this with **§9.2.9 — Per-Role Reasoning Level**, a
new, fully-specified cross-cutting requirement. Concretely:

| Section | Change |
| ------- | ------ |
| **§9.2.9** | **NEW** — the complete per-role reasoning-level spec: vocabulary, per-role env vars + defaults, resolution, harness translation, fail-fast validation, acceptance criteria. |
| **§6.1** | Breakdown reasoning budget rewritten: was "maximum budget (xhigh equivalent)" → now "a per-role setting defaulting to **`high`** (configurable `off`/`minimal`/`low`/`medium`/`high`/`xhigh`); see §9.2.9." The "demand write" retry uses the same level. |
| **§9.2.2** | **NEW subsection** — "Reasoning Configuration": five `PRP_REASONING_<ROLE>` env vars with their defaults and the valid-levels note ("a value outside this set is a hard startup error"). |
| **§9.2.3** | Model Selection rewritten to state explicitly that **model and reasoning are two independent axes**; each role's default reasoning level is cited (`high`/`high`/`high`/`high`/`off`). The role→tier **model** mapping is unchanged. |
| **§9.5** | Implementation Roadmap gains a bullet: resolve `PRP_REASONING_<ROLE>` per agent identity, validate against the vocabulary (hard startup error on invalid), forward the level into each agent config composed with — and independent of — the tier model. |
| **§9.7.5** | Schema table gains five `[reasoning]` keys; a mapping-semantics bullet states `[reasoning]` keys are independent of `[models]` keys; both the example project `.hack` and example `.hack.local` gain a `[reasoning]` block. |

**Nothing was removed.** This is purely additive + the three default changes
documented in §9.2.9's "Behavior change vs. the prior hard-wired design"
(research roles `xhigh`→`high`; research "normal"→explicit `high`;
implementation model-default→explicit `off`). All prior capability is
retained — `xhigh` remains available everywhere via explicit config.

## 2. The Requirement (PRD §9.2.9, summarized — full text is authoritative)

1. **Decoupling.** A role's effective agent config is the composition of its
   **model** (resolved from its tier, §9.2.3) and its **reasoning level**
   (resolved per §9.2.9). Tuning either axis must never perturb the other.

2. **Vocabulary.** The reasoning level is one of (case-insensitive):
   `off`, `minimal`, `low`, `medium`, `high`, `xhigh` (`xhigh` = maximum).

3. **Per-role env vars + defaults.** Each role is controlled by exactly one
   env var; the suffix names the agent identity it controls:

   | Role | Env var | Default | Rationale |
   | ---- | ------- | ------- | --------- |
   | Research / PRP (`AGENT`) | `PRP_REASONING_AGENT` | `high` | analysis-heavy; strong reasoning improves PRP quality |
   | Task decomposition (`BREAKDOWN_AGENT`) | `PRP_REASONING_BREAKDOWN_AGENT` | `high` | synthesizing the strict hierarchy is reasoning-intensive |
   | Bug finder (`BUG_FINDER_AGENT`) | `PRP_REASONING_BUG_FINDER_AGENT` | `high` | adversarial analysis; weak reasoning misses bugs |
   | Validation (`VALIDATION_AGENT`) | `PRP_REASONING_VALIDATION_AGENT` | `high` | validating against the full PRD rewards strong reasoning |
   | Implementation / codegen (`IMPL_AGENT`) | `PRP_REASONING_IMPL_AGENT` | `off` | executes a complete PRP contract; reasoning off is faster/cheaper and removes the need to drop model tiers to disable thinking |

4. **Resolution.** Each `PRP_REASONING_<ROLE>` resolves through the §9.2.1
   layer stack (`.hack` `[reasoning]` keys seed these env vars; real shell env
   overrides per the env-over-file rule). No layer → built-in default above.
   An **empty / whitespace-only** value is treated as "unset" and falls back
   to the default; an empty value is never forwarded to the harness. A
   user-set value is authoritative.

5. **Harness translation.** The resolved level is forwarded into the agent
   config and translated by the harness: `pi` maps it to its `--thinking
   <level>` argument; `claude-code` maps it to its extended-thinking budget.

6. **Validation (fail-fast).** A value outside the vocabulary
   (`PRP_REASONING_AGENT=ultra`, `[reasoning] impl_agent = "yes"`) is a **hard
   startup error**: the loader MUST abort, before any session is created or
   agent invoked, with an actionable message naming the offending key, the
   value, and the accepted levels. (Mirrors §9.2.7 / §9.7.7 fail-fast discipline.)

7. **`.hack` exposure.** The five levels are exposed as `[reasoning] agent`,
   `[reasoning] breakdown_agent`, `[reasoning] bug_finder_agent`,
   `[reasoning] validation_agent`, `[reasoning] impl_agent` (§9.7.5), each
   seeding its `PRP_REASONING_*` env var. They are **independent of** the
   `[models]` keys.

## 3. Integration With the Existing Codebase (Research Notes)

The previous session (012) did not touch reasoning; its architecture research
(`plan/012_7dd502f7feb9/architecture/`) is background only. The integration
points for this delta live in `src/agents/agent-factory.ts`, `src/config/`,
and the callers of the agent factories. Verified facts that shape the work:

- **The `ThinkingLevel` vocabulary must be reconciled.** The current type is
  `'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'` (`agent-factory.ts`).
  PRD §9.2.9 mandates `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`.
  The implementation **adds `minimal`** and **drops `max`** (no current caller
  sets `max`; dropping it is safe, but any reference must be updated).

- **Reasoning is currently a role-level constant, not per-agent-identity.**
  `ModelRole = 'research' | 'reasoning' | 'implementation'` and
  `ROLE_CONFIG` collapse the three reasoning identities (breakdown /
  bug-finder / validation) into one shared `'reasoning'` role pinned to
  `xhigh`. §9.2.9 requires **five separately-configurable levels** keyed by
  agent identity, so the role→level mapping must move from a static
  `ROLE_CONFIG` to per-identity resolution from `PRP_REASONING_*`.

- **The QA persona is shared by bug-finder AND validation.** `createQAAgent()`
  is called by `bug-hunt-workflow.ts` (bug-finder), `validation-workflow.ts`
  (validation), and `delta-analysis-workflow.ts`. §9.2.9 gives bug-finder and
  validation **separate** reasoning levels. The factory therefore needs a way
  to receive the role identity (e.g. an argument / caller-supplied level) so
  the two callers resolve distinct `PRP_REASONING_*` values. The
  delta-analysis caller's role assignment is an implementation decision
  (research-leaning; pick the closest §9.2.9 role and document it).

- **The `thinking` field is a declarative marker today; the harness seam is
  partial.** Groundswell's shared `HarnessOptions` does **not** model a
  thinking field, and the `pi` harness does not currently wire `--thinking`
  (`claude-code` exposes `maxThinkingTokens`). §9.2.9 asserts the harness
  honors the level. The pipeline MUST at minimum resolve, validate, and store
  the per-role level on each agent config correctly; wiring it through to the
  harness proceeds as far as the Groundswell seam allows (a potential
  cross-repo change against `~/projects/groundswell`, analogous to the
  `auth.json` contract change in §9.2.6 — note it as a dependency, do not
  block the config work on it).

## 4. Suggested Breakdown

**One phase, two milestones.** This is a focused, cohesive change; do not
inflate it.

### Phase P1 — Per-Role Reasoning Level

#### Milestone P1.M1 — Reasoning Config & Agent Wiring (the feature)

**Task P1.M1.T1 — Config constants, vocabulary, getters & fail-fast validation**
- Add the five env-var name constants, a `ReasoningLevel` type / vocabulary
  array (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`), and five getters
  (`getReasoningAgent`, `…Breakdown`, `…BugFinder`, `…Validation`, `…Impl`),
  each case-insensitive with its §9.2.9 default and empty-value → default
  fallback, in `src/config/constants.ts`. Add a shared validator used by both
  the env path and the `.hack` path that hard-errors on an out-of-vocabulary
  value (naming the key, value, and accepted levels).
- Reconcile the existing `ThinkingLevel` in `agent-factory.ts`: **add
  `minimal`, drop `max`**, updating the JSDoc and any reference. Map the
  pipeline type to the §9.2.9 vocabulary verbatim.
- **Mode A docs:** `.env.example` gains a "Reasoning Levels (PRD §9.2.9)"
  subsection documenting the five vars and the six valid levels; JSDoc on the
  new getters/validator following the existing `getValidationAgent()` /
  `getBugFinderAgent()` pattern.

**Task P1.M1.T2 — `.hack` schema wiring**
- Add the five `[reasoning]` keys to `SCHEMA_MAP` (section `reasoning`, with
  `acceptedValues` for the vocabulary) and a `reasoning` section to
  `HACK_CONFIG_SCHEMA` (enum-constrained) in `src/config/hack-config.ts`.
  `HACK_KEY_TO_ENV` is derived — do not hand-edit it. The out-of-vocabulary
  value is already a hard error via the enum in `HACK_CONFIG_SCHEMA`; ensure
  the message is actionable (§9.7.7).
- Update the `hack config init` template to emit a commented `[reasoning]`
  block matching the PRD's example `.hack`.
- **Mode A docs:** none beyond the template (the schema is self-describing);
  note the `[reasoning]`-independent-of-`[models]` invariant in JSDoc.

**Task P1.M1.T3 — Agent-factory composition (decouple model from reasoning)**
- Replace the static role→`thinking` pin in `ROLE_CONFIG` with per-identity
  resolution: each factory resolves its `PRP_REASONING_<ROLE>` getter and
  composes the resolved level onto its config **independent of** the tier
  model (`createArchitectAgent`→breakdown, `createResearcherAgent`→agent,
  `createCoderAgent`→impl). The role→tier **model** mapping is unchanged.
- Resolve the shared-QA-persona split so `BUG_FINDER_AGENT` and
  `VALIDATION_AGENT` resolve **separate** levels (e.g. `createQAAgent` accepts
  the identity/level, or the two workflows pass it). Assign the
  delta-analysis caller a documented role.
- Apply the new defaults everywhere they are surfaced (`xhigh` pins in
  `agent-factory.ts` JSDoc/comments and the `ROLE_CONFIG` literal move to the
  §9.2.9 defaults; `constants.ts`/prompt JSDoc referencing "xhigh" for
  reasoning roles are updated to "high (default) / configurable, §9.2.9").
  **Mode A docs:** JSDoc on each factory documenting its role's reasoning
  knob and default.

**Task P1.M1.T4 — Startup fail-fast integration**
- Run the reasoning-level validation on the startup path (after `.hack` load
  / env resolution, before any agent is created), so an invalid level aborts
  with exit 1 and an actionable message — no session created, no agent
  invoked. Reuse the validator from T1; integrate alongside the existing
  §9.2.7 preflight / §9.7.7 `.hack` validation discipline.
- `hack config show --src` reports each role's resolved reasoning level with
  its winning source layer (extend the existing effective-config reporter).

#### Milestone P1.M2 — Sync Changeset-Level Documentation (Mode B)

Cross-cutting docs that only make sense once the whole feature lands; depends
on every subtask in P1.M1.

**Task P1.M2.T1 — Sync changeset-level docs**
- `docs/CONFIGURATION.md`: add the five `PRP_REASONING_*` env-var rows; add
  the five `[reasoning]` keys to the `.hack` mapping table; document the
  two-independent-axes model (model vs. reasoning), the vocabulary, the
  defaults, the empty-value and fail-fast behavior, and the §9.2.9 behavior
  change (`xhigh`→`high`, impl default `off`).
- `docs/ARCHITECTURE.md`: extend the agent/model section to describe
  per-role reasoning as an axis orthogonal to model tier; note the defaults
  and the QA-persona-shared-by-bug-finder-and-validation resolution.
- `README.md`: wherever agent/model configuration is summarized, mention that
  reasoning level is now independently configurable per role (link to
  CONFIGURATION for the vocabulary/defaults).
- **Do NOT edit** `PRD.md`, `tasks.json`, `prd_snapshot.md`, `PROMPTS.md`.

## 5. Acceptance Criteria (from PRD §9.2.9)

- A user sets `PRP_REASONING_IMPL_AGENT=off` (or `[reasoning] impl_agent =
  "off"` in `.hack`) and the implementation agent runs with extended thinking
  disabled while still on its configured (strong) model — confirming reasoning
  is decoupled from model selection.
- With no reasoning config present, the five roles resolve to
  `high` / `high` / `high` / `high` / `off` (research / breakdown /
  bug-finder / validation / implementation).
- `PRP_REASONING_VALIDATION_AGENT=xhigh` overrides validation to the maximum;
  `PRP_REASONING_AGENT=medium` lowers research to medium; other roles keep
  their defaults. Bug-finder and validation resolve **independently**.
- An empty value (`PRP_REASONING_AGENT=""`) is treated as unset and falls back
  to the role default; it is never forwarded to the harness.
- An invalid value (`PRP_REASONING_AGENT=ultra`,
  `[reasoning] impl_agent = "loud"`) aborts at startup with exit code 1,
  naming the key, value, and accepted levels, before any session is created or
  agent invoked.
- `hack config show --src` reports each role's resolved reasoning level
  together with its winning source layer.
- The `ThinkingLevel` vocabulary is `'off' | 'minimal' | 'low' | 'medium' |
  'high' | 'xhigh'` (`minimal` present, `max` absent), and every reference to
  the old vocabulary is updated.

## 6. Out of Scope

- Changing the role→**tier** (model) mapping (unchanged by this delta).
- The §9.2.8 provider-neutral naming / `ANTHROPIC_*` deprecation (already
  specified; not touched here).
- Any harness-side `--thinking` wiring that requires a Groundswell API change
  is noted as a cross-repo dependency (§3), not implemented as a hacky-hack
  feature beyond what the seam allows.