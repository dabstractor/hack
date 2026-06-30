#!/usr/bin/env node
/**
 * Groundswell Library Validation Script
 *
 * @remarks
 * Validates that the Groundswell library is properly linked and all required
 * exports are accessible. This script should be run before building or as
 * part of CI/CD to ensure the Groundswell integration is working correctly.
 *
 * Checks performed:
 * - Installation: verifies groundswell is linked/installed via npm
 * - Version: confirms groundswell version >= 0.0.3
 * - Imports: validates all required exports are accessible
 * - Decorators: validates all required decorators are accessible
 * - Node version: confirms Node.js >= 18
 * - Auth-store behavior: instantiates the real `PiHarness`, seeds a temp `auth.json`
 *   (via `PI_CODING_AGENT_DIR`), and asserts `harness.authStorage.getApiKey('zai')` resolves
 *   the on-disk key — fails if the deployed `node_modules/groundswell` dist still uses
 *   `AuthStorage.inMemory()` (PRD §9.2.6 / §9.5).
 * - Link status: detects whether node_modules/groundswell is a symlink (npm link dev setup) or a
 *   plain directory (published tarball); for tarball installs, greps dist/harnesses/pi-harness.js
 *   for the §9.2.6 fix (AuthStorage.create(), not AuthStorage.inMemory()). Informational — the hard
 *   stale-dist gate is the auth-store behavior check above (PRD §9.5 / Issue 4).
 * - Published artifact: fetches the groundswell tarball from the npm registry at the version
 *   resolved by the lockfile and inspects its dist for the §9.2.6 fix. HARD gate — fails if the
 *   published version is stale, ensuring CI and fresh clones are never broken by an unpublished
 *   local-only fix.
 *
 * Usage:
 *   npx tsx src/scripts/validate-groundswell.ts
 *
 * Exit codes:
 *   0: Validation passed
 *   1: Validation failed
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AuthStorage } from '@earendil-works/pi-coding-agent';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

/**
 * Logs a message with color
 */
