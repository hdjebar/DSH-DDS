#!/usr/bin/env node

/**
 * 🎭 Comprehensive Persona Package Manager
 * Manages full persona bundles: Skills + Provider/Model + Plugins + MCP Servers + Workflows.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PERSONAS_DIR = path.resolve(process.cwd(), 'config/personas');
const SKILLS_DIR = path.resolve(process.cwd(), 'config/skills');
const TEMPLATES_DIR = path.resolve(process.cwd(), 'config/templates/personas');
const SETTINGS_FILE = path.resolve(process.cwd(), 'config/settings.yaml');
const CORDIS_PATCH = path.resolve(process.cwd(), 'config/profiles/web/cordis.patch.yml');

function ensureDirs() {
  if (!fs.existsSync(PERSONAS_DIR)) fs.mkdirSync(PERSONAS_DIR, { recursive: true });
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

function parseYamlSimple(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  
  const nameM = content.match(/^name:\s*(.+)$/m);
  if (nameM) result.name = nameM[1].trim();
  
  const titleM = content.match(/^title:\s*["']?(.+?)["']?$/m);
  if (titleM) result.title = titleM[1].trim();

  const descM = content.match(/^description:\s*["']?(.+?)["']?$/m);
  if (descM) result.description = descM[1].trim();

  const modelBlock = content.match(/model:\s*\n\s*provider:\s*([^\n\r]+)\s*\n\s*model:\s*([^\n\r]+)/m);
  if (modelBlock) {
    result.model = { provider: modelBlock[1].trim(), model: modelBlock[2].trim() };
  } else {
    const providerM = content.match(/^\s*provider:\s*([^\n\r]+)$/m);
    const modelM = content.match(/^\s*model:\s*([^\n\r]+)$/m);
    if (providerM && modelM) {
      result.model = { provider: providerM[1].trim(), model: modelM[1].trim() };
    }
  }

  return result;
}

function listPersonas() {
  ensureDirs();
  console.log('========================================================================');
  console.log('🎭 DeepSeek Harness AI Personas & Specialized Workspaces');
  console.log('========================================================================');

  // 1. Installed Full Persona Packages
  console.log('\n📦 Active Personas (in config/personas/):');
  const installed = fs.readdirSync(PERSONAS_DIR).filter(f => {
    return fs.statSync(path.join(PERSONAS_DIR, f)).isDirectory() &&
           fs.existsSync(path.join(PERSONAS_DIR, f, 'persona.yaml'));
  });

  if (installed.length === 0) {
    console.log('  (No custom personas configured yet. Create one with: ./dsh.sh persona create <name>)');
  } else {
    for (const name of installed) {
      const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
      const meta = parseYamlSimple(manifestPath);
      const title = meta.title || name;
      const model = meta.model ? `${meta.model.provider}/${meta.model.model}` : 'default';
      console.log(`  🔹 \x1b[32m${name}\x1b[0m — \x1b[1m${title}\x1b[0m`);
      console.log(`     \x1b[90mModel:\x1b[0m ${model}`);
      console.log(`     \x1b[90mDesc:\x1b[0m  ${meta.description || 'Specialized AI Persona'}`);
    }
  }

  // 2. Available Starter Templates
  console.log('\n📋 Available Persona Starter Templates:');
  const templates = fs.readdirSync(TEMPLATES_DIR).filter(f => {
    return fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory() &&
           fs.existsSync(path.join(TEMPLATES_DIR, f, 'persona.yaml'));
  });
  for (const t of templates) {
    const meta = parseYamlSimple(path.join(TEMPLATES_DIR, t, 'persona.yaml'));
    console.log(`  🔸 \x1b[36m${t}\x1b[0m — ${meta.title || t}`);
  }

  console.log('\n💡 Commands:');
  console.log('  ./dsh.sh persona create <name> --template <template>   # Scaffold new persona package');
  console.log('  ./dsh.sh persona apply <name>                         # Switch active model to persona');
  console.log('  ./dsh.sh persona run <name> "<prompt>"                # Execute task with persona');
  console.log('  ./dsh.sh persona workflow <name> [action]             # Run defined persona workflow');
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

  // Copy template files
  for (const file of fs.readdirSync(templateDir)) {
    let content = fs.readFileSync(path.join(templateDir, file), 'utf8');
    content = content.replace(/name:\s*[\w-]+/m, `name: ${name}`);
    fs.writeFileSync(path.join(targetDir, file), content, 'utf8');
  }

  // Make workflow executable
  if (fs.existsSync(path.join(targetDir, 'workflow.sh'))) {
    fs.chmodSync(path.join(targetDir, 'workflow.sh'), 0o755);
  }

  // Copy SKILL.md into config/skills/<name>/SKILL.md for instant DSH discovery
  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
    fs.copyFileSync(path.join(targetDir, 'SKILL.md'), path.join(targetSkillDir, 'SKILL.md'));
  }

  console.log('========================================================================');
  console.log(`✅ Persona Package '${name}' successfully created!`);
  console.log(`📁 Package Path:  config/personas/${name}/`);
  console.log(`   ├── persona.yaml   (Model, plugins, MCP servers)`);
  console.log(`   ├── SKILL.md       (Domain instructions & rules)`);
  console.log(`   └── workflow.sh    (Ready-to-run automation recipes)`);
  console.log(`📁 Skill Active:  config/skills/${name}/SKILL.md`);
  console.log(`\n🚀 Ready to use:`);
  console.log(`   ./dsh.sh persona apply ${name}              # Set as active workspace persona`);
  console.log(`   ./dsh.sh persona run ${name} "<prompt>"     # Run one-shot headless task`);
  console.log('========================================================================');
}

function applyPersona(name) {
  const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Error: Persona '${name}' not found at config/personas/${name}/persona.yaml`);
    process.exit(1);
  }

  const meta = parseYamlSimple(manifestPath);
  if (meta.model && fs.existsSync(SETTINGS_FILE)) {
    let settings = fs.readFileSync(SETTINGS_FILE, 'utf8');
    settings = settings.replace(/agent-default-model:\s*\n\s*provider:\s*\w+\s*\n\s*model:\s*[\w\-\/\.:]+/m,
      `agent-default-model:\n  provider: ${meta.model.provider}\n  model: ${meta.model.model}`);
    fs.writeFileSync(SETTINGS_FILE, settings, 'utf8');
    console.log(`✅ Applied default model: ${meta.model.provider}/${meta.model.model} for persona '${name}'`);
  }

  console.log(`🚀 Persona '${name}' is now active in your workspace.`);
}

function runPersona(name, prompt) {
  if (!name || !prompt) {
    console.error('❌ Usage: ./dsh.sh persona run <name> "<prompt>"');
    process.exit(1);
  }

  const manifestPath = path.join(PERSONAS_DIR, name, 'persona.yaml');
  let modelOverride = '';
  if (fs.existsSync(manifestPath)) {
    const meta = parseYamlSimple(manifestPath);
    if (meta.model) {
      modelOverride = `--patch <(echo "- id: agent-default-model\n  config:\n    provider: ${meta.model.provider}\n    model: ${meta.model.model}")`;
    }
  }

  const fullPrompt = `Using the ${name} skill, ${prompt}`;
  const cmd = `docker compose exec dsh dsh --profile headless ${modelOverride} "${fullPrompt}"`;
  console.log(`🚀 Executing persona '${name}'...`);
  try {
    execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

function runWorkflow(name, action = '') {
  const workflowScript = path.join(PERSONAS_DIR, name, 'workflow.sh');
  if (!fs.existsSync(workflowScript)) {
    console.error(`❌ No workflow.sh found for persona '${name}'`);
    process.exit(1);
  }
  try {
    execSync(`bash "${workflowScript}" ${action}`, { stdio: 'inherit' });
  } catch (err) {
    process.exit(err.status || 1);
  }
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

// Command dispatch
const args = process.argv.slice(2);
const command = args[0] || 'list';

switch (command) {
  case 'list':
  case 'ls':
    listPersonas();
    break;

  case 'create':
  case 'new': {
    const name = args[1];
    let template = 'data-analyst';
    const tIdx = args.indexOf('--template');
    if (tIdx !== -1 && args[tIdx + 1]) template = args[tIdx + 1];
    createPersona(name, template);
    break;
  }

  case 'apply':
  case 'activate':
    applyPersona(args[1]);
    break;

  case 'run':
    runPersona(args[1], args[2]);
    break;

  case 'workflow':
  case 'wf':
    runWorkflow(args[1], args[2]);
    break;

  case 'show':
  case 'cat':
    showPersona(args[1]);
    break;

  default:
    console.log('Usage: ./dsh.sh persona [list | create <name> --template <tmpl> | apply <name> | run <name> "<prompt>" | workflow <name> [act]]');
}
