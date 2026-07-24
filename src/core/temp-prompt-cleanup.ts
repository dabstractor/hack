/**
 * (Mode A — module header) PRD §9.3.3 "Prompt Delivery (no argv-size limit)" —
 * TEMP-FILE CLEANUP HALF. The argv half is `src/agents/prompt-delivery.ts`
 * (P3.M2.T6.S1); this module is the temp-file-cleanup half.
 *
 * @remarks
 * PRD §9.3.3 mandates:
 *   "Any temp files backing these prompts MUST be cleaned up on both graceful
 *    and hard-killed (SIGTERM/SIGKILL/power-loss) exits. When a temp file backs
 *    a retry loop, it MUST be (re-)written on *every* attempt: if the agent or
 *    the system cleans `/tmp` mid-run, a write-once temp file fails forever on
 *    every later retry, whereas re-writing is cheap and makes retries resilient."
 *
 * AUDIT RESULT (P3.M2.T6.S2 — see
 * `plan/008_15504f60a0ef/P3M2T6S2/research/01_summary.md` §VERDICT and
 * `plan/008_15504f60a0ef/P3M2T6S1/PRP.md`): NO temp file backs any agent prompt
 * today. Every prompt flows `Prompt.buildUserMessage()` → `HarnessRequest.prompt`
 * → the in-process harness SDK (Pi: `session.prompt(request.prompt)` at
 * `node_modules/groundswell/dist/harnesses/pi-harness.js:245`; Claude-Code:
 * `sdk.query({prompt})` at `claude-code-harness.js:393`). Programmatic delivery
 * needs no temp file. The companion sentinel `isPromptDeliveryProgrammatic`
 * (from `src/agents/prompt-delivery.ts`) is asserted `true` in the regression
 * test to tie the two §9.3.3 halves together.
 *
 * This module is therefore PREVENTIVE INFRASTRUCTURE: a module-level registry +
 * exit/signal handlers (mirroring `src/core/file-lock.ts` verbatim in structure)
 * ready for any future temp-file-backed prompt, plus a retry-aware write helper
 * (`writeTempPromptFile`) that re-writes + registers on EVERY call (PRD §9.3.3
 * retry clause). At steady state the registry is empty, so the cleanup handlers
 * iterate an empty `Set` and the `exit`/signal registrations are harmless no-ops.
 *
 * SIGKILL / POWER-LOSS LIMITATION (PRD §9.3.3 — best-effort): signal handlers do
 * NOT fire on SIGKILL/OOM/segfault/power-loss, so cleanup for those exits is
 * best-effort. The primary mitigation is re-write-on-every-attempt
 * (`writeTempPromptFile` writes a fresh file each call, so a stale leak from an
 * uncatchable kill is superseded by the next attempt's fresh file — making the
 * leak harmless). This matches the `file-lock.ts` precedent: its PID+mtime
 * stale-lock detector handles SIGKILL for locks; for temp-prompt files the
 * re-write design + the empty-at-steady-state registry make a stale leak
 * harmless today, and the design makes it harmless for the future too.
 */

import { unlinkSync, writeFileSync } from 'node:fs';

/**
 * Module-level registry of temp-prompt-file paths currently tracked by THIS
 * process, for best-effort cleanup on graceful exit / signal handlers. Mirrors
 * `src/core/file-lock.ts`'s `_heldLockPaths`. The registry is mutated in
 * symmetric add/delete pairs (`registerTempPromptFile` / `unregisterTempPromptFile`).
 *
 * @internal
 */
const _trackedTempPromptFiles = new Set<string>();

/**
 * Idempotent, never-throwing unlink. Mirrors `file-lock.ts`'s `tryUnlink`.
 * Swallows ALL errors (ENOENT race, EACCES) so cleanup can run twice (signal →
 * `exit`) safely. The `exit` event fires AFTER a signal handler's
 * `process.exit()`, so {@link cleanupTrackedTempPromptFiles} runs TWICE —
 * `tryUnlink` swallowing ENOENT + the Set being cleared on the first run make
 * the second run a safe no-op.
 *
 * @param path - Absolute path of the file to remove.
 * @returns `true` if the file was removed; `false` if it was already gone (or
 *          could not be removed).
 */
function tryUnlink(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    // already gone / no permission — fine; file is effectively cleaned.
    return false;
  }
}

/**
 * Register a temp-prompt-file path for exit/signal cleanup. Idempotent re-add
 * (a `Set` dedupes). PRD §9.3.3. Symmetric with
 * {@link unregisterTempPromptFile}.
 *
 * @param path - Absolute path of the temp-prompt-file to track.
 */
export function registerTempPromptFile(path: string): void {
  _trackedTempPromptFiles.add(path);
}