function log(color: string, message: string): void {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Logs a section header
 */
function logSection(title: string): void {
  log(colors.blue, `\n${colors.bold}═══ ${title} ═══`);
}

/**
 * Logs a success message
 */
function logSuccess(message: string): void {
  log(colors.green, `✓ ${message}`);
}

/**
 * Logs a warning message
 */
function logWarning(message: string): void {
  log(colors.yellow, `⚠ ${message}`);
}

/**
 * Logs an error message
 */
function logError(message: string): void {
  log(colors.red, `✗ ${message}`);
}

/**
 * Validates Groundswell is installed (via npm install or npm link)
 */
function validateInstallation(): boolean {
  logSection('Validating groundswell installation');

  try {
    const result = execSync('npm list groundswell', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    // Extract version from npm list output (link detection is handled by validateLinkStatus)
    const versionMatch = result.match(/groundswell@([\d.]+)/);
    if (versionMatch) {
      logSuccess(`Groundswell installed: ${versionMatch[1]}`);
    } else {
      logSuccess('Groundswell installed');
    }

    return true;
  } catch {
    logError('Groundswell is not installed');
    logError('Run: npm install');
    return false;
  }
}

/**
 * Reports whether node_modules/groundswell is a symlink (npm link dev setup) or a plain directory
 * (published npm tarball). For tarball installs, greps dist/harnesses/pi-harness.js to confirm the
 * deployed build carries the §9.2.6 fix (AuthStorage.create(), not AuthStorage.inMemory()).
 *
 * INFORMATIONAL: never hard-fails on a stale tarball — logs a warning and returns true. The hard
 * stale-dist gate is validateAuthStoreBehavior() (PRD §9.5 / Issue 4).
 */
function validateLinkStatus(): boolean {
  logSection('Validating groundswell link status (symlink vs tarball)');

  const groundswellPath = join(process.cwd(), 'node_modules', 'groundswell');

  try {
    // CRITICAL: lstatSync (NOT statSync) so we see the link itself, not its target.
    const stat = lstatSync(groundswellPath);

    if (stat.isSymbolicLink()) {
      // npm link dev setup — trust the source repo; behavior check is the hard gate.
      const target = readlinkSync(groundswellPath); // raw target (may be relative, e.g. '../../groundswell')
      logSuccess(`Groundswell linked from: ${target}`);
      return true;
    }

    // Plain directory → published npm tarball. Verify the deployed dist carries the §9.2.6 fix.
    const distPath = join(
      groundswellPath,
      'dist',
      'harnesses',
      'pi-harness.js'
    );
    if (!existsSync(distPath)) {
      logWarning(
        `Groundswell installed as a published tarball, but ${distPath} was not found — cannot verify dist freshness.`
      );
      return true; // informational
    }

    const src = readFileSync(distPath, 'utf-8');
    const hasFix = src.includes('AuthStorage.create()');
    const hasStale = src.includes('AuthStorage.inMemory()');

    if (hasFix && !hasStale) {
      logSuccess(
        'Groundswell installed from registry; dist/harnesses/pi-harness.js contains the §9.2.6 fix (AuthStorage.create()).'
      );
      return true;
    }

    // Stale published tarball — WARNING only (the hard gate is validateAuthStoreBehavior).
    logWarning(
      'Groundswell installed from registry (tarball) but dist appears STALE — ' +
        'pi-harness.js uses AuthStorage.inMemory() instead of AuthStorage.create(). ' +
        'Run `npm install groundswell@latest` or `npm link groundswell`. ' +
        '(Informational; the auth-store behavior check is the hard gate.)'
    );
    return true; // CRITICAL: NOT a hard failure.
  } catch (error) {
    logError(`Failed to determine groundswell link status: ${error}`);
    return false; // real failure (e.g. node_modules/groundswell missing)
  }
}

/**
 * Validates Groundswell version compatibility
 */
async function validateVersionCompatibility(): Promise<boolean> {
  logSection('Validating version compatibility');

  try {
    // Get the package.json from node_modules/groundswell
    const packageJsonPath = join(
      process.cwd(),
      'node_modules',
      'groundswell',
      'package.json'
    );

    if (!existsSync(packageJsonPath)) {
      logError('groundswell package.json not found in node_modules');
      logError('Run: npm install');
      return false;
    }

    // Read package.json using fs
    const { readFileSync } = await import('node:fs');
    const groundswellPackage = JSON.parse(
      readFileSync(packageJsonPath, 'utf-8')
    );
    const version = groundswellPackage.version;

    logSuccess(`Groundswell version: ${version}`);

    // Check version is at least 0.0.3
    const versionParts = version.split('.').map(Number);
    if (versionParts[0] > 0 || versionParts[1] > 0 || versionParts[2] >= 3) {
      logSuccess('Version is compatible (>= 0.0.3)');
      return true;
    }

    logWarning(`Version ${version} may be outdated (recommended: >= 0.0.3)`);
    return true; // Still pass, just warn
  } catch (error) {
    logError(`Failed to validate version: ${error}`);
    return false;
  }
}

/**
 * Validates Groundswell imports
 */
async function validateImports(): Promise<boolean> {
  logSection('Validating Groundswell imports');

  const requiredExports = [
    'Workflow',
    'Agent',
    'Prompt',
    'createAgent',
    'createWorkflow',
    'createPrompt',
  ];

  try {
    // Dynamic import for ES modules
    const groundswell = await import('groundswell');

    // Try to check each export
    for (const exp of requiredExports) {
      if ((groundswell as Record<string, unknown>)[exp] !== undefined) {
        logSuccess(`Export '${exp}' is accessible`);
      } else {
        logError(`Export '${exp}' is not accessible`);
        return false;
      }
    }

    return true;
  } catch (error) {
    logError(`Failed to validate imports: ${error}`);
    return false;
  }
}

/**
 * Validates Groundswell decorators
 */
async function validateDecorators(): Promise<boolean> {
  logSection('Validating Groundswell decorators');

  const decorators = ['@Step', '@Task', '@ObservedState'];

  try {
    // Dynamic import for ES modules
    const groundswell = await import('groundswell');

    for (const decorator of decorators) {
      const decoratorName = decorator.substring(1); // Remove @
      if (
        (groundswell as Record<string, unknown>)[decoratorName] !== undefined
      ) {
        logSuccess(`Decorator ${decorator} is accessible`);
      } else {
        logError(`Decorator ${decorator} is not accessible`);
        return false;
      }
    }

    return true;
  } catch (error) {
    logError(`Failed to validate decorators: ${error}`);
    return false;
  }
}

/**
 * Validates that the deployed `node_modules/groundswell` PiHarness uses a FILE-BACKED auth store
 * (PRD §9.2.6 / §9.5). Seeds a temp `auth.json` and asserts the harness resolves it — fails if
 * the dist is stale (still `AuthStorage.inMemory()`), which silently ignores `~/.pi/agent/auth.json`.
 */
async function validateAuthStoreBehavior(): Promise<boolean> {
  logSection('Validating PiHarness auth-store behavior (file-backed)');

  const EXPECTED_KEY = 'gs-validation-test-key';
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), 'gs-auth-check-'));
  let harness:
    | {
        initialize(options?: unknown): Promise<void>;
        terminate(): Promise<void>;
      }
    | undefined;

  try {
    // Point the SDK's default AuthStorage.create() at our temp dir (read lazily at initialize()-time).
    process.env.PI_CODING_AGENT_DIR = tmpDir;
    writeFileSync(
      join(tmpDir, 'auth.json'),
      JSON.stringify({ zai: { type: 'api_key', key: EXPECTED_KEY } })
    );

    // Real (non-mocked) import — the validate script runs under tsx (no vitest alias), so this
    // resolves to the actual node_modules/groundswell dist.
    const { PiHarness } = await import('groundswell');
    harness = new PiHarness();
    await harness.initialize(); // no options → AuthStorage.create() default → reads tmpDir/auth.json

    // authStorage is `private` in PiHarness; cast to access at runtime (JS does not enforce private).
    const authStorage = (
      harness as unknown as {
        authStorage: AuthStorage | null;
      }
    ).authStorage;
    if (!authStorage) {
      logError(
        'PiHarness.authStorage is null after initialize() — default file-backed store was not built'
      );
      return false;
    }

    const key = await authStorage.getApiKey('zai'); // Promise<string | undefined>
    if (key !== EXPECTED_KEY) {
      logError(
        `PiHarness did NOT resolve auth.json (got ${JSON.stringify(key)}). ` +
          'The deployed node_modules/groundswell dist is likely stale (AuthStorage.inMemory) — re-link/rebuild Groundswell.'
      );
      return false;
    }

    logSuccess(
      `PiHarness resolved auth.json-only credential for 'zai' (file-backed AuthStorage.create() working)`
    );
    return true;
  } catch (error) {
    logError(`Auth-store behavior check failed: ${error}`);
    return false;
  } finally {
    try {
      await harness?.terminate();
    } catch {
      /* ignore */
    }
    if (previousDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Validates Node.js version compatibility
 */
function validateNodeVersion(): boolean {
  logSection('Validating Node.js version compatibility');

  const nodeVersion = process.version;
  const majorVersion = Number(nodeVersion.substring(1).split('.')[0]);

  logSuccess(`Node.js version: ${nodeVersion}`);

  // Groundswell requires Node.js 18+
  if (majorVersion >= 18) {
    logSuccess('Node.js version is compatible (>= 18)');
    return true;
  }

  logError(`Node.js version ${nodeVersion} is not compatible (requires >= 18)`);
  return false;
}

/**
 * Validates that the npm-published groundswell artifact (resolved from the lockfile)
 * contains the §9.2.6 fix (AuthStorage.create(), not AuthStorage.inMemory()).
 *
 * This catches the scenario where a local `npm link` masks a stale published version —
 * CI and fresh clones always install from the registry, so the published tarball MUST
 * carry the fix.
 */
async function validatePublishedArtifact(): Promise<boolean> {
  logSection('Validating npm-published groundswell artifact');

  try {
    // Resolve the exact version from the lockfile
    const result = execSync('npm ls groundswell --json', { encoding: 'utf-8', stdio: 'pipe' });
    const tree = JSON.parse(result);
    const dep = tree.dependencies?.groundswell;
    if (!dep?.version) {
      logWarning('Could not resolve installed groundswell version from lockfile — skipping published artifact check.');
      return true;
    }
    const version = dep.version as string;
    logSuccess(`Lockfile resolves groundswell@${version}`);

    // Fetch the published tarball and inspect its dist
    const tarballUrl = `https://registry.npmjs.org/groundswell/-/groundswell-${version}.tgz`;
    const tmpDir = mkdtempSync(join(tmpdir(), 'gs-registry-check-'));
    try {
      execSync(`curl -sL '${tarballUrl}' | tar xz --strip-components=1 -C '${tmpDir}'`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const distPath = join(tmpDir, 'dist', 'harnesses', 'pi-harness.js');
      if (!existsSync(distPath)) {
        logWarning(`Published tarball dist/harnesses/pi-harness.js not found — skipping.`);
        return true;
      }

      const src = readFileSync(distPath, 'utf-8');
      const hasFix = src.includes('AuthStorage.create()');
      const hasStale = src.includes('AuthStorage.inMemory()');

      if (hasFix && !hasStale) {
        logSuccess(
          `Published groundswell@${version} contains the §9.2.6 fix (AuthStorage.create()).`
        );
        return true;
      }

      // Stale published artifact — this is a HARD failure because CI/fresh clones will hit it.
      logError(
        `Published groundswell@${version} is STALE — pi-harness.js uses ` +
          `AuthStorage.inMemory() instead of AuthStorage.create(). ` +
          `The auth.json path will be broken for CI and fresh installs. ` +
          `Push and publish the fix in the groundswell repo first.`
      );
      return false;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (error) {
    logWarning(`Could not validate published artifact (offline or registry unreachable): ${error}`);
    return true; // soft-fail if offline
  }
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  log(colors.bold, '\n🔍 Groundswell Library Validation\n');

  const results = {
    installation: false,
    linkStatus: false,
    publishedArtifact: false,
    version: false,
    imports: false,
    decorators: false,
    nodeVersion: false,
    authStoreBehavior: false,
  };

  // Run all validations
  results.nodeVersion = validateNodeVersion();
  results.installation = validateInstallation();
  results.linkStatus = validateLinkStatus();
  results.publishedArtifact = await validatePublishedArtifact();
  results.version = await validateVersionCompatibility();
  results.imports = await validateImports();
  results.decorators = await validateDecorators();
  results.authStoreBehavior = await validateAuthStoreBehavior();

  // Summary
  logSection('Summary');
  const allPassed = Object.values(results).every(r => r);

  if (allPassed) {
    log(colors.green, '\n✓ All validations passed!\n');
    process.exit(0);
  } else {
    log(colors.red, '\n✗ Some validations failed\n');
    log(colors.yellow, 'Please fix the issues above before proceeding.\n');
    process.exit(1);
  }
}

// Run validation
main();
