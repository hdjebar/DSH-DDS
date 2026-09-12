#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUPPORTED_GITNEXUS_VERSION = '1.6.11';
const MAX_VISIBLE_COMPONENTS = 12;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error.message}`);
  }
}

function runNodeJson(scriptPath, args, label) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} terminated by ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return parseJson(result.stdout, label);
}

function packageVersionForCli(cliPath) {
  const packagePath = resolve(dirname(cliPath), '..', '..', 'package.json');
  if (!existsSync(packagePath)) return null;
  return parseJson(readFileSync(packagePath, 'utf8'), packagePath).version;
}

export function resolveGitNexusCli({ repoRoot = rootDir, env = process.env } = {}) {
  const candidates = [];
  if (env.GITNEXUS_CLI) candidates.push(resolve(env.GITNEXUS_CLI));
  candidates.push(join(repoRoot, 'node_modules', 'gitnexus', 'dist', 'cli', 'index.js'));

  const npmCache = env.npm_config_cache || join(homedir(), '.npm');
  const npxCache = join(npmCache, '_npx');
  if (existsSync(npxCache)) {
    for (const entry of readdirSync(npxCache).sort()) {
      candidates.push(join(npxCache, entry, 'node_modules', 'gitnexus', 'dist', 'cli', 'index.js'));
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const version = packageVersionForCli(candidate);
    if (version === SUPPORTED_GITNEXUS_VERSION) return candidate;
  }
  throw new Error(
    `GitNexus ${SUPPORTED_GITNEXUS_VERSION} is required as an external planning tool. Bootstrap it with `
      + `npx -y gitnexus@${SUPPORTED_GITNEXUS_VERSION} analyze . or set GITNEXUS_CLI to its dist/cli/index.js path.`
  );
}

export function assertFreshStatus(status, repoRoot = rootDir) {
  const failures = [];
  if (status?.status !== 'up-to-date') failures.push(`status=${status?.status ?? 'missing'}`);
  if (resolve(status?.repository || '/') !== resolve(repoRoot)) failures.push('repository mismatch');
  if (status?.workspaceIndexBranch !== null) failures.push('workspace branch index is active');
  if (!status?.index?.commit || status.index.commit !== status?.current?.commit) failures.push('commit mismatch');
  if (status?.index?.runnerIdentityStatus !== 'current') failures.push('runner identity is stale');
  if (!Array.isArray(status?.index?.incompleteReasons) || status.index.incompleteReasons.length > 0) {
    failures.push('index is incomplete');
  }
  if (status?.contentDrift?.status !== 'current') failures.push('content drift detected');
  if (failures.length > 0) {
    throw new Error(`GitNexus index is not authoritative (${failures.join(', ')}). Run gitnexus analyze first.`);
  }
  return status.index.commit;
}

export function assertCleanGitStatus(porcelainOutput) {
  const changes = String(porcelainOutput || '').trim();
  if (changes) {
    throw new Error('Git worktree is not clean. Generate the impact artifact before editing so evidence matches the pinned revision.');
  }
}

export function assertAuthoritativeImpact(impact, requestedTarget) {
  if (!impact || typeof impact !== 'object') throw new Error('GitNexus impact result is missing.');
  if (impact.error) throw new Error(`GitNexus impact error: ${impact.error}`);
  if (impact.status === 'ambiguous') throw new Error(`${impact.message || 'GitNexus target is ambiguous'}; use --uid.`);
  if (impact.partial === true || impact.partialProbe === true || impact.pagination?.truncated === true) {
    throw new Error('GitNexus impact result is partial or truncated. Refusing to render incomplete reachability.');
  }
  if (impact.staleness) throw new Error('GitNexus impact result is stale. Refresh the index first.');
  if (impact.direction !== 'upstream') throw new Error(`Expected upstream impact, received ${impact.direction}.`);
  if (!impact.target?.id) throw new Error('GitNexus impact result has no resolved target UID.');
  if (requestedTarget.startsWith('File:') || requestedTarget.includes(':')) {
    if (impact.target.id !== requestedTarget) throw new Error('GitNexus resolved a different target UID.');
  }
  if (!Number.isInteger(impact.impactedCount) || impact.impactedCount < 0) {
    throw new Error('GitNexus impactedCount is invalid.');
  }
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(impact.risk)) {
    throw new Error(`GitNexus risk '${impact.risk ?? 'missing'}' is not authoritative; manual review is required.`);
  }
  if (impact.epistemic !== 'exact') {
    throw new Error(`GitNexus epistemic status '${impact.epistemic ?? 'missing'}' is not exact.`);
  }
  if (!impact.byDepth || typeof impact.byDepth !== 'object') throw new Error('GitNexus depth data is missing.');
  if (!impact.byDepthCounts || typeof impact.byDepthCounts !== 'object') {
    throw new Error('GitNexus depth counts are missing.');
  }
  const countEntries = Object.entries(impact.byDepthCounts);
  const countedTotal = countEntries.reduce((total, [depth, count]) => {
    if (!/^\d+$/.test(depth) || Number(depth) < 1 || !Number.isInteger(count) || count < 0) {
      throw new Error('GitNexus depth counts are invalid.');
    }
    const nodes = impact.byDepth[depth];
    if (!Array.isArray(nodes) || nodes.length !== count) {
      throw new Error(`GitNexus depth ${depth} evidence does not match its declared count.`);
    }
    return total + count;
  }, 0);
  if (countedTotal !== impact.impactedCount) {
    throw new Error('GitNexus impactedCount does not match the complete depth evidence.');
  }
  const unexpectedDepth = Object.keys(impact.byDepth).find((depth) => !Object.hasOwn(impact.byDepthCounts, depth));
  if (unexpectedDepth) throw new Error(`GitNexus depth ${unexpectedDepth} has no declared count.`);
  const uniqueIds = new Set(Object.values(impact.byDepth).flat().map((node) => node?.id));
  if (uniqueIds.has(undefined) || uniqueIds.size !== impact.impactedCount) {
    throw new Error('GitNexus depth evidence contains missing or duplicate symbol UIDs.');
  }
  if (!Number.isInteger(impact.summary?.direct) || impact.summary.direct !== (impact.byDepthCounts['1'] || 0)) {
    throw new Error('GitNexus direct-caller summary does not match depth-one evidence.');
  }
  if (!Array.isArray(impact.affected_processes)
      || !Number.isInteger(impact.summary?.processes_affected)
      || impact.summary.processes_affected !== impact.affected_processes.length) {
    throw new Error('GitNexus affected-process summary is inconsistent.');
  }
  return impact;
}

function shortText(value, max = 34) {
  const text = String(value || 'Unknown').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function componentId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`;
}

