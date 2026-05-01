import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const skillDir = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(skillDir, 'scripts', 'agent-proof.mjs');

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-js-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src', 'screens'), { recursive: true });
  run('git', ['init', repo], root);
  run('git', ['config', 'user.email', 'agent-proof@example.test'], repo);
  run('git', ['config', 'user.name', 'Agent Proof'], repo);
  fs.writeFileSync(path.join(repo, 'src', 'screens', 'Home.tsx'), 'export function Home() { return null; }\n');
  run('git', ['add', '.'], repo);
  run('git', ['commit', '-m', 'initial'], repo);
  return { root, repo };
}

test('record command writes a verification ledger automatically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-ledger-'));
  const ledger = path.join(root, 'verification-ledger.json');
  const result = spawnSync(
    'node',
    [scriptPath, 'record', '--ledger', ledger, '--', 'node', '-e', 'process.exit(0)'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(data.verifications.length, 1);
  assert.equal(data.verifications[0].status, 'passed');
  assert.equal(data.verifications[0].exit_code, 0);
  assert.match(data.verifications[0].command, /node -e/);
});

test('check command reads generated ledger and writes markdown report', () => {
  const { root, repo } = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'src', 'screens', 'Home.tsx'),
    'export function Home() { return <Text>Done</Text>; }\n',
  );
  const ledger = path.join(root, 'verification-ledger.json');
  const report = path.join(root, 'delivery-report.md');

  spawnSync('node', [scriptPath, 'record', '--ledger', ledger, '--', 'node', '-e', 'process.exit(0)'], {
    encoding: 'utf8',
  });
  const result = spawnSync(
    'node',
    [
      scriptPath,
      'check',
      '--repo',
      repo,
      '--intent',
      'Polish home UI',
      '--claims',
      'UI is complete',
      '--verification-file',
      ledger,
      '--output',
      report,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(report, 'utf8');
  assert.match(markdown, /交付可信度/);
  assert.match(markdown, /UI changed without visual evidence/);
});
