# Scout Findings — ARCHITECTURE.md Bootstrap-Layer Sync

Recon of `docs/ARCHITECTURE.md` (1080 lines) to scope adding a **Bootstrap Layer** section
(§8/§9.8/§9.7 ordering) and removing stale "must run from repo root" framing.
Findings verified against live source: `src/index.ts` (`main()`), `src/utils/repo-root.ts`,
`src/config/hack-config.ts`.

---

## 1. Full Heading Outline of `docs/ARCHITECTURE.md`

All `#`/`##`/`###` headings with line numbers (from grep):

```
1:   # Architecture Overview
11:  ## Table of Contents
26:  ## System Overview
30:    ### Design Philosophy
39:    ### High-Level Architecture            (mermaid flowchart)
67:    ### System Flow Description            (8-step runtime flow narrative, ends line 82)
84:  ## Resolved-Document Invariant (Distributed PRDs)
88:    ### Expansion Rules
99:    ### The Invariant: One Canonical Document Downstream
114: ## Four Core Processing Engines
118:   ### 1. Session Manager
124:     #### Responsibilities
132:     ##### Resolved-document invariant
136:     #### Key Methods
152:     #### Session Directory Structure
166:   ### 2. Task Orchestrator
172:     #### Responsibilities
180:     #### Key Methods
196:     #### Task Hierarchy
218:     #### Dependency Resolution
232:   ### 3. Agent Runtime
238:     #### Responsibilities
246:     #### Agent Types
258:     #### Tool System
279:   ### 4. Pipeline Controller
285:     #### Responsibilities
293:     #### Execution Flow                     (mermaid stateDiagram)
323: ## Groundswell Framework Integration
327:   ### @Workflow Decorator
353:   ### @Step Decorator
371:   ### @ObservedState Pattern
389:   ### Agent Creation
427:   ### Tool Registration
455:   ### Groundswell Caching
471: ## Multi-Agent Architecture
475:   ### Agent Personas
484:   ### Prompt Engineering
491:   # LEAD TECHNICAL ARCHITECT & PROJECT SYNTHESIZER   (NB: H1 mid-doc — pre-existing anomaly)
510:   ### Tool System (MCP)
514:     #### BashMCP
525:     #### FilesystemMCP
534:     #### GitMCP
543:   ### Validation Gates                       (mermaid graph)
599: ## Model Roles & Reasoning Budget            (markdown table)
613:   ### How `thinking` is wired
617:   ### Model strings are provider-qualified
621:   ### Canonical ↔ legacy environment variables
631: ## State Management and Persistence
635:   ### Session Directory Structure            (text/tree diagram)
667:   ### tasks.json Format
714:   ### PRD Hash-Based Change Detection
740:   ### Delta Sessions
789:   ### State Persistence Patterns
819:   ### tasks.json Protection & Smart Recovery
843:   ### Two-Phase Commit (Per-Item Survival)
854:   ### State Integrity Protections
867: ## Task Hierarchy and Execution Flow
871:   ### Four-Level Hierarchy
895:   ### DFS Traversal Algorithm
938:   ### Dependency Resolution
978:   ### Execution Flow Diagram
1028: ## Adopt Mode (--adopt-prd)
1038:   ### Guard Rails (PRD §4.6)
1049: ## See Also
1051:   ### Project Documentation
1060:   ### System Prompts
1064:   ### API Documentation
1068:   ### External References
```

### Recommended insertion point for the new section

**Primary: a new `## Bootstrap Layer` (or `## Bootstrap & Repository Root Resolution`) as a
new top-level `##` section inserted between line 82 (end of `### System Flow Description`) and
line 84 (`## Resolved-Document Invariant`).**

Rationale: The doc's runtime narrative currently *jumps* from the high-level flow ("1. PRD
Input → …") straight into the resolved-document invariant and the four engines, with **zero**
coverage of process startup. Bootstrap is the chronological first thing `main()` does, so a
section placed immediately after `## System Overview` (before the engines) reads as natural
"how the process starts up." It would sit as a sibling to the other `##` sections and should
also be added to the **Table of Contents** (lines 13–23) with a matching anchor.

Secondary option: insert right before `## Four Core Processing Engines` (line 114), framing
bootstrap as "what runs before the engines." Either is defensible; the line-82/84 split keeps
the System Overview narrative contiguous.

**Table of Contents** to update (add one bullet among lines 13–23), e.g. after the
`System Overview` bullet (line 13):
```
- [Bootstrap Layer](#bootstrap-layer)
```

---

