'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function normalizeInputName(name) {
  return `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
}

function getInput(name, opts = {}) {
  const envKey = normalizeInputName(name);
  const raw = process.env[envKey];
  const val = (raw === undefined || raw === null) ? '' : String(raw);
  const trimmed = opts.trim === false ? val : val.trim();
  const out = trimmed.length > 0 ? trimmed : (opts.defaultValue ?? '');
  if (opts.required && out.trim().length === 0) {
    throw new Error(`Missing required input: ${name}`);
  }
  return out;
}

function toBool(value, defaultValue = false) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '') return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  throw new Error(`Invalid boolean value: "${value}"`);
}

function writeOutput(name, value) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  fs.appendFileSync(outPath, `${name}=${String(value)}\n`, { encoding: 'utf8' });
}

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${markdown}\n`, { encoding: 'utf8' });
}

function parseArgString(argString) {
  const s = String(argString ?? '').trim();
  if (!s) return [];
  const args = [];
  let cur = '';
  let quote = null; // "'" or '"'
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        args.push(cur);
        cur = '';
      }
      continue;
    }

    cur += ch;
  }

  if (escape) {
    cur += '\\';
  }
  if (quote) {
    throw new Error(`Unterminated quote in args: ${argString}`);
  }
  if (cur.length > 0) args.push(cur);
  return args;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}`));
    });
  });
}

function runShellScript(script, shell, cwd) {
  const s = String(script ?? '').trim();
  if (!s) return Promise.resolve();

  const platform = process.platform;
  const sh = String(shell ?? '').trim().toLowerCase();

  if (sh === 'pwsh' || sh === 'powershell') {
    const exe = platform === 'win32' ? 'pwsh' : 'pwsh';
    return runCommand(exe, ['-NoLogo', '-NoProfile', '-Command', s], { cwd });
  }

  // default bash
  if (platform === 'win32') {
    // Try Git Bash if present, otherwise fail with a clear error
    const bashCandidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'bash'
    ];
    const tryNext = async (idx) => {
      if (idx >= bashCandidates.length) {
        throw new Error('pre-run-shell=bash but bash was not found on this runner. Use pre-run-shell=pwsh on Windows.');
      }
      try {
        await runCommand(bashCandidates[idx], ['-lc', s], { cwd });
      } catch (e) {
        // If executable not found, try next, otherwise rethrow
        if (String(e.message || '').includes('spawn') && String(e.message || '').includes('ENOENT')) {
          return tryNext(idx + 1);
        }
        throw e;
      }
    };
    return tryNext(0);
  }

  return runCommand('bash', ['-lc', s], { cwd });
}

async function main() {
  const workingDirectory = getInput('working-directory', { defaultValue: '.' });
  const cwd = path.resolve(process.cwd(), workingDirectory);

  const forgeCliVersion = getInput('forge-cli-version', { defaultValue: 'latest' });
  const preRun = getInput('pre-run', { defaultValue: '', trim: false });
  const preRunShell = getInput('pre-run-shell', { defaultValue: 'bash' });
  const usageAnalytics = toBool(getInput('usage-analytics', { defaultValue: 'true' }), true);

  const environment = getInput('environment', { defaultValue: 'staging' });

  const runOverride = getInput('run', { defaultValue: '' });

  const deploy = toBool(getInput('deploy', { defaultValue: 'true' }), true);
  const noVerify = toBool(getInput('no-verify', { defaultValue: 'false' }), false);
  const deployTag = getInput('deploy-tag', { defaultValue: '' });
  const deployMajorVersion = getInput('deploy-major-version', { defaultValue: '' });
  const deployArgs = getInput('deploy-args', { defaultValue: '' });

  const install = toBool(getInput('install', { defaultValue: 'false' }), false);
  const site = getInput('site', { defaultValue: '' });
  const product = getInput('product', { defaultValue: '' });
  const upgrade = toBool(getInput('upgrade', { defaultValue: 'true' }), true);
  const confirmScopes = toBool(getInput('confirm-scopes', { defaultValue: 'true' }), true);
  const installMajorVersion = getInput('install-major-version', { defaultValue: '' });
  const installArgs = getInput('install-args', { defaultValue: '' });

  if (!fs.existsSync(cwd)) {
    throw new Error(`working-directory does not exist: ${cwd}`);
  }

  // Basic auth guardrail: Forge supports env var auth for CI.
  const forgeEmail = String(process.env.FORGE_EMAIL ?? '').trim();
  const forgeToken = String(process.env.FORGE_API_TOKEN ?? '').trim();
  if (!forgeEmail || !forgeToken) {
    throw new Error(
      'Missing FORGE_EMAIL and/or FORGE_API_TOKEN in environment. ' +
      'Store them as GitHub Actions secrets and pass them via env.'
    );
  }

  writeSummary(`## A9 Forge CI\n\nWorking directory: \`${workingDirectory}\`\n\nEnvironment: \`${environment}\``);

  // Pre-run
  if (preRun.trim().length > 0) {
    writeSummary('\n### Pre-run\nRunning pre-run commands.');
    await runShellScript(preRun, preRunShell, cwd);
  }

  // Install Forge CLI
  writeSummary(`\n### Forge CLI\nInstalling @forge/cli@${forgeCliVersion}`);
  await runCommand('npm', ['install', '--global', `@forge/cli@${forgeCliVersion}`], { cwd });

  // Report CLI version
  try {
    // 'forge --version' prints to stdout; capture by spawning with pipe
    const version = await new Promise((resolve, reject) => {
      const child = spawn('forge', ['--version'], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d.toString('utf8'); });
      child.stderr.on('data', (d) => { err += d.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve((out || err).trim());
        else reject(new Error(`forge --version failed (${code})`));
      });
    });
    writeOutput('forge_cli_version', version);
    writeSummary(`\nReported by \`forge --version\`: \`${version}\``);
  } catch (e) {
    writeSummary('\nCould not capture `forge --version` output.');
  }

  // Avoid usage analytics prompt in CI if requested
  if (usageAnalytics) {
    try {
      await runCommand('forge', ['settings', 'set', 'usage-analytics', 'true'], { cwd });
    } catch (e) {
      // Not fatal; keep going
      writeSummary('\nNote: forge settings set usage-analytics true failed. Continuing.');
    }
  }

  let didDeploy = false;
  let didInstall = false;

  if (runOverride.trim().length > 0) {
    const args = parseArgString(runOverride);
    writeSummary(`\n### Run\nExecuting: \`forge ${args.join(' ')}\``);
    await runCommand('forge', args, { cwd });
  } else {
    if (deploy) {
      const args = ['deploy', '--non-interactive', '-e', environment];
      if (noVerify) args.push('--no-verify');
      if (deployTag.trim()) args.push('--tag', deployTag.trim());
      if (deployMajorVersion.trim()) args.push('--major-version', deployMajorVersion.trim());
      args.push(...parseArgString(deployArgs));
      writeSummary(`\n### Deploy\nExecuting: \`forge ${args.join(' ')}\``);
      await runCommand('forge', args, { cwd });
      didDeploy = true;
      writeOutput('deployed', 'true');
    } else {
      writeOutput('deployed', 'false');
    }

    if (install) {
      if (!site.trim()) throw new Error('install=true requires input: site');
      if (!product.trim()) throw new Error('install=true requires input: product');

      const prodNorm = product.trim().toLowerCase();
      const args = ['install', '--non-interactive', '-e', environment, '--site', site.trim(), '--product', prodNorm];
      if (upgrade) args.push('--upgrade');
      if (confirmScopes) args.push('--confirm-scopes');
      if (installMajorVersion.trim()) args.push('--major-version', installMajorVersion.trim());
      args.push(...parseArgString(installArgs));

      writeSummary(`\n### Install\nExecuting: \`forge ${args.join(' ')}\``);
      await runCommand('forge', args, { cwd });
      didInstall = true;
      writeOutput('installed', 'true');
    } else {
      writeOutput('installed', 'false');
    }
  }

  if (didDeploy || didInstall) {
    writeSummary(`\n### Result\nDeployed: \`${didDeploy}\`\n\nInstalled: \`${didInstall}\``);
  }
}

main().catch((err) => {
  const msg = err && err.stack ? err.stack : String(err);
  try {
    writeSummary(`\n### Failed\n\`\`\`\n${msg}\n\`\`\``);
  } catch (_) {}
  console.error(msg);
  process.exit(1);
});
