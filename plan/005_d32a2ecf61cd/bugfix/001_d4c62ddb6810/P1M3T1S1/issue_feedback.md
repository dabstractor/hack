# Implementation Issue Feedback (Attempt 1/3)

The previous implementation attempt encountered an issue that requires re-planning.

## Issue Details

P1.M3.T1.S1 is a BLOCKED PREREQUISITE — cannot be implemented. The integration test requires R1 deadline/fallback features (ResearchTimeoutError, researchNow, isAbandoned, deadline race in waitForPRP, RESEARCH_TIMEOUT/getResearchTimeoutSeconds) that were never implemented in src/. Verification against HEAD confirms: (1) grep for all R1 symbols in src/ returns zero matches; (2) ResearchQueue has no researchNow/isAbandoned/deadline API — only simple enqueue/processNext/waitForPRP; (3) tests/unit/config/research-timeout.test.ts fails 6/6 because getResearchTimeoutSeconds is not exported from src/config/constants.ts. The test design in the PRP contract is sound, but it is ahead of the implementation. Remediation: add a milestone that implements R1/R2 in src/ first, then revisit this test subtask. See the PRP's 'Recommended remediation' section for detailed Options A/B/C.

## Full Agent Output

All evidence confirmed. Here is the result:

```json
{
   "result": "issue",
   "message": "P1.M3.T1.S1 is a BLOCKED PREREQUISITE — cannot be implemented. The integration test requires R1 deadline/fallback features (ResearchTimeoutError, researchNow, isAbandoned, deadline race in waitForPRP, RESEARCH_TIMEOUT/getResearchTimeoutSeconds) that were never implemented in src/. Verification against HEAD confirms: (1) grep for all R1 symbols in src/ returns zero matches; (2) ResearchQueue has no researchNow/isAbandoned/deadline API — only simple enqueue/processNext/waitForPRP; (3) tests/unit/config/research-timeout.test.ts fails 6/6 because getResearchTimeoutSeconds is not exported from src/config/constants.ts. The test design in the PRP contract is sound, but it is ahead of the implementation. Remediation: add a milestone that implements R1/R2 in src/ first, then revisit this test subtask. See the PRP's 'Recommended remediation' section for detailed Options A/B/C."
}
```

## Instructions

Review this feedback and create a revised PRP that addresses the issue.
If the issue is fundamentally impossible to resolve, output `"result": "fail"` with an explanation.
