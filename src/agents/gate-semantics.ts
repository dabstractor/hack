/**
 * Gate Semantics — Conservative negated file-existence gate detector
 *
 * @module agents/gate-semantics
 *
 * @remarks
 * Pure predicate that detects the unambiguous negated file/directory-existence
 * gate forms so that `#runValidationGates` can neutralize them at runtime
 * (PRD §9.9.2 REQ-G2).
 *
 * Returns `true` ONLY for:
 *   - Leading bang before `test`/`[`:   `! test -f X`, `! [ -e X ]`
 *   - Inner bang inside `test`/`[`:     `test ! -f X`, `[ ! -d X ]`
 *
 * where the flag is one of the POSIX existence flags: `-f` (regular file),
 * `-e` (exists), `-d` (directory).
 *
 * Returns `false` for everything else (negated content, positive checks,
 * unrelated commands, ambiguous expressions) per G2.2/G2.3 — when unsure,
 * return `false` so the executor runs the gate normally.
 */

// Leading negation: `! test -f X` or `! [ -e X ]`
const LEADING_NEGATED_EXISTENCE = /^\s*!\s+(?:test|\[)\s+-[fed]\b/;

// Inner negation: `test ! -f X` or `[ ! -d X ]`
const INNER_NEGATED_EXISTENCE = /^\s*(?:test|\[)\s+!\s+-[fed]\b/;

/**
 * Returns `true` only for unambiguous negated file/directory-existence gate
 * commands (PRD §9.9.2 G2.1). Returns `false` for negated content checks
 * (G2.2), ambiguous commands, and anything else (G2.3 — conservative default).
 *
 * @param command - The raw shell command string to inspect.
 * @returns `true` if the command is a negated existence gate; `false` otherwise.
 */
export function isNegatedFileExistenceGate(command: string): boolean {
  if (typeof command !== 'string' || command.trim() === '') return false;
  return (
    LEADING_NEGATED_EXISTENCE.test(command) ||
    INNER_NEGATED_EXISTENCE.test(command)
  );
}
