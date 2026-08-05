# <repoRoot>/.hack — team-wide PRP pipeline defaults for hacky-hack.
#
# This file is the version-controllable configuration channel (PRD §9.7). It is safe to
# commit: secret-bearing keys are refused here and MUST live in `.hack.local` (§9.7.6).
# Effective config = global (~/.hack) → this file → .hack.local → .env → shell env → CLI
# flags, each layer overriding the one below (§9.2.1).
#
# Inspect the resolved configuration with:  hack config show --src

# ---------------------------------------------------------------------------
# Agent runtime + model tiers (PRD §9.1 / §9.2.3 / §9.4).
# pi is the vendor-neutral, first-class default; z.ai is the default provider.
# ---------------------------------------------------------------------------
[harness]
name = "pi"

[models]
high     = "glm-5.2"     # Architect / breakdown (max reasoning budget)
balanced = "glm-5.2"     # planning & research roles
fast     = "glm-5-turbo" # implementation role

# ---------------------------------------------------------------------------
# Distributed-PRD include expansion (PRD §2.3).
# ---------------------------------------------------------------------------
[distributed_prd]
include_max_depth = 10
include_markers   = false

# ---------------------------------------------------------------------------
# Pipeline behavior (PRD §4.2 / §4.4 / §5.1).
# ---------------------------------------------------------------------------
[pipeline]
parallel_research = false
research_depth    = 2
commit_format     = "task-prefix"

[validation]
timeout_seconds = 7200

# ---------------------------------------------------------------------------
# CLI defaults (PRD §9.7.5). Override per-invocation with the matching flag.
#
# `prd` is the canonical specification entry point. hacky-hack's PRD is authored as a
# *distributed* spec: the canonical document is assembled from the files in spec/ by
# @-include directives, with spec/SPEC.md as the entry file (PRD §2.3). Pointing the
# pipeline here makes a bare `hack` run load the split spec instead of the legacy root
# ./PRD.md. Repo-root-relative (§9.7.5 / §9.8), overridden by an explicit `--prd <path>`.
# ---------------------------------------------------------------------------
[cli]
prd       = "spec/SPEC.md"
mode      = "normal"
log_level = "info"