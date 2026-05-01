import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const skillDir = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(skillDir, 'scripts', 'convert-integrations.mjs');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('converter writes all requested target formats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-integrations-'));
  const out = path.join(root, 'integrations', 'agent-proof');
  const result = spawnSync('node', [scriptPath, 'convert', '--skill', skillDir, '--out', out, '--tool', 'all'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const expectedFiles = [
    'antigravity/agent-proof/SKILL.md',
    'gemini-cli/gemini-extension.json',
    'gemini-cli/skills/agent-proof/SKILL.md',
    'opencode/agents/agent-proof.md',
    'copilot/agents/agent-proof.md',
    'openclaw/agent-proof/SOUL.md',
    'openclaw/agent-proof/AGENTS.md',
    'openclaw/agent-proof/IDENTITY.md',
    'cursor/rules/agent-proof.mdc',
    'aider/CONVENTIONS.md',
    'windsurf/.windsurfrules',
    'kimi/agent-proof/agent.yaml',
    'kimi/agent-proof/system.md',
    'codex/agent-proof/SKILL.md',
  ];

  for (const relative of expectedFiles) {
    assert.ok(fs.existsSync(path.join(out, relative)), `${relative} should exist`);
  }

  assert.match(read(path.join(out, 'opencode/agents/agent-proof.md')), /mode: subagent/);
  assert.match(read(path.join(out, 'cursor/rules/agent-proof.mdc')), /alwaysApply: false/);
  assert.match(read(path.join(out, 'aider/CONVENTIONS.md')), /Agent Proof/);
  assert.match(read(path.join(out, 'kimi/agent-proof/agent.yaml')), /system_prompt_path: \.\/system\.md/);
  assert.ok(fs.existsSync(path.join(out, 'codex/agent-proof/scripts/agent-proof.mjs')));
});

test('audit reports direct and converted support separately', () => {
  const result = spawnSync('node', [scriptPath, 'audit', '--skill', skillDir], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /codex\s+direct/);
  assert.match(result.stdout, /gemini-cli\s+converted/);
  assert.match(result.stdout, /copilot\s+converted/);
});
