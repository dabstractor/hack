/**
 * Effective-PRD resolution shared by the read-only inspection subcommands
 * (`hack artifacts`, `hack cache`, `hack inspect`, `hack validate-state`) so
 * they honor `.hack [cli] prd` exactly like the main pipeline path.
 *
 * @module
 */

import { resolve } from 'node:path';
import { loadHackConfig } from '../config/hack-config.js';
import { bootstrapRepoRoot } from '../utils/repo-root.js';

/**
 * Resolve the effective PRD entry path for a subcommand, honoring `.hack [cli] prd`
 * (PRD §9.7.5 / §9.8.7 — "All subcommands benefit automatically").
 *
 * @remarks
 * Mirrors the resolution the main pipeline path performs in `main()` (see
 * `src/index.ts`): after the §9.8 `chdir` to the repo root, `main()` calls
 * `loadHackConfig(repoRoot)` then `applyHackCliDefaults()`, which applies the
 * `.hack` `[cli] prd` value to the pipeline's `--prd` flag (defaulting to
 * `./PRD.md`). The four read-only subcommands run their `.action()` bodies
 * inside `program.parse()` — before `main()` loads `.hack` — and previously
 * hard-coded `resolve('PRD.md')`, throwing `SessionFileError` for any project
 * whose spec lives elsewhere (e.g. this repo's own `spec/SPEC.md`).
 *
 * This helper closes that gap: it loads `.hack` from the repo root (already
 * established by the `preAction` `bootstrapRepoRoot` hook) and returns the
 * `cli.prd` value resolved against the repo root, falling back to
 * `<repoRoot>/PRD.md`. A relative `.hack` value is repo-root-relative (not
 * process-cwd-relative) per §9.7.5/§9.8.
 *
 * When not inside a git repository (e.g. a unit test instantiating a command
 * class directly in a temp dir), `bootstrapRepoRoot` throws
 * `NotARepositoryError`; this helper then falls back to the legacy
 * `resolve(process.cwd(), 'PRD.md')` default so command construction never
 * crashes outside a repo. In a real `hack` invocation the repo root is always
 * resolvable, so the fallback path is never taken in production.
 *
 * @param overrideRepoRoot - Optional explicit repo root (testing/direct-call);
 *   when provided, `.hack` is loaded from it without bootstrapping.
 * @returns Absolute path to the effective PRD entry file.
 */
export function resolveEffectivePrd(overrideRepoRoot?: string): string {
  // When invoked from a CLI subcommand action, the `preAction` hook already
  // bootstrapped the repo root. When a command class is instantiated directly
  // (e.g. integration tests), ensure it is resolved first. Idempotent.
  let repoRoot: string;
  if (overrideRepoRoot !== undefined) {
    repoRoot = overrideRepoRoot;
  } else {
    try {
      repoRoot = bootstrapRepoRoot(process.cwd());
    } catch {
      // Not inside a git repo (e.g. a unit test in a temp dir): fall back to the
      // legacy cwd-relative PRD default so construction never crashes outside a repo.
      return resolve(process.cwd(), 'PRD.md');
    }
  }
  const merged = loadHackConfig(repoRoot);
  const cliPrd = merged.cli?.prd;
  if (typeof cliPrd === 'string' && cliPrd.length > 0) {
    // Repo-root-relative per §9.7.5/§9.8 (repoRoot, not process.cwd()).
    return resolve(repoRoot, cliPrd);
  }
  return resolve(repoRoot, 'PRD.md');
}
