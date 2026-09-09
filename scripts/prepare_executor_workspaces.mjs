#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function desiredMode(stat, writable) {
  if (stat.isDirectory()) return writable ? 0o770 : 0o750;
  const owner = stat.mode & 0o700;
  const group = writable ? (stat.mode & 0o100 ? 0o070 : 0o060) : (stat.mode & 0o100 ? 0o050 : 0o040);
  return owner | group;
}

function visit(root, writable, gid, apply, report) {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) {
    report.skippedSymlinks.push(root);
    return;
  }
  const mode = desiredMode(stat, writable);
  report.entries.push({ path: root, gid, mode: mode.toString(8).padStart(4, '0') });
  if (apply) {
    fs.chownSync(root, stat.uid, gid);
    fs.chmodSync(root, mode);
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(root)) visit(path.join(root, entry), writable, gid, apply, report);
  }
}

export function prepareExecutorWorkspaces({ workspaceRoot, gid, apply = false }) {
  const root = path.resolve(workspaceRoot);
  if (!Number.isSafeInteger(gid) || gid < 0) throw new Error('gid must be a non-negative integer');
  const report = { root, gid, apply, entries: [], skippedSymlinks: [] };
  visit(path.join(root, 'users'), true, gid, apply, report);
  visit(path.join(root, 'cases'), true, gid, apply, report);
  visit(path.join(root, 'shared'), false, gid, apply, report);
  return report;
}

function parseArgs(argv) {
  let workspaceRoot = path.resolve('workspaces');
  let gid = Number(process.env.DSH_GID || process.getgid?.() || 1000);
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') apply = true;
    else if (argv[index] === '--root') workspaceRoot = path.resolve(argv[++index] || '');
    else if (argv[index] === '--gid') gid = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { workspaceRoot, gid, apply };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = prepareExecutorWorkspaces(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`prepare-executor-workspaces: ${error.message}\n`);
    process.exitCode = 1;
  }
}
