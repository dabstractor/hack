# PRP — P1.M1.T2.S2: Case-insensitive `[reasoning]` enum validation + verify auto-derivation + repo `.hack` block

> Plan 013, PRD §9.2.9 (Per-Role Reasoning Level) → §9.7.5 (`.hack` schema). S1 (Implementing) wires the
> 5 `[reasoning]` SCHEMA_MAP entries + the `reasoning` HACK_CONFIG_SCHEMA section; its loader enum check
> is **case-sensitive**, so `[reasoning] agent = "HIGH"` THROWS today — violating PRD §9.2.9's
> case-insensitivity requirement. **T2.S2 makes the loader's enum check case-insensitive for
> `[reasoning]` keys only** (so `'HIGH'`/`'Off'` are accepted and normalized to the canonical lowercase
> token), then VERIFIES (test-only, no code change) that `hack config init` emits a `[reasoning]` block
> and `hack config show --src` reports reasoning rows — both auto-derived because `#buildTemplate` and
> `#showAction` iterate the S1-augmented `SCHEMA_MAP`. Optionally adds a commented `[reasoning]` block to
> the repo `./.hack`. Two surgical source edits + additive tests.

---

## Goal

**Feature Goal**: Make `.hack` `[reasoning]` enum validation case-insensitive (PRD §9.2.9 / §9.7.5) so a
value like `[reasoning] agent = "HIGH"` is accepted and the seeded `PRP_REASONING_AGENT` env var holds
the canonical lowercase token (`'high'`). The fix is GATED to the `reasoning` section so other enum keys
(`[harness] name`, `[cli] mode`, `[pipeline] commit_format`/`commit_style`) stay case-sensitive. Then
verify (test-only) that `hack config init` auto-emits a `[reasoning]` block and `hack config show --src`
auto-reports the 5 reasoning rows — consuming S1's SCHEMA_MAP additions through the existing
SCHEMA_MAP-iterating command code (no config.ts edit).

**Deliverable**:
1. **`src/config/hack-config.ts`** — EDIT `validateFieldValue` (case-insensitive enum comparison for
   `section === 'reasoning'`, preserving the original value in the §9.7.7 error message) AND
   `seedProcessEnv` (seed the canonical lowercase token for `section === 'reasoning'` string values).
2. **`tests/unit/config/hack-config.test.ts`** — EDIT (additive): a `[reasoning]` case-insensitive +
   normalization `describe` block (mirror the existing enum tests at L787/800/1085).
3. **`tests/unit/cli/commands/config.test.ts`** — EDIT (additive): verify `hack config init` emits a
   `[reasoning]` block + `hack config show --src` reports reasoning rows (auto-derived via SCHEMA_MAP).
4. **`./.hack`** (OPTIONAL, low priority) — add a commented `[reasoning]` block for discoverability.

**Success Definition**:
- `.hack [reasoning] agent = "HIGH"` → `loadHackConfig` does NOT throw AND
  `process.env.PRP_REASONING_AGENT === 'high'` (normalized to canonical lowercase).
- `.hack [reasoning] impl_agent = "Off"` → does NOT throw AND
  `process.env.PRP_REASONING_IMPL_AGENT === 'off'`.