## 2. Existing bootstrap / startup content — what exists (mostly nothing)

**ARCHITECTURE.md does NOT document the bootstrap sequence, `main()`, `parseCLIArgs`, the
repo-root resolver, the `.hack` loader, or `environment.ts` at all.** grep for
`main()|parseCLI|bootstrap|startup|entry point|index.ts|bin/|environment|.hack|src/config|src/utils`
returned only harness/model fragments. The closest existing "startup" content:

- **`docs/ARCHITECTURE.md:389-415` — `### Agent Creation`** (verbatim, lines 391-405):
  > Agents are created using Groundswell's `createAgent` function. At startup the
  > pipeline first configures the **harness** — the agent runtime/SDK — via
  > `configureHarnesses()`, selecting the runtime (`pi`, the vendor-neutral …
  > ```typescript
  > import { configureHarnesses, createAgent } from 'groundswell';
  > // 1. Configure the harness once at startup (harness ⟂ provider/model).
  > configureHarnesses({ … })
  > ```
  - This is the **only** structured startup content, and it covers just the harness-config
    step (one slice of the full bootstrap ordering). Note: source uses `configureHarness()`
    (singular) in `src/index.ts:242`, while the doc shows `configureHarnesses()` (plural) — a
    **name drift to flag**.

- **`docs/ARCHITECTURE.md:619` — `### Model strings are provider-qualified`** (verbatim):
  > Models are read at runtime (never hardcoded) and are **provider-qualified**
  > (`zai/glm-5.2`), **never harness-qualified** (`pi/zai/glm-5.2` is invalid). The harness
  > (`pi` / `claude-code`) is selected independently of the provider/model at startup — see
  > [Groundswell Framework Integration](#groundswell-framework-integration) and PRD §9.4.

- **`docs/ARCHITECTURE.md:621-627` — `### Canonical ↔ legacy environment variables`**: discusses
  the model env-var loader fallback + deprecation warning (PRD §9.2.8), but points the full
  table to `CONFIGURATION.md` ("ARCHITECTURE.md does not duplicate that table").

- **`docs/ARCHITECTURE.md:587`** ("Service startup validation") is about L3 integration tests,
  unrelated to process startup.

**Conclusion:** the new Bootstrap Layer section is **purely additive** — there is no existing
bootstrap/main() block to extend or rewrite. The harness-config prose at lines 391-415 should be
cross-referenced (and optionally trimmed so the new section owns "at startup"). Source
`configureHarnesses` → `configureHarness` drift noted.

---

## 3. Stale "must run from repo root" framing hunt — RESULT: none present

Targeted greps across `docs/ARCHITECTURE.md` (case-insensitive) for:
`must run from`, `run from the root`, `run from the repo root`, `run from anywhere`,
`current working directory`, `from the project root`, `cd into`, `chdir`, `repo root`,
`repository root`, `repo-root`, `assumed to be`, `invoke from`, `execute from`, `invoked from`,
`launched from`, `requires that you`, `ensure you are`, `working dir`.

### Matches in `docs/ARCHITECTURE.md`: exactly ONE

- **`docs/ARCHITECTURE.md:838`** (inside the `### tasks.json Protection & Smart Recovery` code
  block) — verbatim:
  ```typescript
  const result = await recoverTasksJson(
    sessionTasksPath,
    { itemId: currentItem.id, status: 'Complete' },
    { baselineBacklog: this.backlog, repoPath: process.cwd() }
  );
  ```
  **Not stale — actually correct.** `process.cwd()` here returns the **repo root** *because* of
  the bootstrap `process.chdir(repoRoot)` (`src/index.ts:146`). This is the intended
  "zero per-site changes" payoff of the §9.8 design. **Recommendation:** leave the code as-is;
  optionally add a one-line inline comment in the new Bootstrap section noting *why* every
  downstream `process.cwd()` is repo-root (the single chdir makes it so). No rewrite needed.

### Broader docs/ sweep (for awareness — out of strict ARCHITECTURE.md scope but task says
### "search docs/ARCHITECTURE.md"; this confirms the project has no such framing anywhere):
grep across all of `docs/` for `must run from|run from the root|run from the repo root|cd into
the (repo|root|project)|from the project root|run from within|run from inside the` → **No matches.**

**Net:** There is **no stale "must run from repo root" framing to remove** in ARCHITECTURE.md
(or docs/). The task's "ensure no stale framing remains" requirement is effectively a no-op
against current content — the work is *additive* (new section) plus a single accurate (non-stale)
`process.cwd()` reference to optionally annotate. **Severity: none (informational).**

---

## 4. House style — so the new section matches

### 4a. Section structure (every `##` section follows this):
1. `## Heading` (Title Case, often with parenthetical e.g. "Adopt Mode (--adopt-prd)").
2. One-sentence **bold** purpose statement naming the component + PRD cross-ref.
3. A `**Location**: [`src/...`](../src/...)` line (see Pipeline Controller line 281, Validation
   Gates pattern). The four engines all open with a `**Location**` line.
4. Subsections: `### Responsibilities` (bullet list of **bold lead-in**: description),
   `### Key Methods` (code-ish), embedded **mermaid** diagrams, and **blockquote callouts**.

### 4b. Diagrams — **mermaid is the house diagram format** (not raw ASCII). Three flavors in use:
- `flowchart LR` — `### High-Level Architecture` (lines 41-65), styled nodes (`style A fill:#e1f5e1`).
- `stateDiagram-v2` — `### Execution Flow` (lines 297-321, Pipeline Controller).
- `graph LR` — `### Validation Gates` (lines 547-571) with Pass/Fail branches.
- `text` fenced tree — `### Session Directory Structure` (lines 639-664) uses ```text blocks.

**New section should use a mermaid `flowchart TD`/`graph TD` for the bootstrap ordering**
(parseCLIArgs → repo-root+chdir → .hack load → env/harness/preflight → pipeline), matching the
Validation Gates `graph` style.

### 4c. Callouts — **markdown blockquotes** (`>`), not admonitions. Examples:
- `docs/ARCHITECTURE.md:625`:
  > **bash-pipeline equivalence (cross-ref only):** research = `pi`, reasoning = `pizr` …
- `docs/ARCHITECTURE.md:664`:
  > session-path shape is `plan/NNN_<hash>/bugfix/NNN_<hash>/` (PRD §5.1).
- `docs/ARCHITECTURE.md:6` (doc-level): `> Comprehensive overview of the PRP Pipeline …` (the
  abstract blockquote under the H1).

### 4d. Tables — GFM pipe tables, header + separator row. Example `docs/ARCHITECTURE.md:601-609`
(Model Roles): columns `Role | Tier | Reasoning budget | Pipeline agents`. A **bootstrap
ordering table** (Step | Action | Source | PRD §) would match this exactly.

### 4e. Code blocks — TypeScript fenced with inline `[`src/...`](../src/...)` links (e.g.
`src/agents/agent-factory.ts`, `src/core/file-lock.ts`, `src/core/session-utils.ts`). The new
section should link `src/utils/repo-root.ts`, `src/config/hack-config.ts`, `src/index.ts`.

### 4f. Section dividers: `---` horizontal rules separate top-level `##` sections (e.g. line 83,
322, 326, 598). Insert a `---` before/after the new `## Bootstrap Layer`.

---

## 5. Existing coverage of `src/config`, `src/utils`, config system, environment.ts

**None.** grep for `src/config|src/utils|config system|environment\.ts|\.hack` in ARCHITECTURE.md
returned **zero hits** for `src/config`, `src/utils`, `environment.ts`, and `.hack`.

What *does* exist (cross-ref targets, not duplication):
- **`docs/ARCHITECTURE.md:621` — `### Canonical ↔ legacy environment variables`** — model env
  fallback; defers the full table to `CONFIGURATION.md`.
- **`docs/ARCHITECTURE.md:391-415` — `### Agent Creation`** — `configureHarnesses()` harness
  config (the env/harness step of bootstrap).
- **`docs/ARCHITECTURE.md:84-112` — `## Resolved-Document Invariant`** — the *only* place a
  loader is named: `resolvePRD(prdPath)` in `src/core/session-utils.ts:110` (PRD includes, not
  `.hack` config).
- **`docs/ARCHITECTURE.md:625-627`** cross-refs `[Configuration → Model Roles](./CONFIGURATION.md#model-roles)`.

**Implication:** the new Bootstrap section will be the **first** place ARCHITECTURE.md
documents repo-root resolution and `.hack` layered config. It should *introduce* these, link to
`src/utils/repo-root.ts` + `src/config/hack-config.ts`, and cross-reference (not duplicate) the
harness-config prose at line 391 and the model-env section at 621. Defer the full `.hack` schema
table to `CONFIGURATION.md` (house pattern: "ARCHITECTURE.md does not duplicate that table," line 627).

---

## 6. PRD cross-reference style (for new § refs)

Canonical form observed throughout (20+ instances):
- **Inline parenthetical**: `(PRD §9.2.3)`, `(PRD §4.6)`, `(PRD §5.1)` — most common.
- **Compound slash**: `(PRD §9.2.3 / §6.1)` (line 601); `(PRD §4.4 / §5.1)` (line 643).
- **Mid-sentence**: `… (PRD §2.3) …` (line 86), `… (PRD §9.4) …` (line 619).
- **Step-qualified**: `(PRD §4.1 step 2)` (line 103), `(PRD §4.3 step 5/6.)` (line 776).
- **Heading inline**: `### Guard Rails (PRD §4.6)` (line 1038) — PRD ref inside an `###` title.

**For the new section, use:** `(PRD §8)`, `(PRD §9.8)` (repo-root/chdir — cite §9.8.2 traversal,
§9.8.3 chdir, §9.8.4 .git dir-or-file, §9.8.5 NotARepositoryError, §9.8.6 --repo-root explicit),
and `(PRD §9.7)` (`.hack` config — cite §9.7.3 tier discovery, §9.7.9 load-after-chdir, §9.2.1
env-over-file seeding). Matching the existing `§X.Y` precision (sub-section numbers) is house style.

---

## 7. Authoritative bootstrap ordering (from source — for the new section's content)

Verified directly from `src/index.ts:121` `async function main()`:

```
1. parseCLIArgs()                      src/cli/index.ts  (src/index.ts:123)
   - --help/--version/usage errors short-circuit (Commander process.exit) before repo-root work
   - inspect subcommand returns early (src/index.ts:127-131)
2. resolveRepositoryRoot(INVOCATION_CWD, {explicit: args.repoRoot})   src/utils/repo-root.ts:184
   + process.chdir(repoRoot)           src/index.ts:146   ← the single bootstrap chdir (§9.8.3)
3. existsSync(args.prd) PRD-exists check against the now-correct cwd   src/index.ts:153-157
4. setupGlobalHandlers(args.verbose)   src/index.ts:160
5. loadHackConfig(repoRoot)            src/config/hack-config.ts:940  (src/index.ts:165)
   - tiers: global → project(<repoRoot>/.hack) → project-local(<repoRoot>/.hack.local)  §9.7.3
   - global path: $HACK_CONFIG_HOME/config → $XDG_CONFIG_HOME/hack/config → ~/.hack  (hack-config.ts:528)
   - env-over-file seeding (seedProcessEnv) fills ONLY undefined env keys  §9.2.1
6. configureEnvironment()              src/index.ts:171   ← before any API op
7. getLogger('App', …)                 src/index.ts:174
8. (credential-free early returns) --dry-run (src/index.ts:193), --validate-prd (src/index.ts:210)
9. configureHarness()                  src/index.ts:242   (singular — doc shows plural drift)
10. runAuthPreflight()                 src/index.ts:251   §9.2.7 fail-fast auth
11. ensureHarnessInitialized()         src/index.ts:256
12. new PRPPipeline(...) + pipeline.run()   src/index.ts:281,297
13. main() resolves exit code (0/1/130); .then() honors it, .catch() renders typed errors
    (AuthPreflightError, HarnessProviderMismatchError, UnsupportedHarnessError,
     NotARepositoryError → one ❌ line + exit 1)   src/index.ts:356-410
```

Key resolver facts (for prose):
- `.git` matched as **directory OR file** (worktree/submodule `gitdir:` pointer) — §9.8.4.
- **Nearest** ancestor `.git` wins (inner repo beats outer) — §9.8.2.
- Root canonicalized via `realpathSync`; stored in process-global singleton (`getRepoRoot()`,
  `getInvocationCwd()`).
- `NotARepositoryError` fires **before** any session is created, `.hack`/`.env` read, or agent
  invoked (renders searched-from dir + `--repo-root <path>` remediation).

---

## Start Here

**Open `docs/ARCHITECTURE.md` lines 67-114 first** — that span (end of System Overview → start
of Four Core Processing Engines) is the insertion seam. The new `## Bootstrap Layer` goes at
**line 83** (currently the `---` separator before `## Resolved-Document Invariant`, line 84).
Use the mermaid `graph TD` + GFM table + `**Location**`/`(PRD §9.8)` patterns from §4 above and
the ordering from §7. Cross-reference (don't duplicate) harness config at line 391 and model-env
at line 621; add a ToC bullet at line 13. No stale-framing deletions are required (§3 — only the
accurate `process.cwd()` at line 838 exists).

---

## Supervisor coordination
None needed — task is a recon/report; findings are complete and self-contained.