function sourceFor(node) {
  if (!node?.filePath) return undefined;
  const source = { path: node.filePath };
  if (Number.isInteger(node.startLine) && node.startLine > 0) source.line = node.startLine;
  if (Number.isInteger(node.endLine) && node.endLine >= (source.line || 1)) source.end_line = node.endLine;
  return [source];
}

function makeNodeComponent(node, depth, index, x) {
  const component = {
    id: componentId('impact', node.id || `${depth}:${node.filePath}:${node.name}`),
    type: 'backend',
    label: shortText(node.name || basename(node.filePath || 'Affected symbol'), 28),
    sublabel: shortText(node.filePath || node.type || node.relationType || 'Indexed symbol', 44),
    tag: depth === 1 ? 'DIRECT · D1' : `TRANSITIVE · D${depth}`,
    pos: [x, 80 + index * 110],
    size: [210, 72],
  };
  const sources = sourceFor(node);
  if (sources) component.sources = sources;
  return component;
}

export function buildImpactArchitecture(impact, { revision, repositoryUrl } = {}) {
  const direct = Array.isArray(impact.byDepth?.['1']) ? impact.byDepth['1'].slice(0, 4) : [];
  const processes = Array.isArray(impact.affected_processes) ? impact.affected_processes.slice(0, 2) : [];

  const target = {
    id: 'target',
    type: 'backend',
    label: shortText(impact.target.name || impact.target.id, 30),
    sublabel: shortText(impact.target.filePath || impact.target.type || impact.target.id, 48),
    tag: `TARGET · ${impact.risk}`,
    pos: [60, 300],
    size: [220, 78],
  };
  const targetSources = sourceFor(impact.target);
  if (targetSources) target.sources = targetSources;

  const impactSurface = {
    id: 'impact_surface',
    type: 'backend',
    label: 'Upstream impact surface',
    sublabel: `${impact.impactedCount} affected symbols`,
    tag: `${impact.summary?.processes_affected ?? processes.length} FLOWS`,
    pos: [370, 300],
    size: [210, 78],
  };
  const components = [target, impactSurface];
  const connections = [{
    id: 'edge_target_impact_surface',
    from: 'target',
    to: 'impact_surface',
    variant: 'emphasis',
    fromSide: 'right',
    toSide: 'left',
  }];
  direct.forEach((node, index) => {
    const component = makeNodeComponent(node, 1, index, 700);
    components.push(component);
    connections.push({
      id: componentId('edge', `direct:${component.id}`),
      from: 'impact_surface',
      to: component.id,
      variant: 'emphasis',
      fromSide: 'right',
      toSide: 'left',
    });
  });
  processes.forEach((process, index) => {
    const id = componentId('flow', process.id || process.name || process.summary || index);
    components.push({
      id,
      type: 'backend',
      label: shortText(process.summary || process.name || process.id || 'Execution flow', 30),
      sublabel: 'Affected execution flow',
      tag: 'FLOW',
      pos: [700, 80 + (direct.length + index) * 110],
      size: [220, 72],
    });
    connections.push({
      id: componentId('edge', `flow:${id}`),
      from: 'impact_surface',
      to: id,
      variant: 'dashed',
      fromSide: 'right',
      toSide: 'left',
    });
  });

  const represented = direct.length;
  const omitted = Math.max(0, impact.impactedCount - represented);
  if (omitted > 0 && components.length < MAX_VISIBLE_COMPONENTS) {
    const id = 'impact_rollup';
    components.push({
      id,
      type: 'backend',
      label: 'Transitive impact rollup',
      sublabel: `${omitted} affected symbols grouped`,
      tag: 'AGGREGATE',
      pos: [700, 80 + (direct.length + processes.length) * 110],
      size: [240, 72],
    });
    connections.push({
      id: 'edge_impact_rollup',
      from: 'impact_surface',
      to: id,
      variant: 'dashed',
      fromSide: 'right',
      toSide: 'left',
    });
  }

  const meta = {
    title: `Upstream blast radius: ${shortText(impact.target.name || impact.target.id, 64)}`,
    quality_profile: 'showcase',
    views: [
      { id: 'target-view', label: 'Changed target', focus: ['target'], note: 'The symbol or file being evaluated before editing.' },
      {
        id: 'impact-view',
        label: 'Affected reach',
        focus: components.filter((component) => component.tag !== 'FLOW').map((component) => component.id),
        note: 'Direct, transitive, and aggregated upstream impact from GitNexus.',
      },
    ],
  };
  if (repositoryUrl && /^[a-fA-F0-9]{40}$/.test(revision || '')) {
    meta.repository = {
      url: repositoryUrl,
      revision,
    };
  }

  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta,
    components,
    connections,
    cards: [
      {
        dot: impact.risk === 'CRITICAL' ? 'rose' : impact.risk === 'HIGH' ? 'orange' : impact.risk === 'MEDIUM' ? 'amber' : 'emerald',
        title: 'Risk assessment',
        items: [`GitNexus risk: ${impact.risk}`, `Affected symbols: ${impact.impactedCount}`, `Direct callers: ${impact.summary?.direct ?? direct.length}`],
      },
      {
        dot: 'cyan',
        title: 'Execution reach',
        items: [`Affected processes: ${impact.summary?.processes_affected ?? processes.length}`, `Visible symbols: ${represented}`, `Grouped symbols: ${omitted}`],
      },
      {
        dot: 'violet',
        title: 'Evidence contract',
        items: ['Upstream direction only', 'Fresh, complete GitNexus index required', 'Full machine result retained in the report sidecar'],
      },
    ],
  };
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--uid') options.uid = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--spec') options.spec = argv[++index];
    else if (arg === '--report') options.report = argv[++index];
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  const target = options.uid || positional[0];
  if (!target) throw new Error('Usage: npm run visual-architecture:impact -- <symbol> [--uid <GitNexus UID>] [--output <file.html>]');
  return { ...options, target };
}

