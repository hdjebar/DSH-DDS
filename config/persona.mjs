#!/usr/bin/env node

/**
 * 🎭 Advanced Multi-Model Persona Package Manager
 * Manages complete persona bundles with Task-to-Model Routing Matrix, Skills, MCPs, and Workflows.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function getYamlEngine() {
  try {
    return require('yaml');
  } catch {
    try {
      return require('/usr/local/lib/node_modules/yaml');
    } catch {
      return null;
    }
  }
}

const YAML = getYamlEngine();

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = path.join(CONFIG_DIR, 'personas');
const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const TEMPLATES_DIR = path.join(CONFIG_DIR, 'templates/personas');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.yaml');

function getRuntimeDir() {
  if (process.env.DSH_RUNTIME_DIR) {
    if (!fs.existsSync(process.env.DSH_RUNTIME_DIR)) {
      try { fs.mkdirSync(process.env.DSH_RUNTIME_DIR, { recursive: true }); } catch {}
    }
    return process.env.DSH_RUNTIME_DIR;
  }
  try {
    fs.accessSync(CONFIG_DIR, fs.constants.W_OK);
    return CONFIG_DIR;
  } catch {
    const fallback = path.join(os.tmpdir(), 'dsh');
    try { fs.mkdirSync(fallback, { recursive: true }); } catch {}
    return fallback;
  }
}

const RUNTIME_DIR = getRuntimeDir();
const SESSIONS_DIR = process.env.DSH_SESSIONS_DIR || path.join(RUNTIME_DIR, 'sessions');

export function validateSlug(input, fieldName = 'name') {
  if (!input || typeof input !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new Error(`Invalid ${fieldName} '${input}'. Must be alphanumeric with hyphens or underscores only.`);
  }
  return input;
}

export function validateSessionId(input) {
  if (!input || typeof input !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(input) || input.includes('..')) {
    throw new Error(`Invalid session ID '${input}'. Must be alphanumeric with hyphens, underscores, or dots without directory traversal.`);
  }
  return input;
}

export function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\b(sk-[a-zA-Z0-9-_]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(AIza[0-9A-Za-z_-]{35,})\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b(ghp_[a-zA-Z0-9]{30,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(github_pat_[0-9a-zA-Z_]{82,})\b/g, '[REDACTED_GITHUB_PAT]')
    .replace(/\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[a-zA-Z0-9_-]{16,}(["']?)/gi, '$1[REDACTED_KEY]$2');
}

function ensureDirs() {
  try { if (!fs.existsSync(PERSONAS_DIR)) fs.mkdirSync(PERSONAS_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch {}
  try { if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}
}

export function parseYaml(yamlText) {
  if (typeof yamlText !== 'string' || !yamlText.trim()) return {};
  try {
    if (YAML && typeof YAML.parse === 'function') {
      return YAML.parse(yamlText) || {};
    }
    throw new Error('YAML parser library not initialized');
  } catch (err) {
    console.error('YAML parse error:', err.message);
    return {};
  }
}

export function parsePersonaYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = parseYaml(content);
  
  const result = {
    name: doc.name || path.basename(path.dirname(filePath)),
    title: doc.title || doc.name || '',
    description: doc.description || '',
    profiles: Array.isArray(doc.profiles) ? doc.profiles : (doc.profiles && typeof doc.profiles === 'object' ? Object.keys(doc.profiles) : ['web', 'headless', 'cli']),
    models: {},
    workflows: doc.workflows || {},
    plugins: doc.plugins || [],
    mcpServers: doc.mcpServers || {}
  };

  if (doc.models && typeof doc.models === 'object') {
    for (const [tier, cfg] of Object.entries(doc.models)) {
      if (cfg && typeof cfg === 'object') {
        result.models[tier] = {
          provider: cfg.provider || 'openrouter',
          model: cfg.model || 'deepseek/deepseek-chat',
          temperature: typeof cfg.temperature === 'number' ? cfg.temperature : (parseFloat(cfg.temperature) || 0.2),
          useCase: cfg.useCase || ''
        };
      }
    }
  }

  if (!result.models.default) {
    result.models.default = {
      provider: doc.provider || 'openrouter',
      model: doc.model || 'deepseek/deepseek-chat'
    };
  }

  return result;
}

function listPersonas() {
  ensureDirs();
  console.log('========================================================================');
  console.log('🎭 DeepSeek Harness AI Personas (Multi-Model & Execution Contexts)');
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
      console.log(`\n  🔹 \x1b[32m${name}\x1b[0m — ${meta.title || name}`);
      if (meta.description) console.log(`     Desc: \x1b[90m${meta.description}\x1b[0m`);
      if (meta.profiles && meta.profiles.length > 0) {
        console.log(`     Contexts (Profiles): \x1b[35m${meta.profiles.join(', ')}\x1b[0m`);
      }
      console.log(`     Task-to-Model Matrix:`);
      for (const [tier, cfg] of Object.entries(meta.models)) {
        console.log(`       • \x1b[33m${tier.padEnd(10)}\x1b[0m → \x1b[36m${cfg.provider}/${cfg.model}\x1b[0m \x1b[90m(${cfg.useCase || 'General'})\x1b[0m`);
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
  const safeName = validateSlug(name, 'persona name');
  const safeTemplate = validateSlug(templateName, 'template name');

  const targetDir = path.join(PERSONAS_DIR, safeName);
  const targetSkillDir = path.join(SKILLS_DIR, safeName);

  if (fs.existsSync(targetDir)) {
    console.error(`❌ Error: Persona '${safeName}' already exists at config/personas/${safeName}/`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(targetSkillDir, { recursive: true });

  const templateDir = path.join(TEMPLATES_DIR, safeTemplate);
  if (!fs.existsSync(templateDir)) {
    console.error(`❌ Error: Template '${safeTemplate}' not found in config/templates/personas/`);
    process.exitCode = 1;
    return;
  }

  for (const file of fs.readdirSync(templateDir)) {
    let content = fs.readFileSync(path.join(templateDir, file), 'utf8');
    content = content.replace(/name:\s*[\w-]+/m, `name: ${safeName}`);
    fs.writeFileSync(path.join(targetDir, file), content, 'utf8');
  }

  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
    fs.copyFileSync(path.join(targetDir, 'SKILL.md'), path.join(targetSkillDir, 'SKILL.md'));
  }

  console.log('========================================================================');
  console.log(`✅ Persona Package '${safeName}' created successfully with Multi-Model Matrix!`);
  console.log(`📁 Package Path: config/personas/${safeName}/`);
  console.log(`📁 Skill Active: config/skills/${safeName}/SKILL.md`);
  console.log('========================================================================');
}

function applyPersona(name, tier = 'default') {
  const safeName = validateSlug(name, 'persona name');
  const safeTier = validateSlug(tier, 'model tier');
  const manifestPath = path.join(PERSONAS_DIR, safeName, 'persona.yaml');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Persona '${safeName}' not found.`);
    process.exitCode = 1;
    return;
  }

  const meta = parsePersonaYaml(manifestPath);
  const targetModel = meta.models[safeTier] || meta.models.default;

  if (targetModel) {
    let settings = '';
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = fs.readFileSync(SETTINGS_FILE, 'utf8');
    } else {
      const defaultSettings = path.join(CONFIG_DIR, 'settings.default.yaml');
      if (fs.existsSync(defaultSettings)) {
        settings = fs.readFileSync(defaultSettings, 'utf8');
      }
    }
    if (settings) {
      settings = settings.replace(/agent-default-model:\s*\n\s*provider:\s*\w+\s*\n\s*model:\s*[\w\-\/\.:]+/m,
        `agent-default-model:\n  provider: ${targetModel.provider}\n  model: ${targetModel.model}`);
      fs.writeFileSync(SETTINGS_FILE, settings, 'utf8');
      console.log(`✅ Applied default model: ${targetModel.provider}/${targetModel.model} (${safeTier} tier) for persona '${safeName}'`);
    }
  }
}

function runPersona(name, prompt, tier = 'default', profile = 'headless') {
  if (!name || !prompt) {
    console.error('❌ Usage: ./dsh.sh persona run <name> [--tier <tier>] [--profile <profile>] "<prompt>"');
    process.exitCode = 1;
    return;
  }

  const safeName = validateSlug(name, 'persona name');
  const safeProfile = validateSlug(profile, 'profile name');
  const safeTier = validateSlug(tier, 'model tier');

  // Derive container-accessible patch path
  let containerPatchDir = '/root/.dsh';
  if (process.env.DSH_RUNTIME_DIR) {
    const resolvedRuntime = path.resolve(process.env.DSH_RUNTIME_DIR);
    const resolvedConfig = path.resolve(CONFIG_DIR);
    if (resolvedRuntime === resolvedConfig) {
      containerPatchDir = '/root/.dsh';
    } else if (resolvedRuntime.startsWith(resolvedConfig + path.sep)) {
      const rel = path.relative(resolvedConfig, resolvedRuntime);
      containerPatchDir = path.posix.join('/root/.dsh', rel.split(path.sep).join('/'));
    } else {
      console.error(`❌ Error: DSH_RUNTIME_DIR ('${process.env.DSH_RUNTIME_DIR}') is outside the container configuration mount ('${CONFIG_DIR}'). Cannot mount patch into container.`);
      process.exitCode = 1;
      return;
    }
  } else if (RUNTIME_DIR !== CONFIG_DIR) {
    console.error(`❌ Error: RUNTIME_DIR ('${RUNTIME_DIR}') is not inside the container configuration mount ('${CONFIG_DIR}'). Cannot mount patch into container.`);
    process.exitCode = 1;
    return;
  }

  const manifestPath = path.join(PERSONAS_DIR, safeName, 'persona.yaml');
  const tempPatchName = `patch.${process.pid}.${Date.now()}.tmp.yaml`;
  const tempPatchFile = path.join(RUNTIME_DIR, tempPatchName);
  const containerPatchPath = path.posix.join(containerPatchDir, tempPatchName);
  let hasPatch = false;

  try {
    if (fs.existsSync(manifestPath)) {
      const meta = parsePersonaYaml(manifestPath);
      const chosenModel = meta.models[safeTier] || meta.models.default;
      if (chosenModel) {
        console.log(`🤖 Invoking persona \x1b[32m${safeName}\x1b[0m on profile \x1b[35m${safeProfile}\x1b[0m using \x1b[33m[${safeTier}]\x1b[0m tier: \x1b[36m${chosenModel.provider}/${chosenModel.model}\x1b[0m`);
        let patchContent = `- id: agent-default-model\n  config:\n    provider: ${chosenModel.provider}\n    model: ${chosenModel.model}\n`;

        // Wire persona MCP servers
        if (meta.mcpServers && typeof meta.mcpServers === 'object') {
          for (const [sName, sCfg] of Object.entries(meta.mcpServers)) {
            if (sCfg && sCfg.command) {
              patchContent += `- insert:\n    - id: mcp-${sName}\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: ${sName}\n        transport: ${sCfg.transport || 'stdio'}\n        command: ${sCfg.command}\n        args: ${JSON.stringify(sCfg.args || [])}\n`;
            }
          }
        }

        fs.writeFileSync(tempPatchFile, patchContent, 'utf8');
        hasPatch = true;
      }
    }

    const fullPrompt = `Using the ${safeName} skill, ${prompt}`;
    const dockerArgs = ['compose', 'exec', 'dsh', 'dsh', '--profile', safeProfile];
    if (hasPatch) {
      dockerArgs.push('--patch', containerPatchPath);
    }
    dockerArgs.push(fullPrompt);

    const res = spawnSync('docker', dockerArgs, { stdio: 'inherit', shell: false });
    if (res.error) {
      console.error('❌ Execution failed:', res.error.message);
      process.exitCode = 1;
      return;
    }
    if (res.status !== 0) {
      process.exitCode = res.status || 1;
      return;
    }
  } finally {
    if (hasPatch && fs.existsSync(tempPatchFile)) {
      try { fs.unlinkSync(tempPatchFile); } catch {}
    }
  }
}

function runWorkflow(name, workflowKey) {
  const safeName = validateSlug(name, 'persona name');
  const manifestPath = path.join(PERSONAS_DIR, safeName, 'persona.yaml');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Persona '${safeName}' not found.`);
    process.exit(1);
  }

  const meta = parsePersonaYaml(manifestPath);
  const workflows = (meta.workflows && typeof meta.workflows === 'object') ? meta.workflows : {};

  const printWorkflows = () => {
    console.log(`Available declarative workflows for persona '${safeName}':`);
    for (const [k, v] of Object.entries(workflows)) {
      const tier = v.modelTier || v.model_tier || 'default';
      const summary = v.command ? v.command : (Array.isArray(v.steps) ? `${v.steps.length} declarative steps` : 'declarative workflow');
      const desc = v.description ? ` - ${v.description}` : '';
      console.log(`  • \x1b[36m${k}\x1b[0m (tier: ${tier})${desc}: ${summary}`);
    }
  };

  if (!workflowKey) {
    printWorkflows();
    return;
  }

  const safeWfKey = validateSlug(workflowKey, 'workflow key');
  if (!Object.prototype.hasOwnProperty.call(workflows, safeWfKey)) {
    printWorkflows();
    process.exit(1);
  }

  const wf = workflows[safeWfKey];
  const tier = wf.modelTier || wf.model_tier || 'default';
  console.log(`🚀 Running declarative workflow '\x1b[36m${safeWfKey}\x1b[0m' for persona '\x1b[32m${safeName}\x1b[0m' (Model Tier: \x1b[33m${tier}\x1b[0m)...`);

  let prompt;
  if (Array.isArray(wf.steps)) {
    const isCaseManagement = wf.type === 'case-management' || wf.steps.some(s => s.when || s.condition || s.approval_required || s.approval || s.on_failure || s.fallback || s.output_variable);
    const label = isCaseManagement ? 'Adaptive Case Management Workflow' : 'Transactional Workflow Pipeline';
    console.log(`📋 Validated ${label} (${wf.steps.length} steps):`);
    const stepsFormatted = wf.steps.map((s, idx) => {
      const meta = [];
      if (s.when || s.condition) meta.push(`[WHEN: ${s.when || s.condition}]`);
      if (s.approval_required || s.approval) meta.push(`[GATE: APPROVAL REQUIRED]`);
      if (s.on_failure || s.fallback) meta.push(`[ON-FAIL: ${s.on_failure || s.fallback}]`);
      if (s.output_variable) meta.push(`[OUT: ${s.output_variable}]`);
      const metaStr = meta.length ? ` ${meta.join(' ')}` : '';
      console.log(`   [${idx + 1}/${wf.steps.length}] ${s.name || s.action} (${s.action})${metaStr}`);

      const details = [];
      if (s.scope) details.push(`scope: ${s.scope}`);
      if (s.ignore) details.push(`ignore: ${s.ignore}`);
      if (s.target) details.push(`target: ${s.target}`);
      if (s.when || s.condition) details.push(`when: "${s.when || s.condition}"`);
      if (s.approval_required || s.approval) details.push(`approval_required: true`);
      if (s.on_failure || s.fallback) details.push(`on_failure: "${s.on_failure || s.fallback}"`);
      if (s.output_variable) details.push(`output_variable: "${s.output_variable}"`);
      if (s.verification) details.push(`verification: ${s.verification}`);
      if (s.destination) details.push(`destination: ${s.destination}`);
      if (s.projection) details.push(`projection: ${s.projection}`);
      if (s.prompt) details.push(`prompt: "${s.prompt}"`);
      return `Step ${idx + 1} - ${s.name || s.action}: Action='${s.action}'${details.length ? ' (' + details.join(', ') + ')' : ''}`;
    }).join('\n');
    prompt = `Execute the ${isCaseManagement ? 'adaptive case management' : 'declarative'} workflow '${safeWfKey}' following these verified steps:\n${stepsFormatted}`;
  } else if (wf.command) {
    prompt = wf.command.replace(new RegExp(`^Using the ${safeName} skill,\\s*`), '');
  } else {
    prompt = `Execute declarative workflow '${safeWfKey}' for persona '${safeName}'.`;
  }

  runPersona(safeName, prompt, tier);
}

function showPersona(name) {
  const safeName = validateSlug(name, 'persona name');
  const pDir = path.join(PERSONAS_DIR, safeName);
  if (!fs.existsSync(pDir)) {
    console.error(`❌ Persona '${safeName}' not found.`);
    process.exit(1);
  }
  console.log(`=== config/personas/${safeName}/persona.yaml ===`);
  if (fs.existsSync(path.join(pDir, 'persona.yaml'))) console.log(fs.readFileSync(path.join(pDir, 'persona.yaml'), 'utf8'));
  console.log(`\n=== config/personas/${safeName}/SKILL.md ===`);
  if (fs.existsSync(path.join(pDir, 'SKILL.md'))) console.log(fs.readFileSync(path.join(pDir, 'SKILL.md'), 'utf8'));
}

export function parsePersonaArgs(argv) {
  const command = argv[0] || 'list';
  let tier = 'default';
  let profile = 'headless';
  let template = 'data-analyst';
  let sessionId = null;
  let title = null;
  const positionalArgs = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier' || arg === '-t' || arg === '--task-model') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`Missing value for option '${arg}'`);
      }
      tier = argv[++i];
    } else if (arg.startsWith('--tier=')) {
      tier = arg.slice(7);
      if (!tier) throw new Error(`Missing value for option '${arg}'`);
    } else if (arg === '--profile' || arg === '-p') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`Missing value for option '${arg}'`);
      }
      profile = argv[++i];
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice(10);
      if (!profile) throw new Error(`Missing value for option '${arg}'`);
    } else if (arg === '--template') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`Missing value for option '${arg}'`);
      }
      template = argv[++i];
    } else if (arg.startsWith('--template=')) {
      template = arg.slice(11);
      if (!template) throw new Error(`Missing value for option '${arg}'`);
    } else if (arg === '--session') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`Missing value for option '${arg}'`);
      }
      sessionId = argv[++i];
    } else if (arg.startsWith('--session=')) {
      sessionId = arg.slice(10);
      if (!sessionId) throw new Error(`Missing value for option '${arg}'`);
    } else if (arg === '--title') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`Missing value for option '${arg}'`);
      }
      title = argv[++i];
    } else if (arg.startsWith('--title=')) {
      title = arg.slice(8);
      if (!title) throw new Error(`Missing value for option '${arg}'`);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option '${arg}'`);
    } else {
      positionalArgs.push(arg);
    }
  }

  return { command, tier, profile, template, sessionId, title, positionalArgs };
}

// Direct CLI Execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  try {
    const { command, tier, profile, template, sessionId, title, positionalArgs } = parsePersonaArgs(process.argv.slice(2));

    switch (command) {
      case 'list':
      case 'ls':
        listPersonas();
        break;

      case 'create':
      case 'new':
        createPersona(positionalArgs[0], template);
        break;

      case 'sessions':
      case 'history':
        listSessions();
        break;

      case 'distill':
      case 'record':
        distillPersona(positionalArgs[0], { sessionId, title });
        break;

      case 'apply':
      case 'activate':
        applyPersona(positionalArgs[0], tier);
        break;

      case 'run':
        runPersona(positionalArgs[0], positionalArgs.slice(1).join(' '), tier, profile);
        break;

      case 'workflow':
      case 'wf':
        runWorkflow(positionalArgs[0], positionalArgs[1]);
        break;

      case 'show':
      case 'cat':
        showPersona(positionalArgs[0]);
        break;

      default:
        console.log('Usage: ./dsh.sh persona [list | sessions | create <name> [--template <tmpl>] | distill <name> [--session <id>] | apply <name> [--tier <tier>] | run <name> [--tier <tier>] [--profile <profile>] "<prompt>" | workflow <name> <wf>]');
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

function listSessions() {
  console.log('========================================================================');
  console.log('📜 DeepSeek Harness Interactive Web & CLI Sessions');
  console.log('========================================================================');
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log('  No sessions recorded yet.');
    return;
  }

  const workspaces = fs.readdirSync(SESSIONS_DIR);
  let totalSessions = 0;

  for (const ws of workspaces) {
    const wsPath = path.join(SESSIONS_DIR, ws);
    if (!fs.statSync(wsPath).isDirectory()) continue;
    const sessionFiles = fs.readdirSync(wsPath);
    console.log(`\n📁 Workspace / Project: \x1b[35m${ws}\x1b[0m (${sessionFiles.length} sessions)`);
    for (const sf of sessionFiles.slice(-10)) {
      totalSessions++;
      const sFile = path.join(wsPath, sf);
      const stat = fs.statSync(sFile);
      let title = sf;
      try {
        const raw = fs.readFileSync(sFile, 'utf8');
        const lines = raw.split('\n');
        for (const line of lines) {
          if (line.includes('"title"') || line.includes('"prompt"') || line.includes('"text"')) {
            const m = line.match(/"(?:title|prompt|text)"\s*:\s*"([^"]{5,60})"/);
            if (m) {
              title = m[1];
              break;
            }
          }
        }
      } catch {}
      console.log(`  🔹 \x1b[36m${sf.padEnd(46)}\x1b[0m — ${title} \x1b[90m(${stat.mtime.toLocaleTimeString()})\x1b[0m`);
    }
  }
  console.log('\n========================================================================');
  console.log('💡 Distill any session into a Persona package:');
  console.log('   ./dsh.sh persona distill <name> --session <session-id>');
  console.log('========================================================================');
}

function extractSessionInsights(rawText, maxChars = 4000) {
  if (!rawText || typeof rawText !== 'string') return '';
  const lines = rawText.split('\n');
  const extractedPoints = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const entry = JSON.parse(trimmed);
        if (entry.prompt || entry.user) {
          extractedPoints.push(`* User Objective: ${entry.prompt || entry.user}`);
        } else if (entry.summary || entry.title) {
          extractedPoints.push(`* Key Milestone: ${entry.summary || entry.title}`);
        } else if (entry.tool || entry.toolCall) {
          const tName = entry.tool?.name || entry.toolCall?.name || 'tool';
          extractedPoints.push(`* Tool Invocation: \`${tName}\``);
        } else if (entry.text && entry.text.length < 200) {
          extractedPoints.push(`* Insight: ${entry.text}`);
        }
      } catch {}
    } else if (trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('-')) {
      extractedPoints.push(trimmed.slice(0, 150));
    }
  }

  let formatted = '';
  if (extractedPoints.length > 0) {
    formatted = extractedPoints.slice(0, 30).join('\n');
  } else {
    formatted = rawText.slice(0, maxChars).replace(/```/g, "'''");
  }

  if (formatted.length > maxChars) {
    formatted = formatted.slice(0, maxChars) + '\n... [truncated]';
  }

  return `<distilled_session_insights>\n${formatted}\n</distilled_session_insights>`;
}

function formatBoundedMemory(rawText, maxChars = 3000) {
  if (!rawText || typeof rawText !== 'string') return '';
  let clean = rawText.trim().replace(/```/g, "'''");
  if (clean.length > maxChars) {
    clean = clean.slice(0, maxChars) + '\n... [truncated]';
  }
  return `<distilled_memory_rules>\n${clean}\n</distilled_memory_rules>`;
}

function distillPersona(name, options = {}) {
  ensureDirs();
  const safeName = validateSlug(name, 'persona name');

  console.log('========================================================================');
  console.log(`🧪 Distilling Workflow & Telemetry into Persona Package '${safeName}'`);
  console.log('========================================================================');

  let sessionNotes = '';
  if (options.sessionId && fs.existsSync(SESSIONS_DIR)) {
    const safeSessionId = validateSessionId(options.sessionId);
    for (const ws of fs.readdirSync(SESSIONS_DIR)) {
      const sFile = path.join(SESSIONS_DIR, ws, safeSessionId);
      if (fs.existsSync(sFile)) {
        sessionNotes = scrubSecrets(fs.readFileSync(sFile, 'utf8'));
        console.log(`📖 Ingested transcript from target session: ${safeSessionId}`);
        break;
      }
    }
  }

  // 1. Ingest session memories if available
  let memoryNotes = '';
  const memoryFile = path.join(CONFIG_DIR, 'MEMORY.md');
  if (fs.existsSync(memoryFile)) {
    memoryNotes = scrubSecrets(fs.readFileSync(memoryFile, 'utf8'));
    console.log('📖 Ingested long-term session memories from config/MEMORY.md');
  }

  const fencedSession = extractSessionInsights(sessionNotes);
  const fencedMemory = formatBoundedMemory(memoryNotes);

  const rawTitle = options.title || safeName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const cleanTitle = JSON.stringify(rawTitle.replace(/[\r\n\t]/g, ' ')).slice(1, -1);
  const cleanDesc = `Distilled specialist persona for ${cleanTitle} derived from interactive sessions.`;

  const targetDir = path.join(PERSONAS_DIR, safeName);
  const targetSkillDir = path.join(SKILLS_DIR, safeName);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(targetSkillDir, { recursive: true });

  // 2. Generate persona.yaml with Multi-Model Matrix
  const personaYaml = `version: "1.0"
name: ${safeName}
title: "${cleanTitle}"
description: "${cleanDesc}"

# 🌐 Supported Execution Context Profiles
profiles:
  - web
  - headless
  - cli

# 🎯 Multi-Model Task Routing Matrix
models:
  default:
    provider: openrouter
    model: deepseek/deepseek-chat
    temperature: 0.2
    useCase: "General ${cleanTitle} task drafting and conversational execution"
  reasoning:
    provider: openrouter
    model: deepseek/deepseek-r1
    temperature: 0.0
    useCase: "Deep architectural reasoning and complex problem decomposition"
  audit:
    provider: openrouter
    model: anthropic/claude-3.5-sonnet
    temperature: 0.1
    useCase: "High-accuracy code inspection and precision verification"
  fast:
    provider: gemini
    model: gemini-3.7-flash
    temperature: 0.2
    useCase: "Rapid large file parsing and repository indexing"

plugins:
  - "@liustack/modsearch"
  - "dsh-mnemon"
  - "dshmarket"
  - "dsh-find-plugin"

mcpServers:
  fetch:
    command: "mcp-server-webresearch"
    args: []

workflows:
  default-task:
    modelTier: default
    command: "Using the ${safeName} skill, execute the core ${cleanTitle} workflow."
  deep-analysis:
    modelTier: reasoning
    command: "Using the ${safeName} skill, perform deep multi-step reasoning on the active workspace."
`;
  fs.writeFileSync(path.join(targetDir, 'persona.yaml'), personaYaml, 'utf8');

  // 3. Generate distilled SKILL.md
  const skillMd = `---
name: ${safeName}
description: ${cleanDesc}
---

# 🎯 ${cleanTitle}

## 🎯 Role & Objective
You are a domain-specialized AI agent for ${cleanTitle}, distilled from refined workflow interactions and best practices.

## 📋 Operational Guidelines & Rules
1. **Domain Focus**: Execute tasks strictly aligned with ${cleanTitle} standards.
2. **Quality & Validation**: Verify all outputs against target specifications before concluding tasks.
3. **Multi-Model Matching**:
   * Use **default** (\`deepseek-chat\`) for general iterative drafting.
   * Use **reasoning** (\`deepseek-r1\`) for complex multi-variable logic and proof verification.
   * Use **audit** (\`claude-3.5-sonnet\`) for precision code changes.
${fencedMemory ? `\n## 🧠 Learned Context & Distilled Session Rules\n${fencedMemory}\n` : ''}
${fencedSession ? `\n## 📜 Distilled Interactive Session Insights\n${fencedSession}\n` : ''}
## 📊 Output Schema
* 📌 **Executive Summary**: 1-2 sentence core conclusion.
* 🛠️ **Implementation / Deliverables**: Formatted code, tables, or findings.
* 💡 **Next Steps & Recommendations**: Concrete follow-up actions.
`;
  fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillMd, 'utf8');
  fs.writeFileSync(path.join(targetSkillDir, 'SKILL.md'), skillMd, 'utf8');

  console.log(`✅ Successfully distilled and built persona package '\x1b[32m${safeName}\x1b[0m'!`);
  console.log(`📁 Package Path:  config/personas/${safeName}/`);
  console.log(`   ├── persona.yaml   (Multi-Model Matrix, Profiles, MCPs & Declarative Workflows)`);
  console.log(`   └── SKILL.md       (Distilled rules & guidelines)`);
  console.log(`📁 Active Skill:  config/skills/${safeName}/SKILL.md`);
  console.log(`\n🚀 Ready to run:`);
  console.log(`   ./dsh.sh persona run ${safeName} "<task>"`);
  console.log(`   ./dsh.sh persona workflow ${safeName} default-task`);
  console.log('========================================================================');
}
