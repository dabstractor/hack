# README.md auth.json Claims — Post-Fix Verification Research

**Work item**: P1.M4.T1.S1 — Verify README.md auth.json claims are accurate post-fix
**Date**: 2026-06-29
**Scope**: README.md ONLY (sibling task P1.M4.T1.S2 covers docs/CONFIGURATION.md, docs/INSTALLATION.md, .env.example)

## Executive Summary

**All README.md auth.json / `pi /login` claims are now ACCURATE post-fix. No prose edits are required.**
The fix shipped by P1.M1.T2 (Groundswell file-backed `AuthStorage.create()`) is deployed and verified
at runtime, so the "auto-detected by the harness" promise — which was FALSE under the stale dist — is now TRUE.

## Claim-by-claim verification matrix

| # | README line(s) | Claim | Source of truth | Status |
|---|----------------|-------|-----------------|--------|
| 1 | 81 (Prerequisites) | `pi /login` writes `~/.pi/agent/auth.json` | pi SDK behavior (unchanged) | ✅ Accurate |
| 2 | 242 (footnote) | `pi /login` (`~/.pi/agent/auth.json`, auto-detected) | runtime test | ✅ Accurate |
| 3 | 249 (Setup) | "auto-detected by the harness" | integration test PASSES + dist uses `create()` | ✅ **Now TRUE** |
| 4 | 277 (How It Works) | auth.json "auto-detected by the harness" | same | ✅ **Now TRUE** |
| 5 | 342 (.env example) | "auto-detected by the harness" | same | ✅ **Now TRUE** |
| 6 | 372–395 (Troubleshooting) | preflight message + `pi /login` fix | `buildPreflightMessage()` in src/config/types.ts | ✅ Byte-accurate |

## Evidence captured during research

### Evidence 1 — The deployed dist is the FIXED one
```text
$ grep -n "AuthStorage\.\(create\|inMemory\)()" node_modules/groundswell/dist/harnesses/pi-harness.js
99:        // File-backed by default (PRD §9.2.6): AuthStorage.create() reads ~/.pi/agent/auth.json
103:        this.authStorage = options?.authStorage ?? AuthStorage.create();

$ md5sum node_modules/groundswell/dist/harnesses/pi-harness.js
d3de7234ddc73e156eef8618d7a82748  ...   ← the FIXED md5 (stale was 54cea962…)

$ ls -la node_modules/ | grep groundswell
lrwxrwxrwx  groundswell -> ../../groundswell   ← npm link dev setup (symlink)
```
The previously-stale `inMemory()` code at line 95 is GONE; `create()` is in its place. PRD Issue 1 is resolved.

### Evidence 2 — Integration test (P1.M1.T1.S1) PASSES = the runtime proof
```text
$ npx vitest run tests/integration/config/pi-harness-auth.test.ts
 ✓ tests/integration/config/pi-harness-auth.test.ts  (2 tests) 2752ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
Case A (auth.json-only, no env vars) resolves the seeded `zai` key → the "auto-detected by the harness"
claim is TRUE. This is the canonical proof called for in the work-item contract.

### Evidence 3 — Hardened validator now has an auth-store check (P1.M1.T3.S1)
```text
$ npx tsx src/scripts/validate-groundswell.ts
═══ Validating PiHarness auth-store behavior (file-backed) ═══
✓ PiHarness resolved auth.json-only credential for 'zai' (file-backed AuthStorage.create() working)
═══ Summary ═══
✓ All validations passed!
```
The validator gained a new section. **However** the README does NOT mention `validate:groundswell` /
`validate-groundswell.ts` at all (grep returned no matches). The work-item contract point (c) is
therefore N/A: "if the README mentions the validator, note the enhanced behavior" — it does not, and
the validator is a contributor/dev concern routed via `docs/contributing.md`, not end-user README content.

### Evidence 4 — Troubleshooting message matches the runtime source EXACTLY
The README troubleshooting block (lines 378–388) was compared against `buildPreflightMessage()` in
`src/config/types.ts` (lines 229–243). They are identical, including:
- header line `(harness 'pi', model 'zai/glm-5.2')`
- "Checked sources (all empty)" block (Override / Environment / pi auth.json)
- "Remediation (pick one)" block with `pi /login` and `export ZAI_API_KEY=<your-key>`

The `pi /login` fix recommendation is valid because auth.json is now honored at run time.

## Conclusion

This is a **verification task whose expected outcome is "no edits"**. The executor must re-run the
verification checks to independently confirm, and make a prose edit ONLY if a check reveals a
discrepancy that the research did not surface. The probability of an edit is low but non-zero
(e.g. if the deployed state has drifted since this research was captured).
