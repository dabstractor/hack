/**
 * Resolve the absolute path to the stagecoach native binary (PRD §9.10.1).
 *
 * @remarks
 * Shipped with this tool — `stagecoach` is declared as an npm dependency
 * (`stagecoach-ai`), whose `postinstall` downloads the per-platform native Go
 * binary (goreleaser cross-builds linux/darwin/windows × amd64/arm64) into
 * `~/.stagecoach/versions/<version>/<goos>-<goarch>/stagecoach`. `npm install`
 * therefore brings stagecoach along transitively: no separate install, no `PATH`
 * lookup, no Go toolchain for end users. This resolver mirrors the package's own
 * `bin/stagecoach.js` shim so the pipeline and `npx stagecoach` resolve the SAME
 * binary. The cache root is overridable via `STAGECOACH_CACHE_DIR`.
 *
 * @returns The absolute path to the stagecoach native binary.
 * @throws {AgentError} If the `stagecoach-ai` dependency is not installed, or the
 *   native binary is missing (postinstall blocked / not yet installed). Never a
 *   silent fallback — a missing binary is an actionable startup error (§9.10.1).
 *
 * @example
 * const bin = resolveStagecoachBinary();
 * spawnSync(bin, ['--dry-run', '--single'], { stdio: 'inherit', env: process.env });
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentError } from './errors.js';

const nodeRequire = createRequire(import.meta.url);

/**
 * Compute the goreleaser platform/arch segment + binary name for the current host.
 *
 * @remarks
 * goreleaser names use Go's `GOOS`/`GOARCH` (e.g. `windows`/`amd64`), NOT Node's
 * `process.platform`/`process.arch` (`win32`/`x64`). Mirrors `bin/stagecoach.js`
 * exactly. Exported for direct unit testing.
 */
export function platformArch(): {
  goos: string;
  goarch: string;
  binaryName: string;
} {
  const goos = process.platform === 'win32' ? 'windows' : process.platform;
  const goarch = process.arch === 'x64' ? 'amd64' : process.arch;
  const binaryName =
    process.platform === 'win32' ? 'stagecoach.exe' : 'stagecoach';
  return { goos, goarch, binaryName };
}

export function resolveStagecoachBinary(): string {
  // 1. Read the installed stagecoach-ai version (the cache is versioned by it).
  let version: string;
  try {
    const pkgJsonPath = nodeRequire.resolve('stagecoach-ai/package.json');
    version = (
      JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
        version: string;
      }
    ).version;
  } catch {
    throw new AgentError(
      'stagecoach-ai dependency not installed. Run `npm install` (it brings the stagecoach ' +
        'native binary via postinstall; no separate install / PATH needed). See §9.10.1.'
    );
  }

  // 2. Compute the per-platform cache path (mirrors bin/stagecoach.js exactly).
  const { goos, goarch, binaryName } = platformArch();
  const cacheRoot =
    process.env.STAGECOACH_CACHE_DIR ||
    path.join(os.homedir(), '.stagecoach', 'versions');
  const binPath = path.join(
    cacheRoot,
    version,
    `${goos}-${goarch}`,
    binaryName
  );

  // 3. Fail fast with an actionable error if the binary is missing (postinstall blocked).
  if (!existsSync(binPath)) {
    throw new AgentError(
      `stagecoach native binary not found at ${binPath}. Run \`npm install\` to install it ` +
        '(no separate install / PATH needed). See §9.10.1.'
    );
  }
  return binPath;
}
