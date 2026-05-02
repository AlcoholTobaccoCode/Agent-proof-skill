import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const skillDir = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(skillDir, 'scripts', 'agent-proof.mjs');
const packagePath = path.join(skillDir, 'package.json');

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
      '--language',
      'en',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(report, 'utf8');
  assert.match(markdown, /Delivery confidence/);
  assert.match(markdown, /UI changed without visual evidence/);
});

test('check command renders English report for English system locale', () => {
  const { root, repo } = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'src', 'screens', 'Home.tsx'),
    'export function Home() { return <Text>Done</Text>; }\n',
  );
  const ledger = path.join(root, 'verification-ledger.json');
  const report = path.join(root, 'delivery-report.md');
  fs.writeFileSync(ledger, JSON.stringify({ verifications: [{ type: 'lint', command: 'npm run lint', status: 'passed' }] }));

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
    {
      encoding: 'utf8',
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(report, 'utf8');
  assert.match(markdown, /Delivery confidence: \d+\/100/);
  assert.match(markdown, /## Confirmed/);
  assert.doesNotMatch(markdown, /交付可信度/);
});

test('check command falls back to Chinese report for uncertain system locale', () => {
  const { root, repo } = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'src', 'screens', 'Home.tsx'),
    'export function Home() { return <Text>Done</Text>; }\n',
  );
  const ledger = path.join(root, 'verification-ledger.json');
  const report = path.join(root, 'delivery-report.md');
  fs.writeFileSync(ledger, JSON.stringify({ verifications: [{ type: 'lint', command: 'npm run lint', status: 'passed' }] }));

  const result = spawnSync(
    'node',
    [
      scriptPath,
      'check',
      '--repo',
      repo,
      '--intent',
      '调整首页 UI',
      '--claims',
      '首页 UI 已完成',
      '--verification-file',
      ledger,
      '--output',
      report,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: '', LC_MESSAGES: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(report, 'utf8');
  assert.match(markdown, /交付可信度: \d+\/100/);
  assert.match(markdown, /## 已确认/);
  assert.doesNotMatch(markdown, /Delivery confidence/);
});

test('doctor suggests existing workspace verification scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-doctor-'));
  const app = path.join(root, 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'sample-workspace',
      packageManager: 'pnpm@10.0.0',
      scripts: { typecheck: 'pnpm -r typecheck' },
      workspaces: ['app'],
    }),
  );
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      name: '@sample/app',
      scripts: { typecheck: 'tsc --noEmit' },
    }),
  );

  const result = spawnSync('node', [scriptPath, 'doctor', '--repo', root], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Package manager: pnpm/);
  assert.match(result.stdout, /node .*agent-proof\.mjs record .*pnpm typecheck/);
  assert.match(result.stdout, /pnpm --filter @sample\/app typecheck/);
  assert.doesNotMatch(result.stdout, /npm run lint/);
});

test('doctor renders English output for English system locale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-doctor-en-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit' },
    }),
  );

  const result = spawnSync('node', [scriptPath, 'doctor', '--repo', root], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agent Proof project doctor/);
  assert.match(result.stdout, /Package manager: npm/);
  assert.match(result.stdout, /Available verification scripts:/);
  assert.doesNotMatch(result.stdout, /包管理器/);
});

test('doctor falls back to Chinese output for uncertain system locale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-doctor-zh-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit' },
    }),
  );

  const result = spawnSync('node', [scriptPath, 'doctor', '--repo', root], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: '', LC_MESSAGES: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Agent Proof 项目体检/);
  assert.match(result.stdout, /包管理器: npm/);
  assert.match(result.stdout, /可用验证脚本:/);
  assert.match(result.stdout, /建议记录命令:/);
  assert.doesNotMatch(result.stdout, /Package manager:/);
});

test('help falls back to Chinese output for uncertain system locale', () => {
  const result = spawnSync('node', [scriptPath, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: '', LC_MESSAGES: '' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法:/);
  assert.match(result.stdout, /agent-proof doctor/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});

test('package exposes agent-proof binary for npx usage from any project', () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-proof-bin-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit' },
    }),
  );

  assert.equal(pkg.bin?.['agent-proof'], './scripts/agent-proof.mjs');
  const help = spawnSync('npm', ['exec', '--package', skillDir, '--', 'agent-proof', '--help'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
  });
  const doctor = spawnSync('npm', ['exec', '--package', skillDir, '--', 'agent-proof', 'doctor', '--repo', root], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
  });

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /agent-proof check/);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /npx --yes .*agent-proof.* record --ledger/);
});

test('npx cache paths still produce copyable npx doctor suggestions', () => {
  const moduleUrl = `${pathToFileURL(scriptPath).href}?case=cache`;
  const npmCacheBin = path.join(os.tmpdir(), '_npx', 'example', 'node_modules', '.bin', 'agent-proof');
  const npmDefaultBin = path.join(os.tmpdir(), '.npm', '_npx', 'example', 'node_modules', '.bin', 'agent-proof');
  const script = `
    const { commandForScriptPath } = await import(${JSON.stringify(moduleUrl)});
    console.log(commandForScriptPath(${JSON.stringify(npmCacheBin)}, {}));
    console.log(commandForScriptPath(${JSON.stringify(npmDefaultBin)}, {}));
    console.log(commandForScriptPath(${JSON.stringify(npmCacheBin)}, { npm_command: 'exec', npm_config_package: 'github:owner/repo' }));
  `;
  const result = spawnSync('node', ['--input-type=module', '--eval', script], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npx --yes github:AlcoholTobaccoCode\/Agent-proof-skill/);
  assert.match(result.stdout, /npx --yes github:owner\/repo/);
});

test('check ignores its own generated ledger and report files', () => {
  const { root, repo } = makeRepo();
  fs.writeFileSync(path.join(repo, 'delivery-report.md'), 'generated report\n');
  fs.writeFileSync(path.join(repo, 'verification-ledger.json'), '{"verifications":[]}\n');
  fs.mkdirSync(path.join(repo, '.agent-proof'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agent-proof', 'delivery-report.md'), 'generated report\n');
  fs.writeFileSync(
    path.join(repo, 'src', 'screens', 'Home.tsx'),
    'export function Home() { return <Text>Done</Text>; }\n',
  );
  const ledger = path.join(root, 'ledger.json');
  const report = path.join(root, 'nested', 'delivery-report.md');
  fs.writeFileSync(ledger, JSON.stringify({ verifications: [{ type: 'manual', command: 'manual visual check', status: 'passed' }] }));

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
      '--language',
      'en',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const markdown = fs.readFileSync(report, 'utf8');
  assert.match(markdown, /modified: `src\/screens\/Home.tsx`/);
  assert.doesNotMatch(markdown, /verification-ledger\.json/);
  assert.doesNotMatch(markdown, /delivery-report\.md/);
});
