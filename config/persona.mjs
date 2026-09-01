#!/usr/bin/env node

/**
 * 🎭 Persona Template Scaffolder & Manager
 * Create, customize, and list AI agent personas for DSH Web UI and CLI.
 */

import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.resolve(process.cwd(), 'config/skills');
const TEMPLATES_DIR = path.resolve(process.cwd(), 'config/templates/personas');

function ensureDirs() {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

function listPersonas() {
  ensureDirs();
  console.log('========================================================');
  console.log('🎭 DeepSeek Harness AI Personas');
  console.log('========================================================');

  // Installed Skills
  console.log('\n📦 Active Personas (in config/skills/):');
  const installed = fs.readdirSync(SKILLS_DIR).filter(f => {
    return fs.statSync(path.join(SKILLS_DIR, f)).isDirectory() &&
           fs.existsSync(path.join(SKILLS_DIR, f, 'SKILL.md'));
  });

  if (installed.length === 0) {
    console.log('  (No custom personas installed yet. Create one with: ./dsh.sh persona create <name>)');
  } else {
    for (const name of installed) {
      const content = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
      const descMatch = content.match(/description:\s*(.+)/);
      const desc = descMatch ? descMatch[1] : 'Active custom persona';
      console.log(`  🔹 \x1b[32m${name}\x1b[0m — \x1b[90m${desc}\x1b[0m`);
    }
  }

  // Available Templates
  console.log('\n📋 Available Templates (in config/templates/personas/):');
  const templates = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
  for (const t of templates) {
    const tName = t.replace('.md', '');
    console.log(`  🔸 \x1b[36m${tName}\x1b[0m`);
  }
  console.log('\n💡 To create a persona: ./dsh.sh persona create <name> --template <template>');
  console.log('========================================================');
}

function createPersona(name, templateName = 'base-template', title, description) {
  ensureDirs();
  if (!name) {
    console.error('❌ Error: Persona name is required. Usage: ./dsh.sh persona create <name>');
    process.exit(1);
  }

  const targetDir = path.join(SKILLS_DIR, name);
  const targetFile = path.join(targetDir, 'SKILL.md');

  if (fs.existsSync(targetFile)) {
    console.error(`❌ Error: Persona '${name}' already exists at config/skills/${name}/SKILL.md`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const templateFile = path.join(TEMPLATES_DIR, `${templateName}.md`);
  let content = '';

  if (fs.existsSync(templateFile)) {
    content = fs.readFileSync(templateFile, 'utf8');
  } else {
    console.log(`⚠️ Template '${templateName}' not found. Using base template.`);
    const baseFile = path.join(TEMPLATES_DIR, 'base-template.md');
    content = fs.existsSync(baseFile) ? fs.readFileSync(baseFile, 'utf8') : '';
  }

  // Replace placeholders
  const cleanTitle = title || name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const cleanDesc = description || `Specialized AI persona for ${cleanTitle} workflows.`;

  content = content
    .replace(/\{\{PERSONA_NAME\}\}/g, name)
    .replace(/\{\{PERSONA_TITLE\}\}/g, cleanTitle)
    .replace(/\{\{PERSONA_DESCRIPTION\}\}/g, cleanDesc)
    .replace(/\{\{PERSONA_OBJECTIVE\}\}/g, `You are a dedicated specialist in ${cleanTitle}.`)
    .replace(/\{\{EXAMPLE_INPUT\}\}/g, `Execute a ${cleanTitle} task`);

  fs.writeFileSync(targetFile, content, 'utf8');

  console.log('========================================================');
  console.log(`✅ Persona '${name}' successfully created!`);
  console.log(`📁 File: config/skills/${name}/SKILL.md`);
  console.log(`🚀 Ready to use immediately in Web UI or via:`);
  console.log(`   ./dsh.sh run "Using the ${name} skill, <your task>"`);
  console.log('========================================================');
}

function showPersona(name) {
  if (!name) {
    console.error('❌ Error: Persona name required.');
    process.exit(1);
  }
  const file = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(file)) {
    console.error(`❌ Error: Persona '${name}' not found at ${file}`);
    process.exit(1);
  }
  console.log(fs.readFileSync(file, 'utf8'));
}

// CLI Argument Parsing
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
    let template = 'base-template';
    const tIdx = args.indexOf('--template');
    if (tIdx !== -1 && args[tIdx + 1]) template = args[tIdx + 1];
    createPersona(name, template);
    break;
  }

  case 'show':
  case 'cat':
    showPersona(args[1]);
    break;

  default:
    console.log('Usage: ./dsh.sh persona [list | create <name> [--template <template>] | show <name>]');
}
