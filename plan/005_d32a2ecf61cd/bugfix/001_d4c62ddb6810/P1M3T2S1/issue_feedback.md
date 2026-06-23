# Implementation Issue Feedback (Attempt 1/3)

The previous implementation attempt encountered an issue that requires re-planning.

## Issue Details

BLOCKED — This work item (P1.M3.T2.S1) cannot be completed. It is scoped as a test-only addition (create issue-replan-loop.test.ts), but the R2 feature it must test (Issue-Driven Re-planning Loop) is entirely unimplemented. Verified: (1) no ISSUE_RETRY_MAX/getIssueRetryMax in src/config/constants.ts, (2) no outcome/issueMessage on ExecutionResult in src/agents/prp-executor.ts, (3) no outcome==='issue' routing in task-orchestrator.ts (only binary success/fail at ~line 748), (4) no deletePRP/researchNow on ResearchQueue in src/core/research-queue.ts, (5) the R2 unit tests fail with 'TypeError: getIssueRetryMax is not a function' (6/6 failures). Remediation: Implement R2 as a prerequisite feature work item (4 source touch-points + green unit tests), then re-run this task using the deferred test design in the PRP.

## Full Agent Output

All PRP claims are verified. The R2 feature (issue-driven re-planning loop) is completely unimplemented — none of the required source symbols exist, and the R2 unit tests are failing with `TypeError: getIssueRetryMax is not a function`. This is a hard dependency blocker for a test-only work item.

```json
{
   "result": "issue",
   "message": "BLOCKED — This work item (P1.M3.T2.S1) cannot be completed. It is scoped as a test-only addition (create issue-replan-loop.test.ts), but the R2 feature it must test (Issue-Driven Re-planning Loop) is entirely unimplemented. Verified: (1) no ISSUE_RETRY_MAX/getIssueRetryMax in src/config/constants.ts, (2) no outcome/issueMessage on ExecutionResult in src/agents/prp-executor.ts, (3) no outcome==='issue' routing in task-orchestrator.ts (only binary success/fail at ~line 748), (4) no deletePRP/researchNow on ResearchQueue in src/core/research-queue.ts, (5) the R2 unit tests fail with 'TypeError: getIssueRetryMax is not a function' (6/6 failures). Remediation: Implement R2 as a prerequisite feature work item (4 source touch-points + green unit tests), then re-run this task using the deferred test design in the PRP."
}
```

## Instructions

Review this feedback and create a revised PRP that addresses the issue.
If the issue is fundamentally impossible to resolve, output `"result": "fail"` with an explanation.
