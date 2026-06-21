# Technical Documentation Best Practices for ESLint Warning Fixes

> **Research Document**: Best practices, patterns, and actionable guidelines for creating effective technical documentation focused on ESLint warnings and code quality fixes.
>
> **Created**: 2026-01-15
> **Purpose**: PRP (Project Research & Planning) resource for creating ESLint warning fix documentation

---

## Table of Contents

- [1. Documentation Structure and Formatting](#1-documentation-structure-and-formatting)
- [2. Code Examples and Before/After Comparisons](#2-code-examples-and-beforeafter-comparisons)
- [3. Categorization and Prioritization](#3-categorization-and-prioritization)
- [4. Creating Actionable Recommendations](#4-creating-actionable-recommendations)
- [5. Table of Contents, Headers, and Cross-Linking](#5-table-of-contents-headers-and-cross-linking)
- [6. Quick Reference Cards and Cheat Sheets](#6-quick-reference-cards-and-cheat-sheets)
- [7. Tools and Templates](#7-tools-and-templates)
- [8. Examples from Popular Projects](#8-examples-from-popular-projects)

---

## 1. Documentation Structure and Formatting

### 1.1 Standard Technical Guide Structure

```markdown
# Document Title

> Brief description or purpose statement

**Status**: [Draft | Review | Published | Deprecated]
**Last Updated**: YYYY-MM-DD
**Version**: X.Y.Z
**Maintainer**: Team/Person

## Table of Contents

[Auto-generated TOC]

## Overview

- What problem does this solve?
- Who is this for?
- Prerequisites

## Quick Start

Minimal steps to get started

## Detailed Guide

Main content sections

## Examples

Practical examples

## Troubleshooting

Common issues and solutions

## References

Links to related docs
```

### 1.2 Markdown Formatting Best Practices

#### Heading Hierarchy

```markdown
# H1: Document title (use only once per document)

## H2: Main sections

### H3: Subsections

#### H4: Detailed topics (rarely needed)

##### H5: Avoid going deeper
```

**Rules**:

- Always start with H1 for document title
- Use H2 for main sections
- Skip heading levels (don't jump from H2 to H4)
- Keep headings concise and descriptive
- Use sentence case or Title Case consistently

#### Text Formatting

```markdown
**Bold text** for emphasis and key terms
_Italic text_ for variable names or technical terms
`Inline code` for code elements, file names, commands
~~Strikethrough~~ for deprecated information
[Link text](url) for hyperlinks
```

#### Lists

```markdown
- Unordered list item
  - Nested item
  - Another nested item

1. Ordered list item
2. Another item
   1. Nested numbered item

- [ ] Task list item (incomplete)
- [x] Task list item (complete)
```

#### Code Blocks

````markdown
# Syntax-highlighted code block

```javascript
const example = 'code';
```
````

##### No syntax highlighting

```text
Plain text or generic code
```

##### With file name

```javascript title="src/utils/example.js"
const example = 'code';
```

````text

#### Tables
```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
````

#### Blockquotes and Callouts

```markdown
> Standard blockquote for notes

> **[!NOTE]**
> Useful information

> **[!TIP]**
> Helpful suggestion

> **[!IMPORTANT]**
> Important information

> **[!WARNING]**
> Warning caution

> **[!CAUTION]**
> Strong danger warning
```

#### Horizontal Rules and Page Breaks

```markdown
---
---

---
```

### 1.3 Section Patterns for ESLint Documentation

#### Pattern 1: Rule Documentation Template

````markdown
## Rule Name

**Rule ID**: `rule-name`
**Category**: [Possible Errors | Best Practices | Stylistic Issues | Variables | Node.js | ES6]
**Severity**: [Error | Warning]
**Auto-fixable**: [Yes | No]
**Recommended**: [Yes | No]

### Description

Clear explanation of what the rule does and why it matters.

### Rationale

Why this rule exists. What problems it prevents.

### Examples

#### Incorrect

```javascript
// ❌ Bad code example
```
````

#### Correct

```javascript
// ✅ Good code example
```

### Configuration

Options available and their effects.

### When Not to Use It

Exceptions and cases where this rule doesn't apply.

### Related Rules

Links to similar or related rules.

````text

#### Pattern 2: Fix Guide Template
```markdown
# Fixing [Rule/Warning Name]

**Difficulty**: [Beginner | Intermediate | Advanced]
**Time Estimate**: X minutes
**Impact**: [High | Medium | Low]

## Problem
Description of the issue and its consequences.

## Solution
Step-by-step fix instructions.

### Step 1: Identify
How to find occurrences of this issue.

### Step 2: Fix
How to fix each occurrence.

### Step 3: Verify
How to verify the fix works.

## Examples
Before/after comparisons (see Section 2).

## See Also
Related rules and resources.
````

---

## 2. Code Examples and Before/After Comparisons

### 2.1 Before/After Pattern

#### Standard Format

````markdown
### Example: [Descriptive Title]

#### Before

```javascript
// ❌ [Brief description of what's wrong]
const problematicCode = 'here';
// Issue: [Explain the specific problem]
```
````

#### After

```javascript
// ✅ [Brief description of the fix]
const fixedCode = 'here';
// Improvement: [Explain what improved]
```

#### Changes

- [Bullet points highlighting key changes]
- [Focus on why each change matters]

````text

#### Real Example
```markdown
### Example: Using const Instead of var

#### Before
```javascript
// ❌ Using var allows redeclaration
var count = 0;
var count = 1; // No error, but confusing
````

##### After

```javascript
// ✅ Using const prevents accidental redeclaration
const count = 0;
// count = 1; // This would throw an error
```

##### Changes

- Replaced `var` with `const` to prevent reassignment
- Makes the code more predictable and easier to reason about
- Helps catch bugs where variables are accidentally reassigned

````text

### 2.2 Multi-File Before/After Pattern

```markdown
### Example: Refactoring Module Structure

#### Before Structure
````

src/
├── utils.js (500+ lines)
└── helpers.js (300+ lines)

```text

#### After Structure
```

src/
├── utils/
│ ├── string.js
│ ├── array.js
│ └── object.js
└── helpers/
├── dom.js
└── async.js

````text

#### Before: src/utils.js
```javascript
// ❌ All utility functions in one file
export function stringify() { /* ... */ }
export function parse() { /* ... */ }
export function map() { /* ... */ }
export function filter() { /* ... */ }
// ... 50 more functions
````

#### After: src/utils/string.js

```javascript
// ✅ String utilities grouped together
export function stringify() {
  /* ... */
}
export function parse() {
  /* ... */
}
```

#### After: src/utils/array.js

```javascript
// ✅ Array utilities grouped together
export function map() {
  /* ... */
}
export function filter() {
  /* ... */
}
```

#### Benefits

- Easier to find functions
- Better code organization
- Improved tree-shaking
- Clearer module responsibilities

````text

### 2.3 Code Example Best Practices

#### DOs
```markdown
✅ Use syntax highlighting with correct language
✅ Keep examples minimal and focused
✅ Add comments explaining key points
✅ Show real-world, relevant code
✅ Include edge cases when relevant
✅ Use meaningful variable names
✅ Show the complete context (not just snippets)
✅ Use emojis for quick visual scanning (❌ ✅ ⚠️)
````

#### DON'Ts

```markdown
❌ Use generic examples like "foo/bar"
❌ Make examples too complex
❌ Skip necessary context
❌ Use outdated syntax patterns
❌ Forget to comment what's important
❌ Mix multiple concepts in one example
❌ Use overly clever or obscure code
```

### 2.4 Annotated Code Examples

````markdown
### Example with Annotations

```javascript
// 1️⃣ Define the function with a clear name
function calculateDiscount(price, discountRate) {
  // 2️⃣ Validate inputs
  if (price < 0 || discountRate < 0 || discountRate > 1) {
    throw new Error('Invalid input');
  }

  // 3️⃣ Calculate discount amount
  const discountAmount = price * discountRate;

  // 4️⃣ Return final price
  return price - discountAmount;
}

// 5️⃣ Usage example
const finalPrice = calculateDiscount(100, 0.2); // $80
```
````

**Annotations**:

1. Function name clearly describes what it does
2. Input validation prevents invalid calculations
3. Intermediate variable improves readability
4. Clear return statement
5. Practical usage example with expected output

---

## 3. Categorization and Prioritization {#3-categorization-and-prioritization}

### 3.1 ESLint Rule Categories

Based on [ESLint's official categorization](https://eslint.org/docs/latest/rules/):

````markdown
## Category 1: Possible Errors

**Priority**: CRITICAL
**Description**: Rules that relate to detecting syntax or logic errors

Examples:

- `no-unused-vars`: Variables defined but not used
- `no-undef`: Variables used without being defined
- `no-dupe-keys`: Duplicate keys in object literals

## Category 2: Best Practices

**Priority**: HIGH
**Description**: Rules that suggest better ways of doing things

Examples:

- `eqeqeq`: Require === and !==
- `no-eval`: Disallow eval()
- `consistent-return`: Require return statements

## Category 3: Stylistic Issues

**Priority**: MEDIUM
**Description**: Rules that enforce consistent code style

Examples:

- `indent`: Enforce consistent indentation
- `quotes`: Enforce consistent quote style
- `semi`: Require or disallow semicolons

## Category 4: ES6+

**Priority**: MEDIUM
**Description**: Rules for modern JavaScript features

Examples:

- `no-var`: Disallow var
- `prefer-const`: Use const when variable isn't reassigned
- `prefer-arrow-callback`: Prefer arrow functions for callbacks

## Category 5: Variables

**Priority**: HIGH
**Description**: Rules related to variable declarations

Examples:

- `no-console`: Disallow console statements
- `no-shadow`: Disallow variable shadowing
- `no-use-before-define`: Disallow use before definition

### 3.2 Severity Matrix

```markdown
| Category         | Error           | Warning    | Off       | When to Use                 |
| ---------------- | --------------- | ---------- | --------- | --------------------------- |
| Possible Errors  | ✅ Default      | ⚠️ Rarely  | ❌ No     | Always enable in production |
| Best Practices   | ⚠️ Recommended  | ✅ Default | Sometimes | Enable for most codebases   |
| Stylistic Issues | Rarely          | ✅ Default | ✅ Yes    | Use formatters instead      |
| Variables        | ⚠️ Recommended  | ✅ Default | Sometimes | Based on team preference    |
| Legacy           | ⚠️ Case-by-case | ✅ Default | ✅ Yes    | Disable if not applicable   |
```
````

### 3.3 Prioritization Framework

#### ICE Scoring Model

```markdown
**ICE Score** = Impact × Confidence × Ease

**Impact** (1-10):

- 10: Security vulnerability, data loss, crash
- 8-9: Major functionality broken
- 6-7: Performance issues, confusing behavior
- 4-5: Code smell, maintainability
- 1-3: Style inconsistency, minor optimization

**Confidence** (1-10):

- 10: Certain this is the right fix
- 7-9: High confidence, minimal edge cases
- 5-6: Moderate confidence, some edge cases
- 3-4: Low confidence, needs investigation
- 1-2: Guessing, needs research

**Ease** (1-10):

- 10: Quick fix, automated, no risk
- 8-9: Simple manual fix, low risk
- 6-7: Moderate effort, some testing needed
- 4-5: Complex, requires significant changes
- 1-3: Major refactor, high risk

**Prioritization**:

- Score 70+: Critical priority
- Score 50-69: High priority
- Score 30-49: Medium priority
- Score 10-29: Low priority
- Score <10: Defer or ignore
```

#### Priority Categories

```markdown
## P0 - Critical (Fix Immediately)

- Security vulnerabilities
- Data corruption or loss
- Application crashes
- Broken critical functionality

**Action**: Drop everything, fix today

## P1 - High (Fix This Sprint)

- Performance degradation
- User-facing bugs
- Confusing behavior affecting UX
- Major code smells

**Action**: Add to current sprint

## P2 - Medium (Fix Next Sprint)

- Maintainability issues
- Minor performance issues
- Inconsistent patterns
- Developer experience issues

**Action**: Plan for next sprint

## P3 - Low (Backlog)

- Style inconsistencies
- Minor optimizations
- Nice-to-have improvements
- Deprecation warnings

**Action**: Add to backlog, address gradually
```

### 3.4 Categorization Template

```markdown
## ESLint Warning Categorization

### By Severity

#### 🔴 Critical (Error)

**Fix Timeline**: Immediate
**Examples**:

- `no-undef`: Using undefined variables
- `no-unused-vars`: Dead code
- `no-constant-condition`: Logic errors

#### 🟡 Warning

**Fix Timeline**: This sprint
**Examples**:

- `eqeqeq`: Using == instead of ===
- `no-console`: Console statements in production
- `no-var`: Using outdated var keyword

#### 🔵 Low (Style)

**Fix Timeline**: Backlog
**Examples**:

- `quotes`: Inconsistent quote style
- `indent`: Inconsistent indentation
- `semi`: Missing semicolons

### By Impact

#### 💥 High Impact

- Affects functionality
- Causes bugs or errors
- Performance implications
- Security concerns

#### 📊 Medium Impact

- Code readability
- Maintainability
- Developer experience
- Testing complexity

#### 🎨 Low Impact

- Style consistency
- Personal preference
- Minor optimizations
- Aesthetic changes

### By Effort

#### ⚡ Quick Wins (< 5 minutes)

- Single-line fixes
- Auto-fixable issues
- Simple replacements
- Clear solutions

#### 🔄 Moderate Effort (5-30 minutes)

- Multi-line changes
- Require testing
- Some refactoring
- Need consideration

#### 🏗️ Significant Effort (> 30 minutes)

- Major refactoring
- Architectural changes
- Breaking changes
- Extensive testing
```

---

## 4. Creating Actionable Recommendations

### 4.1 Actionable Recommendation Template

````markdown
## [Recommendation Title]

**Impact**: [High/Medium/Low]
**Effort**: [Quick/Moderate/Significant]
**Priority**: [P0/P1/P2/P3]
**Rule**: `@eslint/[rule-name]`

### Problem

[Clear, specific description of the issue]

**Why it matters**:

- [Reason 1]
- [Reason 2]
- [Reason 3]

### Solution

[Specific, actionable steps to fix]

#### Step 1: [Action Title]

```javascript
// Example code or command
```
````

**What this does**: [Explanation]

#### Step 2: [Action Title]

```bash
# Example command
```

**What this does**: [Explanation]

#### Step 3: [Action Title]

```javascript
// Example code
```

**What this does**: [Explanation]

### Before & After

[See Section 2 for before/after pattern]

### Verification

```bash
# How to verify the fix
npm run lint
npm run test
```

### Common Mistakes

- ❌ [Mistake 1 and how to avoid it]
- ❌ [Mistake 2 and how to avoid it]
- ❌ [Mistake 3 and how to avoid it]

### See Also

- [Related rule](link)
- [Documentation](link)
- [Discussion](link)

````text

### 4.2 Making Recommendations Actionable

#### The SMART Framework
```markdown
**S**pecific: What exactly needs to be done
**M**easurable: How to measure success
**A**chievable: Is it actually doable
**R**elevant: Why it matters
**T**ime-bound: When to do it

### Example

❌ Vague: "Fix unused variables"
✅ Specific: "Remove 23 unused imports in src/components/, reducing bundle size by ~5KB"

❌ Vague: "Improve code quality"
✅ Measurable: "Enable no-shadow rule to prevent 15 variable shadowing issues"

❌ Vague: "Use const"
✅ Achievable: "Replace var with const for 8 variables in src/utils/config.js"

❌ Vague: "Fix ESLint warnings"
✅ Relevant: "Fix no-undef warnings to prevent runtime errors in production"

❌ Vague: "Fix soon"
✅ Time-bound: "Address all P0 and P1 warnings by next Friday (2026-01-23)"
````

### 4.3 Command-Based Recommendations

````markdown
## Quick-Fix Commands

### Auto-fixable Issues

```bash
# Auto-fix all auto-fixable issues
npm run lint -- --fix

# Auto-fix specific rule
npm run lint -- --fix --rule '@eslint/quotes: ["error", "single"]'

# Auto-fix specific file
npm run lint -- --fix src/components/Button.tsx
```
````

### Check Specific Issues

```bash
# Check for unused variables
npm run lint -- --rule '@eslint/no-unused-vars: error'

# Check for console statements
npm run lint -- --rule '@eslint/no-console: warn'

# Check for specific file patterns
npm run lint src/**/*.test.ts
```

### Generate Report

```bash
# Generate JSON report
npm run lint -- --format json --output-file lint-report.json

# Generate HTML report
npm run lint -- --format html --output-file lint-report.html

# Count warnings by rule
npm run lint -- --format compact
```

````text

### 4.4 Checklist-Based Recommendations

```markdown
## ESLint Warning Fix Checklist

### Phase 1: Assessment
- [ ] Run ESLint and capture all warnings
- [ ] Categorize warnings by severity (P0-P3)
- [ ] Count warnings by rule and file
- [ ] Identify auto-fixable issues
- [ ] Estimate effort for each category

### Phase 2: Planning
- [ ] Create fix plan with priorities
- [ ] Allocate time for fixes
- [ ] Identify quick wins
- [ ] Plan for testing
- [ ] Set target dates

### Phase 3: Execution
- [ ] Fix P0 issues (Critical)
- [ ] Fix P1 issues (High)
- [ ] Fix P2 issues (Medium)
- [ ] Fix P3 issues (Low)
- [ ] Run tests after each fix

### Phase 4: Verification
- [ ] Run ESLint again
- [ ] Verify all tests pass
- [ ] Check bundle size impact
- [ ] Review code changes
- [ ] Update documentation

### Phase 5: Prevention
- [ ] Enable rules in CI/CD
- [ ] Add pre-commit hooks
- [ ] Update team guidelines
- [ ] Document exceptions
- [ ] Schedule regular reviews
````

---

## 5. Table of Contents, Headers, and Cross-Linking

### 5.1 Table of Contents Patterns

#### Manual TOC (Small Documents)

```markdown
## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
- [Usage](#usage)
- [API Reference](#api-reference)
- [FAQ](#faq)
```

#### Auto-Generated TOC (Large Documents)

```markdown
## Table of Contents

<!-- TOC -->

<!-- /TOC -->
```

_Note: Use tools like `markdown-toc` VS Code extension or GitHub's automatic TOC rendering_

#### Hierarchical TOC

```markdown
## Table of Contents

### Getting Started

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)

### Core Concepts

- [Rules](#rules)
  - [Rule Categories](#rule-categories)
  - [Rule Configuration](#rule-configuration)
- [Formatters](#formatters)
- [Plugins](#plugins)

### Guides

- [Fixing Common Issues](#fixing-common-issues)
- [Custom Rules](#custom-rules)
- [Integration](#integration)

### Reference

- [CLI](#cli)
- [Configuration File](#configuration-file)
- [API](#api)
```

### 5.2 Header Patterns

#### Descriptive Headers

```markdown
❌ Bad: "Section 1"
✅ Good: "Understanding ESLint Rule Categories"

❌ Bad: "Code"
✅ Good: "Code Examples and Best Practices"

❌ Bad: "How to fix"
✅ Good: "Fixing no-unused-vars Warnings"
```

#### Action-Oriented Headers

```markdown
## Understanding the Problem

## Identifying the Issue

## Implementing the Fix

## Verifying the Solution

## Troubleshooting
```

#### Question-Based Headers

```markdown
## What is this warning?

## Why does this matter?

## How do I fix it?

## What are the edge cases?

## Where can I learn more?
```

#### Numbered Headers (Tutorials)

```markdown
## Step 1: Install Dependencies

## Step 2: Configure ESLint

## Step 3: Run ESLint

## Step 4: Fix Issues

## Step 5: Verify Fixes
```

### 5.3 Cross-Linking Patterns

#### Internal Links (Same Document)

```markdown
See [Configuration](#configuration) for details.
As mentioned in the [Introduction](#introduction).
For more information, see [Best Practices](#best-practices).
```

#### Internal Links (Different Documents)

```markdown
See [Getting Started](./getting-started.md) for setup instructions.
For configuration options, see [Configuration Guide](./configuration.md).
Related: [Custom Rules](./custom-rules.md)
```

#### External Links

```markdown
See the [official ESLint documentation](https://eslint.org/docs/latest/).
For more details, check out [this article](https://example.com).
Learn more from [MDN Web Docs](https://developer.mozilla.org/).
```

#### Reference Links

```markdown
## References

1. [ESLint Rules](https://eslint.org/docs/latest/rules/)
2. [TypeScript ESLint](https://typescript-eslint.io/)
3. [Prettier Documentation](https://prettier.io/docs/en/)
4. [Airbnb Style Guide](https://github.com/airbnb/javascript)
```

#### Link with Descriptive Title

```markdown
[Link Text](url 'Title attribute')
[ESLint](https://eslint.org 'JavaScript Linter')
[TypeScript](https://typescript.io 'Type-safe JavaScript')
```

#### Section Anchors

```markdown
## Rule: no-unused-vars {#no-unused-vars}

[Jump back to [Categories](#categories)]
```

### 5.4 Cross-Referencing Patterns

#### Referencing Rules

```markdown
The `no-unused-vars` rule is related to [`no-shadow`](#no-shadow)
and [`no-use-before-define`](#no-use-before-define).

For more on unused variables, see:

- [no-unused-vars](#no-unused-vars)
- [no-shadow](#no-shadow)
- [no-var](#no-var)
```

#### Referencing Examples

```markdown
As shown in [Example 1](#example-1), this approach works well.
Compare this with [Example 2](#example-2) for alternative approach.
See [Advanced Usage](#advanced-usage) for more complex scenarios.
```

#### Referencing Sections

```markdown
### Configuration

For ESLint configuration, see [Configuration Guide](./configuration.md).
For plugin setup, see [Plugin Installation](#plugin-installation).

### Related Sections

- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
```

---

## 6. Quick Reference Cards and Cheat Sheets

### 6.1 Quick Reference Card Template

````markdown
# ESLint Quick Reference Card

> One-page reference for common ESLint rules and fixes

## Common Rules

| Rule             | Category      | Auto-fix | Priority |
| ---------------- | ------------- | -------- | -------- |
| `no-unused-vars` | Variables     | ✓        | P1       |
| `no-undef`       | Errors        | ✗        | P0       |
| `eqeqeq`         | Best Practice | ✓        | P1       |
| `no-console`     | Best Practice | ✗        | P2       |

## Quick Commands

```bash
# Fix all auto-fixable
npm run lint -- --fix

# Check specific rule
npm run lint -- --rule 'no-console: error'

# Generate report
npm run lint -- --format json
```
````

## Priority Levels

- **P0**: Fix immediately (Critical)
- **P1**: This sprint (High)
- **P2**: Next sprint (Medium)
- **P3**: Backlog (Low)

## Common Fixes

### Remove unused variables

```bash
# Auto-fix
eslint --fix
```

### Use const instead of var

```javascript
// Before
var x = 1;

// After
const x = 1;
```

### Use === instead of ==

```javascript
// Before
if (x == y) {
}

// After
if (x === y) {
}
```

## Resources

- [ESLint Rules](https://eslint.org/docs/latest/rules/)
- [Full Documentation](./README.md)
- [Troubleshooting](./troubleshooting.md)

````text

### 6.2 Cheat Sheet Pattern

```markdown
# ESLint Fix Cheat Sheet

## 🔴 Critical (Fix Now)

```javascript
// ❌ Using undefined variables
const x = y; // y is not defined

// ✅ Fix: Define the variable first
const y = 1;
const x = y;
````

## 🟡 High Priority (Fix This Sprint)

```javascript
// ❌ Using == instead of ===
if (x == y) {
}

// ✅ Fix: Use ===
if (x === y) {
}
```

## 🔵 Medium Priority (Fix Next Sprint)

```javascript
// ❌ Using var
var count = 0;

// ✅ Fix: Use const/let
const count = 0;
let total = 0;
```

## Quick Commands

```bash
# Auto-fix
eslint --fix

# Check specific file
eslint file.js

# Generate report
eslint --format json > report.json
```

## Fix Pattern

1. Run ESLint
2. Categorize by priority
3. Auto-fix what you can
4. Manually fix the rest
5. Run tests
6. Commit

````text

### 6.3 One-Page Reference Pattern

```markdown
# ESLint: One-Page Reference

## Categories

### 1️⃣ Possible Errors (P0)
`no-undef` | `no-unused-vars` | `no-constant-condition` | `no-dupe-keys`

### 2️⃣ Best Practices (P1)
`eqeqeq` | `no-console` | `no-eval` | `curly`

### 3️⃣ Stylistic Issues (P2-P3)
`quotes` | `semi` | `indent` | `comma-dangle`

### 4️⃣ ES6+ (P1-P2)
`no-var` | `prefer-const` | `prefer-arrow-callback` | `no-duplicate-imports`

## Common Fixes

| Issue | Fix |
|-------|-----|
| `var` | Use `const`/`let` |
| `==` | Use `===` |
| Missing `;` | Add semicolons |
| `console.log` | Remove or use logger |
| Unused var | Remove or use `_` prefix |

## Commands

| Task | Command |
|------|---------|
| Run | `eslint .` |
| Fix | `eslint --fix` |
| Check | `eslint --print-config` |
| Report | `eslint --format json` |

## Priorities

**P0**: Security, crashes
**P1**: Functionality, performance
**P2**: Maintainability
**P3**: Style

---

*See [Full Documentation](./README.md) for details*
````

### 6.4 Category-Based Reference Card

````markdown
# ESLint Variables Reference

## Variable Declaration Rules

### no-var (P1)

```javascript
// ❌ Bad
var x = 1;

// ✅ Good
const x = 1;
```
````

### prefer-const (P2)

```javascript
// ❌ Bad
let x = 1;

// ✅ Good
const x = 1;
```

### no-unused-vars (P1)

```javascript
// ❌ Bad
const x = 1;

// ✅ Good
const x = 1;
console.log(x);
```

### no-shadow (P2)

```javascript
// ❌ Bad
function foo(x) {
  const x = 1;
}

// ✅ Good
function foo(x) {
  const y = 1;
}
```

## Quick Fixes

```bash
# Fix all variable issues
eslint --fix --rule 'no-var: error' --rule 'prefer-const: warn'
```

## Checklist

- [ ] Replace `var` with `const` or `let`
- [ ] Use `const` when not reassigning
- [ ] Remove unused variables
- [ ] Avoid shadowing
- [ ] Use meaningful names

---

## 7. Tools and Templates {#7-tools-and-templates}

### 7.1 Documentation Tools

#### Markdown Linting

````bash
# Install markdownlint
npm install -g markdownlint-cli

# Lint markdown files
markdownlint **/*.md

# Auto-fix
markdownlint --fix **/*.md

#### Table of Contents Generation

```bash
# Install markdown-toc
npm install -g markdown-toc

# Generate TOC
markdown-toc -i README.md

# For VS Code
# Install: "Markdown All in One" extension
# Command: "Create Table of Contents"
````

#### Link Checking

```bash
# Install markdown-link-check
npm install -g markdown-link-check

# Check links
markdown-link-check README.md

# Check all markdown files
find . -name "*.md" -exec markdown-link-check {} \;
```

### 7.2 VS Code Snippets

#### ESLint Rule Documentation

````json
{
  "ESLint Rule Doc": {
    "prefix": "eslint-rule",
    "body": [
      "## ${1:rule-name}",
      "",
      "**Rule ID**: \\`${1:rule-name}\\`  ",
      "**Category**: ${2:Possible Errors}  ",
      "**Severity**: ${3:Error}  ",
      "**Auto-fixable**: ${4:Yes}  ",
      "",
      "### Description",
      "${5:Description of the rule}",
      "",
      "### Examples",
      "",
      "#### Incorrect",
      "```\\${6:javascript}",
      "// ❌ ${7:Bad code}",
      "${0}",
      "```",
      "",
      "#### Correct",
      "```\\${6:javascript}",
      "// ✅ ${8:Good code}",
      "",
      "```"
    ]
  }
}
````

#### Before/After Pattern

````json
{
  "Before After": {
    "prefix": "before-after",
    "body": [
      "### ${1:Example Title}",
      "",
      "#### Before",
      "```\\${2:javascript}",
      "// ❌ ${3:Description}",
      "${0}",
      "```",
      "",
      "#### After",
      "```\\${2:javascript}",
      "// ✅ ${4:Description}",
      "",
      "```"
    ]
  }
}
````

### 7.3 Documentation Templates

#### Full Document Template

````markdown
# [Title]

> [Description/Purpose]

**Status**: [Draft | Review | Published]
**Last Updated**: YYYY-MM-DD
**Version**: X.Y.Z
**Maintainer**: [Team/Person]

## Table of Contents

<!-- toc -->

## Overview

[Brief introduction]

## Prerequisites

- [Prerequisite 1]
- [Prerequisite 2]

## Quick Start

```bash
# Minimal working example
```
````

## Detailed Guide

[Main content]

## Examples

[Practical examples]

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Issue 1 | Fix 1    |
| Issue 2 | Fix 2    |

## References

- [Reference 1](url)
- [Reference 2](url)

## Changelog

### X.Y.Z (YYYY-MM-DD)

- [Change 1]
- [Change 2]

---

## 8. Examples from Popular Projects {#8-examples-from-popular-projects}

### 8.1 ESLint Official Documentation Pattern

Source: <https://eslint.org/docs/latest/rules/>

**Key Elements**:

1. Clear rule name and description
2. Rule icon indicating status (✅, ⚠️)
3. Options table
4. Incorrect vs Correct code examples
5. When to use/not use
6. Related rules

**Pattern**:

````markdown
# Rule Name

[Description]

## Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| ...    | ...  | ...     | ...         |

## Examples

### Incorrect

```js
// ❌ Bad example
```
````

### Correct

```js
// ✅ Good example
```

## When Not To Use It

[Exceptions]

## Related Rules

- [rule-1](link)
- [rule-2](link)

````text

### 8.2 Airbnb Style Guide Pattern

Source: https://github.com/airbnb/javascript

**Key Elements**:
1. Table of contents with categories
2. Rule naming convention
3. Code examples with explanations
4. References to rationale
5. Clear exceptions section

**Pattern**:
```markdown
# Category Name

## [Rule Name]

- [Explanation]

```javascript
// ❌ Bad
[bad code]

// ✅ Good
[good code]
````

**Why?** [Rationale]

**Exceptions**: [When to break the rule]

````text

### 8.3 TypeScript-ESLint Pattern

Source: https://typescript-eslint.io/rules/

**Key Elements**:
1. Rule severity indicators
2. Difficulty ratings
3. TypeScript-specific considerations
4. Migration guides
5. Comparison with JS rules

**Pattern**:
```markdown
# Rule Name

**Severity**: [error | warn]
**Difficulty**: [easy | medium | hard]
**Has Fix**: [✅ | ❌]

## Description
[What the rule does]

## When to use it
[Use cases]

## Options
[Configuration options]

## Examples
[Before/after]

## Related Rules
[Links]
````

### 8.4 MDN Documentation Pattern

Source: <https://developer.mozilla.org/>

**Key Elements**:

1. Browser compatibility tables
2. Try it examples
3. See also sections
4. Technical summary
5. Clear heading hierarchy

**Pattern**:

````markdown
# Feature Name

[Description]

## Syntax

```js
[Syntax pattern]
```
````

#### Examples

[Practical examples]

#### Specifications

[Standards references]

#### Browser Compatibility

[Compatibility table]

#### See Also

[Related topics]

```text

---

## Summary: Actionable Patterns for Your PRP

### Must-Have Elements

1. **Clear Structure**
   - H1 for document title
   - H2 for main sections
   - H3 for subsections
   - Consistent heading hierarchy

2. **Code Examples**
   - Before/after comparisons
   - Syntax highlighting
   - Explanatory comments
   - Emoji indicators (❌ ✅)

3. **Categorization**
   - Priority levels (P0-P3)
   - Severity indicators
   - Category groupings
   - Impact/effort matrix

4. **Actionable Steps**
   - Numbered procedures
   - Command examples
   - Checklists
   - Verification steps

5. **Navigation**
   - Table of contents
   - Cross-references
   - Related sections
   - External links

6. **Quick References**
   - One-page summaries
   - Cheat sheets
   - Command tables
   - Rule patterns

### Recommended Tools

- **Editor**: VS Code with "Markdown All in One" extension
- **Linting**: markdownlint-cli
- **TOC**: markdown-toc or VS Code extension
- **Preview**: VS Code built-in or markdown-it
- **Link Check**: markdown-link-check

### Quality Checklist

- [ ] Clear heading hierarchy (H1 → H2 → H3)
- [ ] Syntax highlighting on all code blocks
- [ ] Before/after examples for fixes
- [ ] Priority indicators (P0-P3, 🔴🟡🔵)
- [ ] Command examples with bash blocks
- [ ] Cross-references to related sections
- [ ] Table of contents for long documents
- [ ] External links for further reading
- [ ] Verification steps for fixes
- [ ] Common mistakes sections

---

**Document Status**: ✅ Complete
**Next Steps**: Use these patterns to create ESLint warning fix documentation for your project.
**Feedback**: Iterate based on team needs and usage patterns.
```
