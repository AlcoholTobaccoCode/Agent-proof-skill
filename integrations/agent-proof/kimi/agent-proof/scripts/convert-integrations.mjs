#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = [
  'antigravity',
  'gemini-cli',
  'opencode',
  'copilot',
  'openclaw',
  'cursor',
  'aider',
  'windsurf',
  'kimi',
  'codex',
];

const DIRECT_TARGETS = new Set(['codex']);
const TODAY = new Date().toISOString().slice(0, 10);

function usage() {
  return `Usage:
  node convert-integrations.mjs audit --skill <skill-dir>
  node convert-integrations.mjs convert --skill <skill-dir> --out integrations/agent-proof --tool all

Targets:
  ${TARGETS.join(', ')}
`;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      options._ = options._ || [];
      options._.push(item);
      continue;
    }
    const key = item.slice(2);
    options[key] = argv[i + 1] || '';
    i += 1;
  }
  return options;
}

function parseSkill(skillDir) {
  const skillPath = path.join(skillDir, 'SKILL.md');
  const raw = fs.readFileSync(skillPath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`SKILL.md has no YAML frontmatter: ${skillPath}`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    fields[key] = value;
  }
  if (!fields.name || !fields.description) throw new Error('SKILL.md must include name and description');
  return {
    dir: skillDir,
    name: fields.name,
    title: fields.name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    description: fields.description,
    slug: slugify(fields.name),
    body: match[2].trim(),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${content.replace(/\s+$/u, '')}\n`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (source) => !source.includes(`${path.sep}__pycache__${path.sep}`) && !source.endsWith('.pyc'),
  });
}

function copySupport(skill, dest) {
  for (const dirname of ['scripts', 'references', 'examples']) {
    copyDir(path.join(skill.dir, dirname), path.join(dest, dirname));
  }
}

function copyCodexSkill(skill, dest) {
  ensureDir(dest);
  for (const file of ['SKILL.md']) {
    fs.copyFileSync(path.join(skill.dir, file), path.join(dest, file));
  }
  for (const dirname of ['agents', 'scripts', 'references', 'examples']) {
    copyDir(path.join(skill.dir, dirname), path.join(dest, dirname));
  }
}

function portableBody(skill, supportHint = '') {
  const support = supportHint
    ? `\n\n## Portable Support Files\n\n${supportHint}\n`
    : '';
  return `${skill.body}${support}`;
}

function convertAntigravity(skill, outRoot) {
  const outDir = path.join(outRoot, 'antigravity', skill.slug);
  writeFile(
    path.join(outDir, 'SKILL.md'),
    `---
name: ${skill.slug}
description: ${skill.description}
risk: low
source: local
date_added: '${TODAY}'
---
${portableBody(skill)}`,
  );
  copySupport(skill, outDir);
}

function convertGeminiCli(skill, outRoot) {
  const skillDir = path.join(outRoot, 'gemini-cli', 'skills', skill.slug);
  writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---
name: ${skill.slug}
description: ${skill.description}
---
${portableBody(skill)}`,
  );
  copySupport(skill, skillDir);
  writeFile(
    path.join(outRoot, 'gemini-cli', 'gemini-extension.json'),
    JSON.stringify({ name: 'agent-proof', version: '1.0.0' }, null, 2),
  );
}

function convertOpencode(skill, outRoot) {
  const supportHint = 'When using the generated integration folder directly, supporting scripts live under `../support/agent-proof/scripts/`. If you install only this agent file, keep the original `agent-proof` skill folder available and run its Node CLI from there.';
  writeFile(
    path.join(outRoot, 'opencode', 'agents', `${skill.slug}.md`),
    `---
name: ${skill.title}
description: ${skill.description}
mode: subagent
color: '#6B7280'
---
${portableBody(skill, supportHint)}`,
  );
  copySupport(skill, path.join(outRoot, 'opencode', 'support', skill.slug));
}

function convertCopilot(skill, outRoot) {
  const supportHint = 'Install this file as a Copilot custom agent/rule file, and keep the generated `support/agent-proof/scripts/` folder available for deterministic ledger and report commands.';
  writeFile(
    path.join(outRoot, 'copilot', 'agents', `${skill.slug}.md`),
    `---
name: ${skill.title}
description: ${skill.description}
---
${portableBody(skill, supportHint)}`,
  );
  copySupport(skill, path.join(outRoot, 'copilot', 'support', skill.slug));
}

function convertCursor(skill, outRoot) {
  const supportHint = 'Cursor rule files are instructions only. Keep `../support/agent-proof/scripts/agent-proof.mjs` or the original skill path available when running deterministic checks.';
  writeFile(
    path.join(outRoot, 'cursor', 'rules', `${skill.slug}.mdc`),
    `---
description: ${skill.description}
globs: ""
alwaysApply: false
---
${portableBody(skill, supportHint)}`,
  );
  copySupport(skill, path.join(outRoot, 'cursor', 'support', skill.slug));
}

function convertAider(skill, outRoot) {
  const supportHint = 'This CONVENTIONS.md entry gives Aider the workflow. Keep the generated `support/agent-proof/scripts/` folder or original skill folder available for the Node/Python checker.';
  writeFile(
    path.join(outRoot, 'aider', 'CONVENTIONS.md'),
    `# Agent Proof Conventions

## ${skill.title}

> ${skill.description}

${portableBody(skill, supportHint)}`,
  );
  copySupport(skill, path.join(outRoot, 'aider', 'support', skill.slug));
}

function convertWindsurf(skill, outRoot) {
  const supportHint = 'This .windsurfrules file is instruction-only. Keep the generated support folder or original skill folder available when invoking the deterministic CLI.';
  writeFile(
    path.join(outRoot, 'windsurf', '.windsurfrules'),
    `# Agent Proof Rules for Windsurf

================================================================================
## ${skill.title}
${skill.description}
================================================================================

${portableBody(skill, supportHint)}`,
  );
  copySupport(skill, path.join(outRoot, 'windsurf', 'support', skill.slug));
}

function convertOpenclaw(skill, outRoot) {
  const outDir = path.join(outRoot, 'openclaw', skill.slug);
  writeFile(
    path.join(outDir, 'SOUL.md'),
    `# ${skill.title}

Be skeptical of AI delivery claims. Require concrete evidence before accepting that AI-assisted coding work is ready to commit.`,
  );
  writeFile(path.join(outDir, 'AGENTS.md'), portableBody(skill));
  writeFile(
    path.join(outDir, 'IDENTITY.md'),
    `# ${skill.title}

${skill.description}`,
  );
  copySupport(skill, outDir);
}

function convertKimi(skill, outRoot) {
  const outDir = path.join(outRoot, 'kimi', skill.slug);
  writeFile(
    path.join(outDir, 'agent.yaml'),
    `version: 1
agent:
  name: ${skill.slug}
  extend: default
  system_prompt_path: ./system.md`,
  );
  writeFile(
    path.join(outDir, 'system.md'),
    `# ${skill.title}

${skill.description}

${portableBody(skill)}`,
  );
  copySupport(skill, outDir);
}

function convertCodex(skill, outRoot) {
  copyCodexSkill(skill, path.join(outRoot, 'codex', skill.slug));
}

const converters = {
  antigravity: convertAntigravity,
  'gemini-cli': convertGeminiCli,
  opencode: convertOpencode,
  copilot: convertCopilot,
  openclaw: convertOpenclaw,
  cursor: convertCursor,
  aider: convertAider,
  windsurf: convertWindsurf,
  kimi: convertKimi,
  codex: convertCodex,
};

function selectedTargets(tool) {
  if (!tool || tool === 'all') return TARGETS;
  const targets = tool.split(',').map((item) => item.trim()).filter(Boolean);
  for (const target of targets) {
    if (!TARGETS.includes(target)) throw new Error(`unknown target: ${target}`);
  }
  return targets;
}

function audit(skill) {
  const rows = TARGETS.map((target) => {
    const status = DIRECT_TARGETS.has(target) ? 'direct' : 'converted';
    const note = DIRECT_TARGETS.has(target)
      ? 'native Codex SKILL.md package'
      : 'requires generated integration output';
    return { target, status, note };
  });
  console.log('Agent Proof compatibility audit');
  console.log(`Skill: ${skill.name}`);
  console.log('');
  console.log('target       support    note');
  console.log('------------ ---------- ------------------------------------------');
  for (const row of rows) {
    console.log(`${row.target.padEnd(12)} ${row.status.padEnd(10)} ${row.note}`);
  }
}

function convert(skill, outRoot, tool) {
  const targets = selectedTargets(tool);
  ensureDir(outRoot);
  for (const target of targets) {
    const targetRoot = path.join(outRoot, target);
    fs.rmSync(targetRoot, { recursive: true, force: true });
    converters[target](skill, outRoot);
  }
  writeFile(
    path.join(outRoot, 'COMPATIBILITY.md'),
    `# Agent Proof Compatibility Outputs

Generated targets: ${targets.join(', ')}

Direct support:
- codex: native \`SKILL.md\` package

Converted support:
- antigravity
- gemini-cli
- opencode
- copilot
- openclaw
- cursor
- aider
- windsurf
- kimi

This converter writes files only under this output directory. It does not install into user config folders.`,
  );
  console.log(`Converted ${skill.name} for ${targets.length} target(s) -> ${outRoot}`);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return 0;
  }
  const options = parseOptions(rest);
  const defaultSkillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const skillDir = path.resolve(options.skill || defaultSkillDir);
  const outRoot = path.resolve(options.out || path.join(process.cwd(), 'integrations', 'agent-proof'));
  const skill = parseSkill(skillDir);

  if (command === 'audit') {
    audit(skill);
    return 0;
  }
  if (command === 'convert') {
    convert(skill, outRoot, options.tool || 'all');
    return 0;
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`agent-proof-convert: ${error.message}`);
    process.exitCode = 1;
  }
}