function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'impact';
}

function normalizeRemoteUrl(url) {
  const value = String(url || '').trim();
  const sshMatch = value.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  return value.replace(/\.git$/, '');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const gitStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (gitStatus.error || gitStatus.status !== 0) throw new Error('Unable to verify the Git worktree state.');
  assertCleanGitStatus(gitStatus.stdout);
  const gitNexusCli = resolveGitNexusCli();
  const status = runNodeJson(gitNexusCli, ['status', '--json'], 'GitNexus status');
  const revision = assertFreshStatus(status);
  const impactArgs = ['impact'];
  if (options.uid) impactArgs.push('--uid', options.uid);
  else impactArgs.push(options.target);
  impactArgs.push('--direction', 'upstream', '--depth', '3', '--limit', '1000', '--repo', rootDir);
  const impact = assertAuthoritativeImpact(runNodeJson(gitNexusCli, impactArgs, 'GitNexus impact'), options.target);

  const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: rootDir, encoding: 'utf8' });
  const repositoryUrl = remote.status === 0 ? normalizeRemoteUrl(remote.stdout) : rootDir;
  const spec = buildImpactArchitecture(impact, { revision, repositoryUrl });
  const targetKey = `${safeSlug(impact.target.name)}-${createHash('sha256').update(impact.target.id).digest('hex').slice(0, 10)}`;
  const output = resolve(rootDir, options.output || `.gitnexus/visuals/${targetKey}.architecture.html`);
  const specPath = resolve(rootDir, options.spec || output.replace(/\.html$/i, '.json'));
  const reportPath = resolve(rootDir, options.report || output.replace(/\.html$/i, '.impact.json'));
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(specPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(reportPath, `${JSON.stringify({ schema_version: 1, revision, target_uid: impact.target.id, impact }, null, 2)}\n`, 'utf8');

  const archifyBin = join(rootDir, 'node_modules', '@tt-a1i', 'archify-dsh', 'skills', 'archify', 'bin', 'archify.mjs');
  if (!existsSync(archifyBin)) throw new Error('Archify CLI is missing. Run npm ci first.');
  const delivery = spawnSync(
    process.execPath,
    [archifyBin, 'deliver', 'architecture', specPath, output, '--quality', 'showcase', '--repo-root', rootDir, '--json'],
    { cwd: rootDir, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
  );
  if (delivery.error) throw delivery.error;
  if (delivery.status !== 0) throw new Error(`Archify delivery failed: ${(delivery.stderr || delivery.stdout).trim()}`);
  const receipt = parseJson(delivery.stdout, 'Archify delivery');
  if (!receipt.ok || receipt.validation?.compositionStatus !== 'pass') throw new Error('Archify delivery did not pass showcase validation.');

  console.log(JSON.stringify({
    ok: true,
    target: impact.target,
    risk: impact.risk,
    impactedCount: impact.impactedCount,
    output: relative(rootDir, output),
    specification: relative(rootDir, specPath),
    report: relative(rootDir, reportPath),
    receipt,
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
