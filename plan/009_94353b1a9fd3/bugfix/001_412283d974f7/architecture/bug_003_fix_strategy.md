# BUG-003 Fix Strategy — Enforce Relational Constraint

## Problem

PRD §9.7.5 specifies `[commit] retry_delay_cap_ms` as "int ≥ retry_delay_ms" (the
exponential-backoff cap must be at least the base delay). The validation schema
(`HACK_CONFIG_SCHEMA`) validates `retry_delay_cap_ms` only as `int >= 0`, so a config with
`retry_delay_ms = 200000` and `retry_delay_cap_ms = 100` passes validation despite violating
the documented constraint.

The gap is acknowledged in two code comments:
- JSDoc on `HACK_CONFIG_SCHEMA` (`hack-config.ts:602-603`)
- Inline on the field spec (`hack-config.ts:625`)

## Fix: Post-Per-Key Relational Check in `validateHackTier`

### Why `validateHackTier` (not `loadHackConfig`)

Both runtime paths funnel through `validateHackTier`:
1. **`hack config validate` CLI** — calls `validateHackTier` per file (NOT `loadHackConfig`).
2. **Real startup** — `loadHackConfig` calls `validateHackTier` per tier.

A check inside `validateHackTier` is the **only** single edit that fixes BOTH paths.

### Design

Add a post-per-key relational check at the END of `validateHackTier`, after the
section/key loop. The check fires when `section === 'commit'` and both keys are present in the
validated tier:

```ts
export function validateHackTier(
  parsed: ParsedHackConfig,
  file: string,
  tier: HackConfigTier
): void {
  for (const [section, keys] of Object.entries(parsed)) {
    // ... existing per-key validation (secrets, unknown, type/range/enum) ...
  }

  // ── Cross-key relational check (PRD §9.7.5: commit.retry_delay_cap_ms ≥ retry_delay_ms) ──
  // Both keys are individually valid (per-key checks above); verify their relationship.
  // Only fires when BOTH keys are present in THIS tier (a single-key tier is always valid).
  const commit = parsed.commit;
  if (
    commit &&
    commit.retry_delay_ms !== undefined &&
    commit.retry_delay_cap_ms !== undefined
  ) {
    const delay = commit.retry_delay_ms as number;
    const cap = commit.retry_delay_cap_ms as number;
    if (cap < delay) {
      throw new HackConfigError(
        `[commit] retry_delay_cap_ms in ${file}: ${cap} is less than retry_delay_ms (${delay}); the cap must be ≥ the base delay.`
      );
    }
  }
}
```

**Use `HackConfigError`** (from BUG-002) for the throw, so it renders cleanly via
`main().catch()`'s dedicated arm. If BUG-002 hasn't been implemented yet, use `Error` — the
message is the same; the rendering improvement is a separate concern.

### Error Message Style

Mirror the existing `validateFieldValue` style: `[section] key in file: ... is ...`.

Example output:
```
[commit] retry_delay_cap_ms in /repo/.hack: 100 is less than retry_delay_ms (200000);
the cap must be ≥ the base delay.
```

### Remove the "DOCUMENTED GAP" Comments

After implementing the check, update/remove:
1. `hack-config.ts:602-603` — JSDoc on `HACK_CONFIG_SCHEMA`: remove the "DOCUMENTED GAP" note.
2. `hack-config.ts:625` — inline comment on `retry_delay_cap_ms` field spec: update to note the
   cross-key check is now enforced in `validateHackTier`.

### Cross-Tier Limitation (Known, Accepted)

`validateHackTier` validates PER-TIER (per-file). If `retry_delay_ms` is in `.hack` and
`retry_delay_cap_ms` is in `.hack.local`, the per-tier check won't catch the violation (each
file looks fine alone). This is acceptable because:
- The bug report's reproduction is single-file.
- PRD §9.7.7 frames validation as per-file.
- The `hack config validate` CLI lints files independently by design.
- Defaults (10000 / 120000) satisfy the constraint.

### Files Changed

| File | Change |
|------|--------|
| `src/config/hack-config.ts` | Add relational check at end of `validateHackTier`; remove/update 2 gap comments |

### Dependencies

- **BUG-002** (`HackConfigError` class): If BUG-002 is implemented first, use `HackConfigError`
  for the throw. Otherwise use plain `Error` (the message is what matters). This subtask does
  NOT depend on BUG-002 functionally — only for clean rendering.

### Existing Tests (Pass Case)

`tests/unit/config/hack-config.test.ts:895-919` — existing test uses `retry_delay_ms = 1000`,
`retry_delay_cap_ms = 10000` (satisfies the constraint). This test continues to pass.