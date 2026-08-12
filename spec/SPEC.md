# Product Requirements Document: Autonomous PRP Development Pipeline

> **Distributed specification.** This file is the canonical entry point for the PRP
> Pipeline specification. The spec is authored across the sibling files in `spec/` and
> assembled here at load time: each line below that consists of only a path prefixed with
> the `@` character is an _include directive_ (§2.3) that is replaced inline by that file's
> contents, producing a single merged document that behaves identically to a monolithic PRD
> everywhere downstream. Agents receive the already-merged document and must not chase the
> includes themselves.

## Contents

1. [Executive Summary](01-executive-summary.md)
2. [Core Philosophy & Concepts](02-core-concepts.md)
3. [System Architecture](03-architecture.md)
4. [User Workflows](04-workflows.md)
5. [Functional Requirements](05-functional-requirements.md)
6. [Critical Prompts & Personas](06-prompts-personas.md)
7. [Rewrite Improvements & Bootstrap Roadmap](07-roadmap.md)
8. [Technical Specification — Overview & Stack](08-tech-spec-overview.md)
9. [Environment Configuration](09-environment-config.md)
10. [System Components (Groundswell Mapping)](10-system-components.md)
11. [Agent Harness System (Runtime Selection)](11-harness-system.md)
12. [Implementation Roadmap](12-impl-roadmap.md)
13. [Logging Architecture](13-logging.md)
14. [The `.hack` Configuration File](14-hack-config.md)
15. [Repository Root Resolution](15-repo-root.md)
16. [Validation Gate Semantics](16-validation-gates.md)
17. [Commit Generation & Agent Tool Safety](17-commit-tool-safety.md)

---

@01-executive-summary.md
@02-core-concepts.md
@03-architecture.md
@04-workflows.md
@05-functional-requirements.md
@06-prompts-personas.md
@07-roadmap.md
@08-tech-spec-overview.md
@09-environment-config.md
@10-system-components.md
@11-harness-system.md
@12-impl-roadmap.md
@13-logging.md
@14-hack-config.md
@15-repo-root.md
@16-validation-gates.md
@17-commit-tool-safety.md