- `.hack [reasoning] impl_agent = "loud"` → STILL throws the §9.7.7 `HackConfigError` (genuinely
  out-of-vocab; S1's existing test stays GREEN).
- Other enum keys remain case-sensitive: `[harness] name = "PI"` still throws (unchanged behavior).
- `hack config init` emits a `[reasoning]` block with the 5 keys (auto-derived — no config.ts edit).
- `hack config show --src` reports the 5 reasoning rows with source attribution (auto-derived).
- `npm run typecheck && npm run lint && npm run format:check` clean; affected test suites green.

---

## Why

- **PRD §9.2.9 / §9.7.5 mandate case-insensitive `[reasoning]` values.** The schema-row type is
  `off|minimal|low|medium|high|xhigh` and §9.2.9 says the vocabulary "is one of (case-insensitive)". The
  loader's case-sensitive enum check (`!spec.enum.includes(value)`) violates this — a user who writes
  `[reasoning] agent = "HIGH"` (natural capitalization) gets a hard startup error. T2.S2 closes that gap.
- **Normalizes to the canonical token.** PRD §9.7.5's mapping semantics describe `[reasoning]` values as
  "case-insensitive members … (→ 'high')". T2.S2 seeds the canonical lowercase form so the env var (and
  the downstream getter) hold `'high'`, not the raw `'HIGH'`.
- **Scope discipline — touch ONLY `[reasoning]`.** Other enums are NOT specified case-insensitive, and
  `[harness] name` feeds `configureHarness()`/`SUPPORTED_HARNESSES` validation. Making the comparison
  case-insensitive globally would be an unrequested behavior change with its own downstream surface.
  Gating on `section === 'reasoning'` is the precise, low-risk fix.
- **Auto-derivation is free (verify, don't build).** S1 adds the 5 `SCHEMA_MAP` entries; `#buildTemplate`
  and `#showAction` already iterate `SCHEMA_MAP`. So `init`/`show` pick up the reasoning section with ZERO
  config.ts code change — T2.S2 only adds tests proving it (regression net so a future SCHEMA_MAP change
  can't silently drop the section).
- **Out of scope (hard boundary):** S1's schema DATA (SCHEMA_MAP/HACK_CONFIG_SCHEMA entries — consume,
  don't re-add), the getters (T1.S2 — Complete), agent-factory composition (T1.M1.T3), the startup
  fail-fast validator (T1.M1.T4), docs sync (P1.M2), and making non-reasoning enums case-insensitive.

---

## What

### User-visible behavior
A project can write reasoning levels in any case in `.hack`:
```toml
[reasoning]
agent      = "HIGH"   # accepted (→ high)
impl_agent = "Off"    # accepted (→ off)
```
Both seed their `PRP_REASONING_*` env var with the canonical lowercase token. A genuinely invalid value
(`impl_agent = "loud"`) still aborts startup with the §9.7.7 message. `hack config init` now emits a
commented `[reasoning]` block; `hack config show --src` lists the 5 reasoning rows.

### Technical requirements (exact contract)

**Edit 1 — `src/config/hack-config.ts` `validateFieldValue`** (~L898 enum block). Make the comparison
case-insensitive for `section === 'reasoning'`; keep the original `value` in the §9.7.7 error message:
```ts
if (spec.type === 'string' && spec.enum !== undefined) {
  // [reasoning] values are case-insensitive members of REASONING_LEVELS (PRD §9.2.9 / §9.7.5):
  // compare against the lowercased value so 'HIGH'/'Off' are accepted. Other enum keys
  // ([harness] name, [cli] mode, [pipeline] commit_format/commit_style) stay case-sensitive.
  // The §9.7.7 error message echoes the ORIGINAL value (what the user typed).
  const compareValue =
    section === 'reasoning' && typeof value === 'string'
      ? value.toLowerCase()
      : (value as string);
  if (!spec.enum.includes(compareValue)) {
    throw new HackConfigError(
      `[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values ` +
        `[${spec.enum.join(', ')}].`
    );
  }
}
```

**Edit 2 — `src/config/hack-config.ts` `seedProcessEnv`** (~L590 inner loop). Seed the canonical
lowercase token for `section === 'reasoning'` string values:
```ts
for (const [section, keys] of Object.entries(merged)) {
  for (const [key, value] of Object.entries(keys)) {
    const envName = HACK_KEY_TO_ENV[`${section}.${key}`];
    if (envName && process.env[envName] === undefined) {
      // [reasoning] values are case-insensitive (§9.2.9): seed the canonical lowercase token so
      // process.env.PRP_REASONING_* holds the normalized form ('HIGH' → 'high'), matching the
      // §9.7.5 "(→ 'high')" canonicalization. Gated to [reasoning]; other sections seed as-is.
      const seedValue =
        section === 'reasoning' && typeof value === 'string'
          ? value.toLowerCase()
          : value;
      process.env[envName] = String(seedValue);
    }
  }
}
```

**Verify (NO config.ts code change) — `#buildTemplate` (config.ts:211) + `#showAction` (config.ts:324)**
both iterate `SCHEMA_MAP` (L213 / L350). S1's 5 `section:'reasoning'` entries auto-flow into both:
`hack config init` emits a `[reasoning]` block; `hack config show --src` reports the 5 reasoning rows.
T2.S2 only adds tests asserting this.

### Success Criteria
- [ ] `validateFieldValue` enum comparison is case-insensitive for `section === 'reasoning'` (other
      sections unchanged); the §9.7.7 error message still echoes the original `value`.
- [ ] `seedProcessEnv` seeds the canonical lowercase token for `section === 'reasoning'` string values.
- [ ] `.hack [reasoning] agent = "HIGH"` → no throw + `process.env.PRP_REASONING_AGENT === 'high'`.
- [ ] `.hack [reasoning] impl_agent = "Off"` → no throw + `process.env.PRP_REASONING_IMPL_AGENT === 'off'`.
- [ ] `.hack [reasoning] impl_agent = "loud"` → still throws the §9.7.7 `HackConfigError` (S1's test green).
- [ ] `[harness] name = "PI"` still throws (non-reasoning enum unchanged).
- [ ] `hack config init` emits a `[reasoning]` block; `hack config show --src` reports reasoning rows.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; affected suites green.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim
two source edits (with the `section === 'reasoning'` gate + the original-value-in-error-message
rationale), the verified load flow (validateHackTier→mergeTier→seedProcessEnv), the auto-derivation proof
(#buildTemplate/#showAction iterate SCHEMA_MAP), the S1 dependency + disjoint-edit proof, the test plan
mirroring existing enum tests (L787/800/1085), and the "why not delegate to resolveReasoningLevel"
decision.

### Documentation & References
```yaml
# MUST READ — the design + the two edits + the why-not-delegate decision + the S1 disjoint proof (authored with this PRP)
- docfile: plan/013_3f31aa2b81b7/P1M1T2S2/research/reasoning-case-insensitive-enum.md
  section: "2. The case-sensitive bug", "3. Design decision", "4. The load flow", "5. Auto-derivation", "7. Parallel-execution check"
  why: The exact enum block to edit, why gate on section==='reasoning' (not global), why NOT delegate to resolveReasoningLevel
        (preserves the §9.7.7 HackConfigError message + file attribution), the load flow proving the two change points suffice,
        and the auto-derivation proof. READ BEFORE IMPLEMENTING.

# MUST READ — the S1 contract this consumes (schema DATA T2.S2's gate matches)
- file: plan/013_3f31aa2b81b7/P1M1T2S1/PRP.md
  why: S1 adds the 5 section:'reasoning' SCHEMA_MAP entries + the reasoning HACK_CONFIG_SCHEMA section (enum: REASONING_LEVELS).
        T2.S2's `section === 'reasoning'` gate matches S1's `section:'reasoning'` entries; the enum check validates against
        HACK_CONFIG_SCHEMA.reasoning.*.enum (= REASONING_LEVELS, lowercase). S1 tests with 'loud' (out-of-vocab) so its test
        is green before AND after T2.S2. S1 < S2 ordering ⇒ S1 merged first.

# PATTERN FILE 1 — the ONLY source file edited (2 functions)
- file: src/config/hack-config.ts
  why: validateFieldValue (L861 — the enum block ~L898 is the case-sensitive check to relax for reasoning). seedProcessEnv
        (L590 — seeds process.env from merged; normalize reasoning values here). loadHackConfig (L1003 — the flow:
        validateHackTier→mergeTier→seedProcessEnv; proves the 2 change points cover validation+seeding). HACK_KEY_TO_ENV
        (L535 — DERIVED, do not edit). Both edits gate on `section === 'reasoning'` (a string literal matching S1's entries).
  pattern: "if (spec.type === 'string' && spec.enum !== undefined && !spec.enum.includes(value as string)) { throw new HackConfigError(`[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values [${spec.enum.join(', ')}].`); }"
  critical: Preserve the ORIGINAL `value` in the thrown message (JSON.stringify(value)), not the lowercased compareValue.
        Gate on section==='reasoning' so [harness]/[cli] mode/[pipeline] commit_format+commit_style stay case-sensitive.

# PATTERN FILE 2 — the auto-derivation surface (VERIFY only — do NOT edit)
- file: src/cli/commands/config.ts
  why: #buildTemplate (L211 — `for (const entry of SCHEMA_MAP)` L213 → groups by section, emits `# <key> = <default>`)
        auto-emits a [reasoning] block once S1's entries land. #showAction (L324 — `SCHEMA_MAP.map(...)` L350 → resolves
        value + source per entry) auto-reports reasoning rows. NO edit — T2.S2 only adds tests.

# PATTERN FILE 3 — the loader test file (the case-insensitive test)
- file: tests/unit/config/hack-config.test.ts
  why: Existing enum tests to mirror: L787 ('SHOULD throw on a bad enum for [harness] name'), L800 ([cli] mode),
        L1085 (commit_style) — all use writeFileSync(.hack) + expect(() => loadHackConfig(repoRoot)).toThrow(/accepted values/).
        S1 appends a [reasoning] schema-wiring describe; T2.S2 appends a [reasoning] case-insensitive describe (disjoint).
        loadHackConfig imported at L36. afterEach must delete the 5 PRP_REASONING_* env vars (prevent leak).
  pattern: "writeFileSync(join(repoRoot,'.hack'), '[reasoning]\\nagent = \"HIGH\"\\n'); delete process.env.PRP_REASONING_AGENT; loadHackConfig(repoRoot); expect(process.env.PRP_REASONING_AGENT).toBe('high');"

# PATTERN FILE 4 — the config-command test file (the init/show verify tests)
- file: tests/unit/cli/commands/config.test.ts
  why: Tests the ConfigCommand (init/show/validate/path). Mirror its existing init/show test patterns to add: (a) init emits
        a [reasoning] block; (b) show --src reports reasoning rows with source attribution. (S1 does NOT touch this file.)

# READ-ONLY — the S1/T1 symbols consumed
- file: src/config/constants.ts
  why: REASONING_LEVELS (L1534 — ['off','minimal','low','medium','high','xhigh'], lowercase; the enum values). resolveReasoningLevel
        (L1643 — already lowercases+validates; confirms the seeded lowercase token is what the getter expects). T2.S2 does NOT
        call resolveReasoningLevel (preserves HackConfigError); it just mirrors its lowercase-canonical form.

# VERIFIED FACTS
- fact: "validateFieldValue's enum check (~L898) is case-sensitive: !spec.enum.includes(value). 'HIGH' throws today (the gap)."
- fact: "spec.enum for reasoning = REASONING_LEVELS (lowercase), set by S1's HACK_CONFIG_SCHEMA.reasoning.*.enum."
- fact: "seedProcessEnv (L590) seeds process.env[envName] = String(value) from merged; values are RAW unless normalized."
- fact: "loadHackConfig flow (L1003): parseHackFile → validateHackTier (→validateFieldValue) → mergeTier → seedProcessEnv. The 2 change points (validateFieldValue + seedProcessEnv) cover validation + seeding."
- fact: "#buildTemplate (config.ts:211) iterates SCHEMA_MAP (L213) → auto-emits [reasoning] block once S1 lands. #showAction (L324) maps SCHEMA_MAP (L350) → auto-reports reasoning rows. NO config.ts edit."
- fact: "section === 'reasoning' is a string literal matching S1's SCHEMA_MAP entries (section:'reasoning') — the gate is exact."
- fact: "resolveReasoningLevel throws ReasoningConfigError (≠ HackConfigError); delegating would lose the §9.7.7 file+accepted-values message. Keep validateFieldValue + HackConfigError."
- fact: "S1 + T2.S2 both edit hack-config.ts + hack-config.test.ts but at DISJOINT functions/describe blocks; S1 < S2 ordering ⇒ no conflict."
```

### Current Codebase tree (relevant slice)
```bash
src/config/hack-config.ts                  # EDIT — validateFieldValue (case-insensitive enum) + seedProcessEnv (normalize seed)
tests/unit/config/hack-config.test.ts      # EDIT — +[reasoning] case-insensitive describe
tests/unit/cli/commands/config.test.ts     # EDIT — +init [reasoning]-block + show --src reasoning-rows verify tests
./.hack                                    # OPTIONAL — +commented [reasoning] block (doc surface)
src/cli/commands/config.ts                 # READ-ONLY (auto-derives from SCHEMA_MAP — verify, don't edit)
src/config/constants.ts                    # READ-ONLY (REASONING_LEVELS / resolveReasoningLevel — consumed)
```

### Desired Codebase tree with files to be edited
```bash
src/config/hack-config.ts                  # MODIFIED (validateFieldValue + seedProcessEnv; 2 gated edits)
tests/unit/config/hack-config.test.ts      # MODIFIED (append [reasoning] case-insensitive describe)
tests/unit/cli/commands/config.test.ts     # MODIFIED (append init/show verify tests)
./.hack                                    # OPTIONAL (commented [reasoning] block)
# No other source/config-docs changes. (Item DOCS: "a code comment noting case-normalization; the .hack block (if added) is the doc surface.")
```

### Known Gotchas of our Codebase & Library Quirks
```ts
// CRITICAL — GATE on section === 'reasoning'. Do NOT make the enum comparison case-insensitive globally —
//   [harness] name, [cli] mode, [pipeline] commit_format/commit_style must stay case-sensitive (PRD only
//   specifies case-insensitivity for [reasoning] per §9.2.9). A global change is an unrequested behavior
//   change with downstream surface (e.g. [harness] name → configureHarness/SUPPORTED_HARNESSES).

// CRITICAL — preserve the ORIGINAL value in the §9.7.7 error message. Use a separate `compareValue`
//   (lowercased) for the .includes() check, but JSON.stringify(value) (original) in the thrown message.
//   Don't pass the lowercased value to the message — the user must see what they typed (e.g. "LOUD").

// CRITICAL — do NOT delegate reasoning validation to resolveReasoningLevel(). It throws ReasoningConfigError
//   (T1's class) whose message ≠ the §9.7.7 HackConfigError format (no file attribution / accepted-values
//   list). The item requires the §9.7.7 message. Keep validateFieldValue + HackConfigError; only relax the
//   comparison + normalize the seed.

// CRITICAL — normalize the SEEDED value (seedProcessEnv), not just validate. Without seed normalization,
//   process.env.PRP_REASONING_AGENT would hold 'HIGH' (raw) and the loader test
//   `expect(...).toBe('high')` would fail. The getter resolveReasoningLevel lowercases downstream, but the
//   canonical env var is what the test (and §9.7.5 "(→ 'high')") expects.

// GOTCHA — both edits are gated on the SAME `section === 'reasoning'` literal, matching S1's
//   section:'reasoning' SCHEMA_MAP entries exactly. No constant indirection needed (the file uses literal
//   section strings throughout).

// GOTCHA — S1 (Implementing) also edits hack-config.ts (SCHEMA_MAP data ~L212 + HACK_CONFIG_SCHEMA.reasoning
//   ~L636 + import ~L11) and hack-config.test.ts (a [reasoning] schema-wiring describe). T2.S2 edits
//   DIFFERENT functions (validateFieldValue ~L898, seedProcessEnv ~L590) + a DIFFERENT describe block.
//   S1 < S2 ordering ⇒ S1 lands first; no textual conflict. Do NOT re-add S1's schema entries.

// GOTCHA — afterEach in hack-config.test.ts must `delete` the 5 PRP_REASONING_* env vars so a seeded value
//   doesn't leak into the file's other tests (§9.2.1 env-over-file: a stale env var would mask a seed).
//   S1 carries this directive forward; T2.S2's new describe must do the same.

// GOTCHA — the init/show verify tests go in tests/unit/cli/commands/config.test.ts (the config-command
//   test file), NOT hack-config.test.ts. hack-config.test.ts is for the LOADER (loadHackConfig); the
//   config command (init/show) is config.ts behavior tested via ConfigCommand. (The item lumps them under
//   "extend hack-config.test.ts" loosely — place each test where its subject lives.)

// GOTCHA — `hack config show` displays the RAW merged value (e.g. 'HIGH') by design — it reflects the file.
//   The runtime value is canonical via the seeded env var / getters. The show verify test asserts rows
//   APPEAR with source attribution, NOT value case. (If you want show to display canonical too, normalize
//   in validateHackTier's loop instead — but that mutates an exported validate function; the 2-function
//   approach is cleaner. Out of scope to change show's display.)

// GOTCHA — the repo ./.hack [reasoning] block is OPTIONAL (doc surface; defaults apply when absent). If
//   added, keep it COMMENTED (uncommented = override). Don't add secrets. (Item DOCS: "the .hack block
//   (if added) is the doc surface.")

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check. vitest 100% coverage on src:
//   the 2 edited lines are straight-line (covered by the case-insensitive test + existing enum tests).
```

---

## Implementation Blueprint

### Data models and structure
None new. T2.S2 edits two existing functions (`validateFieldValue`, `seedProcessEnv`), each with a
`section === 'reasoning'` gate. The `HackConfigFieldSpec`/`HackConfigValue` types already accept the
values; `REASONING_LEVELS` (S1) is the lowercase enum the comparison runs against.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/config/hack-config.test.ts   (RED — case-insensitive + normalization)
  - APPEND a describe('hack-config: [reasoning] case-insensitive enum + normalization') block.
  - IMPORT: loadHackConfig (L36), writeFileSync, join (already imported in the file — reuse).
  - it('accepts a case-variant [reasoning] value case-insensitively and normalizes to lowercase'):
      writeFileSync(join(repoRoot,'.hack'), '[reasoning]\nagent = "HIGH"\nimpl_agent = "Off"\n');
      delete process.env.PRP_REASONING_AGENT; delete process.env.PRP_REASONING_IMPL_AGENT;
      expect(() => loadHackConfig(repoRoot)).not.toThrow();
      expect(process.env.PRP_REASONING_AGENT).toBe('high');
      expect(process.env.PRP_REASONING_IMPL_AGENT).toBe('off');
  - it('still rejects a genuinely out-of-vocab [reasoning] value (§9.7.7)'):  (guard against over-relaxing)
      writeFileSync(join(repoRoot,'.hack'), '[reasoning]\nagent = "loud"\n');
      expect(() => loadHackConfig(repoRoot)).toThrow(/is not one of the accepted values/).
  - afterEach: delete the 5 PRP_REASONING_* env vars (prevent leak).
  - DO NOT: touch S1's [reasoning] schema-wiring describe (disjoint); use a case variant ('HIGH'/'Off')
        for the acceptance test (NOT 'loud' — S1 owns that); assert the SEEDED env var is lowercase.
  - EXPECTED NOW: the acceptance test FAILS (validateFieldValue throws on 'HIGH') → RED.

Task 2: EDIT src/config/hack-config.ts — validateFieldValue (GREEN — case-insensitive comparison)
  - REPLACE the enum block (~L898) with the Edit 1 code: compute `compareValue` (lowercased iff
        section==='reasoning' && typeof value==='string'), check `!spec.enum.includes(compareValue)`,
        throw HackConfigError with JSON.stringify(value) (ORIGINAL) in the message.
  - DO NOT: change the error class (HackConfigError), the message format, or the non-reasoning path.
  - EXPECTED: the acceptance test's not.toThrow passes; the 'loud' test still throws.

Task 3: EDIT src/config/hack-config.ts — seedProcessEnv (GREEN — normalize the seed)
  - EDIT the inner loop (~L590): compute `seedValue` (lowercased iff section==='reasoning' &&
        typeof value==='string'), `process.env[envName] = String(seedValue)`.
  - DO NOT: change the env-over-file guard (`process.env[envName] === undefined`) or non-reasoning seeding.
  - EXPECTED: process.env.PRP_REASONING_AGENT === 'high' (the acceptance test's toBe('high') passes).

Task 4: EDIT tests/unit/cli/commands/config.test.ts   (VERIFY — auto-derivation, no config.ts change)
  - APPEND: it('hack config init emits a [reasoning] block (auto-derived from SCHEMA_MAP)') — invoke the
        init action (or assert #buildTemplate output if the test harness exposes it) and assert the output
        contains `[reasoning]` + the 5 keys (agent/breakdown_agent/bug_finder_agent/validation_agent/impl_agent).
  - APPEND: it('hack config show --src reports each [reasoning] row with source attribution') — invoke
        show --src; assert the 5 reasoning rows appear (key + resolved value + a source-layer annotation).
  - MIRROR the existing init/show test patterns in config.test.ts (invoke ConfigCommand the same way).
  - EXPECTED: both pass immediately (S1's SCHEMA_MAP entries auto-flow; no config.ts edit needed). If they
        FAIL, S1's entries aren't landed (confirm SCHEMA_MAP has the 5 section:'reasoning' entries) OR
        #buildTemplate/#showAction don't iterate SCHEMA_MAP as expected (they do — L213/L350).

Task 5 (OPTIONAL): EDIT ./.hack — add a commented [reasoning] block
  - Add a commented `[reasoning]` section (mirroring PRD §9.7.5's example) for discoverability. Keep all
        lines commented (#) so defaults still apply. No secrets. LOW PRIORITY — skip if time-boxed.

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts (T2.S1 additions + T2.S2 additions + regression).
  - RUN: npx vitest run tests/unit/cli/commands/config.test.ts (init/show verify + regression).
  - EXPECTED: all clean/green. If the case-insensitive test still throws, confirm Task 2 (compareValue) +
        Task 3 (seedValue) landed + are gated on section==='reasoning'. If the 'loud' test stops throwing,
        the gate is too broad (confirm section==='reasoning', not a global lowercasing). If init/show verify
        fails, confirm S1's SCHEMA_MAP entries landed.
```

### Implementation Patterns & Key Details
```ts
// ---- validateFieldValue: case-insensitive comparison for [reasoning] ONLY (preserve original in msg) ----
if (spec.type === 'string' && spec.enum !== undefined) {
  const compareValue =
    section === 'reasoning' && typeof value === 'string' ? value.toLowerCase() : (value as string);
  if (!spec.enum.includes(compareValue)) {
    throw new HackConfigError(
      `[${section}] ${key} in ${file}: ${JSON.stringify(value)} is not one of the accepted values [${spec.enum.join(', ')}].`
    ); // ↑ ORIGINAL value in the message (what the user typed)
  }
}

// ---- seedProcessEnv: canonical lowercase seed for [reasoning] ONLY ----
const seedValue =
  section === 'reasoning' && typeof value === 'string' ? value.toLowerCase() : value;
process.env[envName] = String(seedValue);

// ---- the acceptance test (loader level) ----
writeFileSync(join(repoRoot, '.hack'), '[reasoning]\nagent = "HIGH"\nimpl_agent = "Off"\n');
delete process.env.PRP_REASONING_AGENT; delete process.env.PRP_REASONING_IMPL_AGENT;
expect(() => loadHackConfig(repoRoot)).not.toThrow();
expect(process.env.PRP_REASONING_AGENT).toBe('high');      // normalized
expect(process.env.PRP_REASONING_IMPL_AGENT).toBe('off');  // normalized

// ---- why the 2 change points suffice (load flow) ----
// loadHackConfig: parseHackFile → validateHackTier(→validateFieldValue: case-insensitive ACCEPT) →
//   mergeTier → seedProcessEnv(canonical lowercase SEED). Validation + seeding both covered.
```

### Integration Points
```yaml
DEPENDS ON (must be LANDED before T2.S2 is correct):
  - P1.M1.T2.S1 (schema DATA, Implementing): the 5 section:'reasoning' SCHEMA_MAP entries + reasoning
        HACK_CONFIG_SCHEMA section (enum: REASONING_LEVELS). T2.S2's section==='reasoning' gate + the enum
        it validates against both come from S1. S1 < S2 ordering ⇒ S1 merged first.

NO CONSUMER CHANGES: the S2 getters (T1.S2) read process.env.PRP_REASONING_* (now seeded canonical
  lowercase) via resolveReasoningLevel (which already lowercases) — unchanged. agent-factory (T1.M1.T3),
  the startup validator (T1.M1.T4), config.ts (auto-derives) — all unchanged.

SIBLING SUBTASKS (do NOT do them here):
  - P1.M1.T2.S1 (schema wiring, Implementing): SCHEMA_MAP + HACK_CONFIG_SCHEMA data + a [reasoning]
        schema-wiring describe. T2.S2 consumes its data; edits DISJOINT functions/describe blocks.
  - P1.M1.T4 (startup fail-fast + show --src surfacing): the startup validator + show consume the seeded
        env vars / SCHEMA_MAP rows — T2.S2's canonical seed helps them; no overlap.

DOCS (Mode A): a code comment in validateFieldValue + seedProcessEnv noting the case-normalization
  (§9.2.9/§9.7.5). The optional repo ./.hack [reasoning] block is the other doc surface. No docs/*.md
  changes here (P1.M2 owns the changeset doc sync).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. The 2 edits are straight-line conditionals; no type complexity. If lint flags an
#   unused `compareValue`/`seedValue`, confirm Task 2/3 use them.
```

### Level 2: Unit Tests (the PRIMARY gate)
```bash
# The loader-level case-insensitive + normalization test (+ S1's schema-wiring tests + regression):
npx vitest run tests/unit/config/hack-config.test.ts
# The config-command init/show verify tests (+ regression):
npx vitest run tests/unit/cli/commands/config.test.ts
# Expected: ALL GREEN. If the acceptance test throws on 'HIGH', Task 2 (compareValue gate) didn't land.
#   If process.env.PRP_REASONING_AGENT is 'HIGH' (not 'high'), Task 3 (seedValue) didn't land. If the
#   'loud' test stops throwing, the gate is too broad (must be section==='reasoning'). If init/show verify
#   fails, S1's SCHEMA_MAP entries aren't landed (confirm) OR #buildTemplate/#showAction changed.
# S1/T1 regression (untouched — must stay green):
npx vitest run tests/unit/config/constants.test.ts
```

### Level 3: Integration Testing (System Validation)
```bash
# Smoke: a real .hack [reasoning] with a case variant seeds the canonical lowercase token end-to-end.
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const repo = mkdtempSync(join(tmpdir(),'hack-reasoning-ci-'));
writeFileSync(join(repo,'.hack'), '[reasoning]\nagent = \"HIGH\"\nimpl_agent = \"Off\"\n');
delete process.env.PRP_REASONING_AGENT; delete process.env.PRP_REASONING_IMPL_AGENT;
import('./src/config/hack-config.ts').then(m => { m.loadHackConfig(repo);
  console.log('agent:', process.env.PRP_REASONING_AGENT, '| impl:', process.env.PRP_REASONING_IMPL_AGENT);
  rmSync(repo,{recursive:true,force:true}); });
"
# Expected: agent: high | impl: off  (case-insensitive acceptance + canonical lowercase seed).
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   - [reasoning] enum is case-insensitive (§9.2.9); 'HIGH'/'Off' accepted → 'high'/'off'. Other enums
#     ([harness] name, [cli] mode, [pipeline] commit_format/commit_style) UNCHANGED (case-sensitive).
#   - The §9.7.7 HackConfigError message is preserved (names section+key+file+ORIGINAL value+accepted).
#   - The canonical lowercase token is seeded (process.env.PRP_REASONING_* holds 'high', not 'HIGH').
#   - hack config init auto-emits [reasoning] (SCHEMA_MAP-driven); show --src auto-reports the 5 rows.
#   - Gate is section==='reasoning' (exact literal) — no global behavior change.
#   - Did NOT delegate to resolveReasoningLevel (preserves HackConfigError + file attribution).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` green (T2.S2 + S1 + regression).
- [ ] `npx vitest run tests/unit/cli/commands/config.test.ts` green (init/show verify + regression).

### Feature Validation
- [ ] `validateFieldValue` enum comparison is case-insensitive for `section === 'reasoning'`; original
      `value` preserved in the §9.7.7 message; other sections case-sensitive.
- [ ] `seedProcessEnv` seeds the canonical lowercase token for `section === 'reasoning'`.
- [ ] `.hack [reasoning] agent = "HIGH"` → no throw + `process.env.PRP_REASONING_AGENT === 'high'`.
- [ ] `.hack [reasoning] impl_agent = "loud"` → still throws §9.7.7 `HackConfigError`.
- [ ] `[harness] name = "PI"` still throws (non-reasoning enum unchanged).
- [ ] `hack config init` emits a `[reasoning]` block; `hack config show --src` reports reasoning rows.

### Code Quality Validation
- [ ] Only `src/config/hack-config.ts` (validateFieldValue + seedProcessEnv), `tests/unit/config/hack-config.test.ts`
      (case-insensitive describe), `tests/unit/cli/commands/config.test.ts` (init/show verify) modified.
- [ ] Gate is `section === 'reasoning'` (not global); error class/message unchanged (HackConfigError + §9.7.7).
- [ ] `validateHackTier` NOT mutated (stays pure); changes in validateFieldValue + seedProcessEnv only.
- [ ] Did NOT delegate to resolveReasoningLevel (preserves the §9.7.7 message).
- [ ] S1's schema DATA + describe block NOT re-touched (disjoint; S1 < S2 ordering).

### Documentation & Deployment
- [ ] Code comment in validateFieldValue + seedProcessEnv noting the case-normalization (§9.2.9/§9.7.5).
- [ ] (Optional) repo `./.hack` commented `[reasoning]` block added (doc surface).
- [ ] Commit message notes: [reasoning] enum case-insensitive (§9.2.9), gated to reasoning section,
      canonical lowercase seed, §9.7.7 message preserved, init/show auto-derived (verified), did-not-delegate.

---

## Anti-Patterns to Avoid

- ❌ Don't make the enum comparison case-insensitive GLOBALLY — gate on `section === 'reasoning'`. Other
      enums (`[harness] name`, `[cli] mode`, `[pipeline] commit_format`/`commit_style`) must stay
      case-sensitive (PRD §9.2.9 scopes case-insensitivity to reasoning only).
- ❌ Don't delegate reasoning validation to `resolveReasoningLevel` — it throws `ReasoningConfigError`
      (≠ `HackConfigError`), losing the §9.7.7 file + accepted-values message. Keep `validateFieldValue` +
      `HackConfigError`; only relax the comparison.
- ❌ Don't put the lowercased value in the §9.7.7 error message — use a separate `compareValue` for the
      `.includes()` check and `JSON.stringify(value)` (ORIGINAL) in the message, so the user sees what
      they typed (e.g. `"LOUD"`, not `"loud"`).
- ❌ Don't skip the `seedProcessEnv` normalization — without it `process.env.PRP_REASONING_AGENT` holds
      `'HIGH'` (raw) and the loader test `toBe('high')` fails. The canonical lowercase seed matches
      §9.7.5 "(→ 'high')".
- ❌ Don't mutate `validateHackTier`'s `parsed` input (it's exported for `hack config validate`). Keep the
      two changes in `validateFieldValue` (comparison) + `seedProcessEnv` (seed) — each single-purpose.
- ❌ Don't re-add S1's SCHEMA_MAP/HACK_CONFIG_SCHEMA entries (S1 owns them; S1 < S2 ⇒ already landed).
      T2.S2 CONSUMES them via the `section === 'reasoning'` gate.
- ❌ Don't test the acceptance path with `'loud'` (out-of-vocab) — S1 owns that case. Use a CASE VARIANT
      (`'HIGH'`/`'Off'`) so T2.S2's test proves the case-insensitivity specifically (and stays decoupled
      from S1's ordering).
- ❌ Don't put the init/show verify tests in hack-config.test.ts — they're config-command (config.ts)
      behavior; place them in `tests/unit/cli/commands/config.test.ts` where ConfigCommand is tested.
- ❌ Don't edit `src/cli/commands/config.ts` — `#buildTemplate`/`#showAction` already iterate SCHEMA_MAP;
      the `[reasoning]` block/rows auto-derive from S1's entries. T2.S2 only VERIFIES via tests.
- ❌ Don't change `hack config show`'s display of the raw merged value — it reflects the file by design;
      the runtime value is canonical via the seeded env var. (Out of scope to normalize show's display.)
- ❌ Don't add an uncommented `[reasoning]` block to `./.hack` — uncommented = override. If adding the
      optional block, keep it commented (defaults still apply).
- ❌ Don't run the full `npm run test:run` as the gate — gate on the two affected suites + lint + format.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a small, well-bounded change: two surgical edits in `hack-config.ts`, each a
`section === 'reasoning'`-gated conditional (case-insensitive comparison in `validateFieldValue`; canonical
lowercase seed in `seedProcessEnv`), plus additive tests. The load flow is verified
(validateHackTier→mergeTier→seedProcessEnv — the two change points cover validation + seeding). The
§9.7.7 `HackConfigError` message is preserved (the "why not delegate to resolveReasoningLevel" decision is
documented). The auto-derivation of init/show is proven (`#buildTemplate`/`#showAction` iterate SCHEMA_MAP;
S1's entries auto-flow — no config.ts edit). The S1 dependency + disjoint-edit proof (S1 edits SCHEMA_MAP
data + a schema-wiring describe; T2.S2 edits validateFieldValue/seedProcessEnv + a case-insensitive
describe + config.test.ts) is established, with S1 < S2 ordering guaranteeing S1 lands first. The existing
enum-test patterns (L787/800/1085) are directly mirrorable. Residual risks: (a) the exact
config-command-test invocation pattern in `config.test.ts` (mirror its existing init/show tests — not
pre-read in full, but the file is confirmed to test ConfigCommand init/show); (b) a prettier nit
(auto-fixed via `npm run fix`); (c) the optional `./.hack` block being skipped (it's explicitly optional).
No external/runtime unknowns — the change is pure string comparison + seeding logic.