/**
 * Unregister a temp-prompt-file path. Idempotent re-delete (safe to call on an
 * untracked path; a `Set.delete` on a missing key is a no-op). Does NOT unlink
 * the file — the caller unlinks explicitly or relies on
 * {@link cleanupTrackedTempPromptFiles}. PRD §9.3.3.
 *
 * @param path - Absolute path of the temp-prompt-file to stop tracking.
 */
export function unregisterTempPromptFile(path: string): void {
  _trackedTempPromptFiles.delete(path);
}

/**
 * Whether `path` is currently tracked by the registry. Test introspection.
 *
 * @param path - Absolute path to query.
 * @returns `true` if `path` is currently tracked.
 */
export function isTempPromptFileTracked(path: string): boolean {
  return _trackedTempPromptFiles.has(path);
}

/**
 * Unlink every tracked temp-prompt-file and clear the registry. Idempotent — a
 * second call iterates an empty `Set` and `tryUnlink` swallows ENOENT. Called by
 * all three handlers (`process.on('exit'/'SIGINT'/'SIGTERM')`). Mirrors
 * `file-lock.ts`'s `cleanupHeldLocks` (with a `Set.clear` to make the
 * load-bearing double-cleanup case — `exit` firing after a signal handler's
 * `process.exit()` — a safe no-op).
 *
 * Does NOT help for SIGKILL/OOM/segfault/power-loss — signal handlers do NOT
 * fire there (best-effort, PRD §9.3.3). Re-write-on-every-attempt
 * ({@link writeTempPromptFile}) is the primary mitigation for those cases.
 *
 * @internal
 */
export function cleanupTrackedTempPromptFiles(): void {
  for (const p of _trackedTempPromptFiles) {
    tryUnlink(p);
  }
  _trackedTempPromptFiles.clear();
}

/**
 * Signal/exit handler: clean up tracked temp-prompt-files, then exit with `code`.
 * Injectable `mockExit` (defaults to `c => process.exit(c)`, a function EXPRESSION
 * that re-resolves `process.exit` at call time so a `vi.spyOn(process,'exit')`
 * test is hit — keep that default exactly). Mirrors `file-lock.ts`'s
 * `onLockCleanupSignal`.
 *
 * @param code - Process exit code to pass through (128 + signum: 130 = SIGINT,
 *               143 = SIGTERM — shell convention).
 * @param mockExit - Injectable exit hook for testability (default re-resolves
 *                   `process.exit` at call time).
 * @internal
 */
export function onTempCleanupSignal(
  code: number,
  mockExit: (code: number) => void = c => process.exit(c)
): void {
  cleanupTrackedTempPromptFiles();
  mockExit(code);
}

/**
 * Registered SIGINT handler: clean up then exit 130 (128 + SIGINT=2). Named
 * wrapper (NOT an inline arrow in `process.on`) so the registration site is
 * coverable — mirrors `file-lock.ts`'s `onSIGINTCleanup`. @internal
 */
export function onTempSIGINTCleanup(): void {
  onTempCleanupSignal(130);
}

/**
 * Registered SIGTERM handler: clean up then exit 143 (128 + SIGTERM=15). Named
 * wrapper (NOT an inline arrow in `process.on`) so the registration site is
 * coverable — mirrors `file-lock.ts`'s `onSIGTERMCleanup`. @internal
 */
export function onTempSIGTERMCleanup(): void {
  onTempCleanupSignal(143);
}

// Module-load registration (ONCE per process; mirrors file-lock.ts:613-615).
// NO `process.off` — the handlers outlive every run; removing them would
// re-introduce the leak on the next run. vitest `pool:'forks'` isolates these
// registrations to this module's fork, so they do NOT pollute other test files.
process.on('exit', cleanupTrackedTempPromptFiles);
process.on('SIGINT', onTempSIGINTCleanup);
process.on('SIGTERM', onTempSIGTERMCleanup);

/**
 * (Re-)write a temp-prompt-file and register it for exit/signal cleanup. PRD
 * §9.3.3 retry clause: ALWAYS re-writes + re-registers on EVERY call, so a retry
 * loop using this helper re-writes the temp file on every attempt (survives a
 * `/tmp` mid-run sweep — a write-once temp file fails forever after a sweep,
 * whereas re-writing is cheap and makes retries resilient). Use inside a
 * `retryAgentPrompt` factory:
 *
 * ```ts
 * retryAgentPrompt(async () => {
 *   const p = await writeTempPromptFile(tmpPath, prompt); // fresh file every attempt
 *   return deliverViaTempFile(p);
 * }, ctx);
 * ```
 *
 * Does NOT unregister (the exit/signal handlers clean up). Returns `targetPath`
 * for chaining.
 *
 * @param targetPath - Absolute path of the temp-prompt-file to (re-)write.
 * @param content - Prompt content to write.
 * @returns `targetPath` (for chaining).
 */
export async function writeTempPromptFile(
  targetPath: string,
  content: string
): Promise<string> {
  writeFileSync(targetPath, content, { mode: 0o644 });
  registerTempPromptFile(targetPath);
  return targetPath;
}
