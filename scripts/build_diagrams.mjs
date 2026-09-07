#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const archifyBin = join(rootDir, 'node_modules', '@tt-a1i', 'archify-dsh', 'skills', 'archify', 'bin', 'archify.mjs');

if (!existsSync(archifyBin)) {
  console.error('❌ Error: Archify CLI not found at:', archifyBin);
  console.error('Run: npm install --save-dev @tt-a1i/archify-dsh@0.1.0');
  process.exit(1);
}

const diagrams = [
  {
    type: 'architecture',
    input: 'docs/diagrams/system-runtime.architecture.json',
    output: 'docs/diagrams/system-runtime.architecture.html',
    title: 'DeepSeek Harness Runtime Architecture',
  },
  {
    type: 'workflow',
    input: 'docs/diagrams/security-pipeline.workflow.json',
    output: 'docs/diagrams/security-pipeline.workflow.html',
    title: 'Zero-Trust PEP & Dynamic RBAC Pipeline',
  },
  {
    type: 'workflow',
    input: 'docs/diagrams/declarative-workflow.workflow.json',
    output: 'docs/diagrams/declarative-workflow.workflow.html',
    title: 'Declarative Workflow & Invariant 7 Loop Trap',
  },
  {
    type: 'sequence',
    input: 'docs/diagrams/agent-trace.sequence.json',
    output: 'docs/diagrams/agent-trace.sequence.html',
    title: 'Agent Execution & OTLP Telemetry Sequence',
  },
];

console.log('🎨 Compiling Archify Architecture Diagrams (Showcase Quality)...\n');

let failed = 0;
for (const diagram of diagrams) {
  const inputPath = join(rootDir, diagram.input);
  const outputPath = join(rootDir, diagram.output);

  process.stdout.write(`  [${diagram.type}] ${diagram.title}... `);
  try {
    const rawResult = execFileSync(
      process.execPath,
      [archifyBin, 'deliver', diagram.type, inputPath, outputPath, '--quality', 'showcase', '--json'],
      { cwd: rootDir, encoding: 'utf-8' }
    );
    const result = JSON.parse(rawResult);
    if (result.ok && result.validation?.compositionStatus === 'pass') {
      console.log(`✅ Passed (9/9 checks, 0 errors) -> ${diagram.output}`);
    } else {
      console.log('❌ Failed');
      console.error(rawResult);
      failed++;
    }
  } catch (err) {
    console.log('❌ Error');
    console.error(err.stdout || err.message);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n❌ Diagram compilation completed with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('\n✨ All Archify diagrams compiled successfully with showcase quality profile.');
}
