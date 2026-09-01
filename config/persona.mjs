#!/usr/bin/env node

/**
 * 🎭 Advanced Multi-Model Persona Package Manager
 * Manages complete persona bundles with Task-to-Model Routing Matrix, Skills, MCPs, and Workflows.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PERSONAS_DIR = path.resolve(process.cwd(), 'config/personas');
const SKILLS_DIR = path.resolve(process.cwd(), 'config/skills');
const TEMPLATES_DIR = path.resolve(process.cwd(), 'config/templates/personas');
const SETTINGS_FILE = path.resolve(process.cwd(), 'config/settings.yaml');

function ensureDirs() {
  if (!fs.existsSync(PERSONAS_DIR)) fs.mkdirSync(PERSONAS_DIR, { recursive: true });
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

function parsePersonaYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = { models: {}, plugins: [], mcpServers: {}, workflows: {} };

  const nameM = content.match(/^name:\s*(.+)$/m);
  if (nameM) result.name = nameM[1].trim();

  const titleM = content.match(/^title:\s*["']?(.+?)["']?$/m);
  if (titleM) result.title = titleM[1].trim();

  const descM = content.match(/^description:\s*["']?(.+?)["']?$/m);
  if (descM) result.description = descM[1].trim();

  // Parse Multi-Model Matrix
  const modelsMatch = content.match(/models:\s*\n([\s\S]*?)(?=\n[a-zA-Z0-9_-]+:|$)/);
  if (modelsMatch) {
    const lines = modelsMatch[1].split('\n');
    let currentTier = null;
    for (const line of lines) {
      const tierM = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (tierM) {
        currentTier = tierM[1];
        result.models[currentTier] = {};
        continue;
      }
      if (currentTier) {
        const pM = line.match(/^\s+provider:\s*(.+)$/);
        if (pM) result.models[currentTier].provider = pM[1].trim();
        const mM = line.match(/^\s+model:\s*(.+)$/);
        if (mM) result.models[currentTier].model = mM[1].trim();
        const tM = line.match(/^\s+temperature:\s*(.+)$/);
        if (tM) result.models[currentTier].temperature = parseFloat(tM[1].trim());
        const uM = line.match(/^\s+useCase:\s*["']?(.+?)["']?$/);
        if (uM) result.models[currentTier].useCase = uM[1].trim();
      }
    }
  } else {
    // Fallback single model
    const pM = content.match(/provider:\s*(.+)$/m);
    const mM = content.match(/model:\s*(.+)$/m);
    if (pM && mM) {
      result.models.default = { provider: pM[1].trim(), model: mM[1].trim() };
    }
  }

  // Parse Workflows
  const wfMatch = content.match(/workflows:\s*\n([\s\S]*?)(?=\n[a-zA-Z0-9_-]+:|$)/);
  if (wfMatch) {
    const lines = wfMatch[1].split('\n');
    let currentWf = null;
    for (const line of lines) {
      const wfM = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (wfM) {
        currentWf = wfM[1];
        result.workflows[currentWf] = {};
        continue;
      }
      if (currentWf) {
        const tierM = line.match(/^\s+modelTier:\s*(.+)$/);
        if (tierM) result.workflows[currentWf].modelTier = tierM[1].trim();
        const cmdM = line.match(/^\s+command:\s*["']?(.+?)["']?$/);
        if (cmdM) result.workflows[currentWf].command = cmdM[1].trim();
      }
    }
  }

  return result;
}

function listPersonas() {
  ensureDirs();
  console.log('========================================================================');
  console.log('🎭 DeepSeek Harness AI Personas (Multi-Model Matrix Enabled)');
  console.log('========================================================================');

  console.log('\n📦 Active Personas (in config/personas/):');
  const installed = fs.readdirSync(PERSONAS_DIR).filter(f => {
    return fs.statSync(path.join(PERSONAS_DIR, f)).isDirectory() &&
           fs.existsSync(path.join(PERSONAS_DIR, f, 'persona.yaml'));
  });

  if (installed.length === 0) {
    console.log('  (No custom personas configured yet. Create one with: ./dsh.sh persona create <name>)');
  } else {
    for (const name of installed) {
      const meta = parsePersonaYaml(path.join(PERSONAS_DIR, name, 'persona.yaml'));
      const title = meta.title || name;
      console.log(`\n  🔹 \x1b[32m${name}\x1b[0m — \x1b[1m${title}\x1b[0m`);
      console.log(`     \x1b[90mDesc:\x1b[0m ${meta.description || 'Specialized AI Persona'}`);
      console.log(`     \x1b[90mTask-to-Model Matrix:\x1b[0m`);
      for (const [tier, m] of Object.entries(meta.models)) {
        console.log(`       • \x1b[33m${tier.padEnd(10)}\x1b[0m → \x1b[36m${m.provider}/${m.model}\x1b[0m ${m.useCase ? `\x1b[90m(${m.useCase})\x1b[0m` : ''}`);
      }
    }
  }

  console.log('\n📋 Available Persona Starter Templates:');
  const templates = fs.readdirSync(TEMPLATES_DIR).filter(f => {
    return fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory() &&
           fs.existsSync(path.join(TEMPLATES_DIR, f, 'persona.yaml'));
  });
  for (const t of templates) {
    const meta = parsePersonaYaml(path.join(TEMPLATES_DIR, t, 'persona.yaml'));
    console.log(`  🔸 \x1b[36m${t.padEnd(18)}\x1b[0m — ${meta.title || t}`);
  }

  console.log('\n💡 Execution & Routing Commands:');
  console.log('  ./dsh.sh persona create <name> --template <tmpl>   # Create new persona package');
  console.log('  ./dsh.sh persona run <name> "<prompt>"             # Run with default task model');
  console.log('  ./dsh.sh persona run <name> --tier <tier> "<prompt>" # Run with specific model tier (e.g. reasoning, audit)');
  console.log('  ./dsh.sh persona workflow <name> <workflow-key>    # Run automated workflow');
  console.log('  ./dsh.sh persona apply <name>                      # Set as active default in UI');
  console.log('========================================================================');
}

function createPersona(name, templateName = 'data-analyst') {
  ensureDirs();
  if (!name) {
    console.error('❌ Error: Persona name is required. Usage: ./dsh.sh persona create <name>');
    process.exit(1);
  }

  const targetDir = path.join(PERSONAS_DIR, name);
  const targetSkillDir = path.join(SKILLS_DIR, name);

  if (fs.existsSync(targetDir)) {
    console.error(`❌ Error: Persona '${name}' already exists at config/personas/${name}/`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(targetSkillDir, { recursive: true });

  const templateDir = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(templateDir)) {
    console.error(`❌ Error: Template '${templateName}' not found in config/templates/personas/`);
    process.exit(1);
  }

  for (const file of fs.readdirSync(templateDir)) {
    let content = fs.readFileSync(path.join(templateDir, file), 'utf8');
    content = content.replace(/name:\s*[\w-]+/m, `name: ${name}`);
    fs.writeFileSync(path.join(targetDir, file), content, 'utf8');
  }

  if (fs.existsSync(path.join(targetDir, 'workflow.sh'))) {
    fs.chmodSync(path.join(targetDir, 'workflow.sh'), 0o755);
  }

  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
    fs.copyFileSync(path.join(targetDir, 'SKILL.md'), path.join(targetSkillDir, 'SKILL.md'));
  }

  console.log('========================================================================');
  console.log(`✅ Persona Package '${name}' created successfully with Multi-Model Matrix!`);
  console.log(`📁 Package Path: config/personas/${name}/`);
  console.log(`📁 Skill Active: config/skills/${name}/SKILL.md`);
  console.log('========================================================================');
}

function applyPersona(name, tier = 'default') {
  const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Persona '${name}' not found.`);
    process.exit(1);
  }

  const meta = parsePersonaYaml(manifestPath);
  const targetModel = meta.models[tier] || meta.models.default;

  if (targetModel && fs.existsSync(SETTINGS_FILE)) {
    let settings = fs.readFileSync(SETTINGS_FILE, 'utf8');
    settings = settings.replace(/agent-default-model:\s*\n\s*provider:\s*\w+\s*\n\s*model:\s*[\w\-\/\.:]+/m,
      `agent-default-model:\n  provider: ${targetModel.provider}\n  model: ${targetModel.model}`);
    fs.writeFileSync(SETTINGS_FILE, settings, 'utf8');
    console.log(`✅ Applied default model: ${targetModel.provider}/${targetModel.model} (${tier} tier) for persona '${name}'`);
  }
}

function runPersona(name, prompt, tier = 'default') {
  if (!name || !prompt) {
    console.error('❌ Usage: ./dsh.sh persona run <name> [--tier <tier>] "<prompt>"');
    process.exit(1);
  }

  const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
  const tempPatchFile = path.resolve(process.cwd(), 'config/patch.tmp.yaml');
  let modelOverride = '';

  if (fs.existsSync(manifestPath)) {
    const meta = parsePersonaYaml(manifestPath);
    const chosenModel = meta.models[tier] || meta.models.default;
    if (chosenModel) {
      console.log(`🤖 Invoking persona \x1b[32m${name}\x1b[0m using \x1b[33m[${tier}]\x1b[0m tier: \x1b[36m${chosenModel.provider}/${chosenModel.model}\x1b[0m`);
      const patchContent = `- id: agent-default-model\n  config:\n    provider: ${chosenModel.provider}\n    model: ${chosenModel.model}\n`;
      fs.writeFileSync(tempPatchFile, patchContent, 'utf8');
      modelOverride = `--patch /root/.dsh/patch.tmp.yaml`;
    }
  }

  const fullPrompt = `Using the ${name} skill, ${prompt}`;
  const cmd = `docker compose exec dsh dsh --profile headless ${modelOverride} "${fullPrompt}"`;
  try {
    execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function runWorkflow(name, workflowKey) {
  const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Persona '${name}' not found.`);
    process.exit(1);
  }

  const meta = parsePersonaYaml(manifestPath);
  if (!workflowKey || !meta.workflows[workflowKey]) {
    console.log(`Available workflows for persona '${name}':`);
    for (const [k, v] of Object.entries(meta.workflows)) {
      console.log(`  • \x1b[36m${k}\x1b[0m (tier: ${v.modelTier || 'default'}): ${v.command}`);
    }
    return;
  }

  const wf = meta.workflows[workflowKey];
  const tier = wf.modelTier || 'default';
  console.log(`🚀 Running workflow '\x1b[36m${workflowKey}\x1b[0m' for persona '\x1b[32m${name}\x1b[0m' (Model Tier: \x1b[33m${tier}\x1b[0m)...`);
  runPersona(name, wf.command.replace(new RegExp(`^Using the ${name} skill,\\s*`), ''), tier);
}

function showPersona(name) {
  const pDir = path.join(PERSONAS_DIR, name);
  if (!fs.existsSync(pDir)) {
    console.error(`❌ Persona '${name}' not found.`);
    process.exit(1);
  }
  console.log(`=== config/personas/${name}/persona.yaml ===`);
  if (fs.existsSync(path.join(pDir, 'persona.yaml'))) console.log(fs.readFileSync(path.join(pDir, 'persona.yaml'), 'utf8'));
  console.log(`\n=== config/personas/${name}/SKILL.md ===`);
  if (fs.existsSync(path.join(pDir, 'SKILL.md'))) console.log(fs.readFileSync(path.join(pDir, 'SKILL.md'), 'utf8'));
}

// Argument Parsing
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] || 'list';

let tier = 'default';
let filteredArgs = [];
for (let i = 1; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--tier' || rawArgs[i] === '-t' || rawArgs[i] === '--task-model') {
    tier = rawArgs[i + 1] || 'default';
    i++;
  } else {
    filteredArgs.push(rawArgs[i]);
  }
}

switch (command) {
  case 'list':
  case 'ls':
    listPersonas();
    break;

  case 'create':
  case 'new': {
    const name = filteredArgs[0];
    let template = 'data-analyst';
    const tIdx = rawArgs.indexOf('--template');
    if (tIdx !== -1 && rawArgs[tIdx + 1]) template = rawArgs[tIdx + 1];
    createPersona(name, template);
    break;
  }

  case 'apply':
  case 'activate':
    applyPersona(filteredArgs[0], tier);
    break;

  case 'run':
    runPersona(filteredArgs[0], filteredArgs[1], tier);
    break;

  case 'workflow':
  case 'wf':
    runWorkflow(filteredArgs[0], filteredArgs[1]);
    break;

  case 'show':
  case 'cat':
    showPersona(filteredArgs[0]);
    break;

  default:
    console.log('Usage: ./dsh.sh persona [list | create <name> --template <tmpl> | apply <name> | run <name> [--tier <tier>] "<prompt>" | workflow <name> <wf>]');
}
