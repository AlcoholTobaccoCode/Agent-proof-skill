#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'successful', 'ok', 'green', '0']);
const FAIL_STATUSES = new Set(['fail', 'failed', 'error', 'errored', 'red', 'nonzero', 'non-zero']);
const UI_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.css', '.scss', '.less']);
const UI_MARKERS = new Set(['screen', 'screens', 'page', 'pages', 'component', 'components', 'view', 'views', 'ui']);
const AUTH_MARKERS = new Set(['auth', 'login', 'session', 'token', 'oauth', 'credential']);
const API_MARKERS = new Set(['api', 'http', 'request', 'client', 'fetch', 'mutation', 'query']);
const CONFIG_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'app.config.ts',
  'app.json',
  'eas.json',
  'tsconfig.json',
  'vite.config.ts',
  'webpack.config.js',
]);
const CONFIG_EXTENSIONS = new Set(['.env', '.toml', '.yaml', '.yml']);
const TEST_MARKERS = new Set(['test', 'tests', '__tests__', 'spec']);
const GENERATED_ARTIFACTS = new Set(['verification-ledger.json', 'delivery-report.md']);
const RISK_KEYS = {
  'No git changes detected': 'noChanges',
  'No verification evidence provided': 'noVerification',
  'Verification contains failures': 'verificationFailed',
  'UI changed without visual evidence': 'uiNoVisual',
  'Auth/session change lacks behavior verification': 'authNoBehavior',
  'API/data-flow change lacks failure-path evidence': 'apiNoBehavior',
  'Config/dependency change lacks runtime verification': 'configNoRuntime',
  'Claims mention tests but no passing test evidence exists': 'claimsTestsNoEvidence',
  'Completion claim has no evidence ledger': 'completeNoLedger',
};

function isGeneratedArtifact(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return GENERATED_ARTIFACTS.has(normalized) || normalized.startsWith('.agent-proof/');
}

function runGit(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

function gitRoot(repo) {
  return runGit(path.resolve(repo), ['rev-parse', '--show-toplevel']).trim();
}

function parseStatusLine(line) {
  const code = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const filePath = rawPath.split(' -> ').at(-1).trim();
  let status = 'changed';
  if (code === '??') status = 'untracked';
  else if (code.includes('A')) status = 'added';
  else if (code.includes('D')) status = 'deleted';
  else if (code.includes('R')) status = 'renamed';
  else if (code.includes('M')) status = 'modified';
  return { status, path: filePath };
}

function collectChanges(repo) {
  return runGit(repo, ['status', '--porcelain=v1'])
    .split('\n')
    .filter((line) => line.trim())
    .map(parseStatusLine)
    .filter((change) => !isGeneratedArtifact(change.path));
}

function pathSegments(filePath) {
  return new Set(filePath.replaceAll('\\', '/').toLowerCase().split('/').filter(Boolean));
}

function intersects(segments, markers) {
  for (const segment of segments) {
    if (markers.has(segment)) return true;
  }
  return false;
}

function includesMarker(lower, markers) {
  for (const marker of markers) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

function classifyPath(filePath) {
  const lower = filePath.toLowerCase();
  const name = path.basename(lower);
  const ext = path.extname(lower);
  const segments = pathSegments(filePath);
  const categories = new Set();

  if (UI_EXTENSIONS.has(ext) || intersects(segments, UI_MARKERS)) categories.add('ui');
  if (intersects(segments, AUTH_MARKERS) || includesMarker(lower, AUTH_MARKERS)) categories.add('auth');
  if (intersects(segments, API_MARKERS) || includesMarker(lower, API_MARKERS)) categories.add('api');
  if (
    CONFIG_NAMES.has(name) ||
    CONFIG_EXTENSIONS.has(ext) ||
    lower.endsWith('.config.ts') ||
    lower.endsWith('.config.js')
  ) {
    categories.add('config');
  }
  if (intersects(segments, TEST_MARKERS) || lower.includes('.test.') || lower.includes('.spec.')) categories.add('test');
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.rst') || segments.has('docs')) categories.add('docs');
  if (categories.size === 0) categories.add('code');
  return categories;
}

function summarizeCategories(changes) {
  const categories = {};
  for (const change of changes) {
    for (const category of classifyPath(change.path)) {
      if (!categories[category]) categories[category] = [];
      categories[category].push(change.path);
    }
  }
  return categories;
}

function inferVerificationType(entry) {
  const explicit = String(entry.type || entry.kind || '').trim().toLowerCase();
  if (explicit) return explicit;
  const command = String(entry.command || entry.name || '').toLowerCase();
  if (['test', 'jest', 'vitest', 'pytest', 'unittest', 'node --test'].some((token) => command.includes(token))) return 'test';
  if (['lint', 'eslint', 'ruff', 'flake8'].some((token) => command.includes(token))) return 'lint';
  if (['build', 'tsc', 'typecheck', 'expo prebuild'].some((token) => command.includes(token))) return 'build';
  if (['screenshot', 'playwright', 'browser', 'simulator', 'xcrun', 'adb'].some((token) => command.includes(token))) return 'visual';
  if (['manual', 'checked', 'opened'].some((token) => command.includes(token))) return 'manual';
  return 'other';
}

function normalizeVerification(entry) {
  const status = String(entry.status || entry.result || '').trim().toLowerCase();
  const command = String(entry.command || entry.name || '').trim();
  return {
    type: inferVerificationType(entry),
    command: command || '(manual evidence)',
    status: status || 'unknown',
    note: String(entry.note || entry.notes || '').trim(),
    exit_code: entry.exit_code,
    duration_ms: entry.duration_ms,
    recorded_at: entry.recorded_at,
  };
}

function loadLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return { version: 1, verifications: [] };
  const data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (Array.isArray(data)) return { version: 1, verifications: data };
  if (!data || typeof data !== 'object') throw new Error('ledger must be a JSON list or object');
  if (!Array.isArray(data.verifications)) data.verifications = [];
  if (!data.version) data.version = 1;
  return data;
}

function writeLedger(ledgerPath, ledger) {
  fs.mkdirSync(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function loadVerifications(filePath) {
  if (!filePath) return [];
  const ledger = loadLedger(filePath);
  return ledger.verifications.filter((entry) => entry && typeof entry === 'object').map(normalizeVerification);
}

function hasPassed(verifications, ...types) {
  const wanted = new Set(types.map((item) => item.toLowerCase()));
  return verifications.some((item) => wanted.has(item.type.toLowerCase()) && PASS_STATUSES.has(item.status.toLowerCase()));
}

function hasFailed(verifications) {
  return verifications.some((item) => FAIL_STATUSES.has(item.status.toLowerCase()));
}

function addRisk(risks, title, evidence, severity, penalty) {
  risks.push({ title, evidence, severity, penalty });
}

function buildRisks(changes, categories, claims, verifications) {
  const risks = [];
  const normalizedClaims = claims.toLowerCase();
  if (changes.length === 0) addRisk(risks, 'No git changes detected', 'git status did not report changed files.', 'high', 25);
  if (verifications.length === 0) {
    addRisk(risks, 'No verification evidence provided', 'No test, lint, build, or manual check was recorded.', 'high', 25);
  }
  if (hasFailed(verifications)) {
    addRisk(risks, 'Verification contains failures', 'At least one recorded verification has a failed/error status.', 'high', 25);
  }
  if (categories.ui && !hasPassed(verifications, 'visual', 'screenshot', 'manual', 'browser', 'simulator')) {
    addRisk(
      risks,
      'UI changed without visual evidence',
      `${categories.ui.length} UI-related file(s) changed, but no visual/manual verification passed.`,
      'medium',
      22,
    );
  }
  if (categories.auth && !hasPassed(verifications, 'test', 'e2e', 'manual')) {
    addRisk(
      risks,
      'Auth/session change lacks behavior verification',
      'Auth, login, token, or session files changed without passing test or manual evidence.',
      'high',
      20,
    );
  }
  if (categories.api && !hasPassed(verifications, 'test', 'integration', 'manual')) {
    addRisk(
      risks,
      'API/data-flow change lacks failure-path evidence',
      'API or request code changed without recorded behavior verification.',
      'medium',
      16,
    );
  }
  if (categories.config && !hasPassed(verifications, 'build', 'typecheck', 'start', 'manual')) {
    addRisk(
      risks,
      'Config/dependency change lacks runtime verification',
      'Config, dependency, or environment-related files changed without build/start evidence.',
      'medium',
      16,
    );
  }
  if (
    ['test', 'tests pass', 'tested', '测试', '验证通过'].some((word) => normalizedClaims.includes(word)) &&
    !hasPassed(verifications, 'test', 'e2e', 'integration')
  ) {
    addRisk(
      risks,
      'Claims mention tests but no passing test evidence exists',
      'The completion claim references tests, but the ledger has no passing test entry.',
      'high',
      25,
    );
  }
  if (['complete', 'done', 'finished', '全部完成', '已完成'].some((word) => normalizedClaims.includes(word)) && verifications.length === 0) {
    addRisk(
      risks,
      'Completion claim has no evidence ledger',
      'The delivery claim says the work is complete, but no verification record was provided.',
      'medium',
      18,
    );
  }
  return risks;
}

function buildConfirmed(changes, categories, verifications) {
  const confirmed = [`Detected ${changes.length} changed file(s) from git status.`];
  const categoryNames = Object.keys(categories).sort();
  if (categoryNames.length) confirmed.push(`Changed categories: ${categoryNames.join(', ')}.`);
  const passed = verifications.filter((item) => PASS_STATUSES.has(item.status.toLowerCase()));
  if (passed.length) {
    confirmed.push(`Passing verification recorded: ${passed.map((item) => `${item.type} (${item.command})`).join(', ')}.`);
  }
  return confirmed;
}

function buildSuggestions(risks) {
  const titles = new Set(risks.map((risk) => risk.title));
  const suggestions = [];
  if (titles.has('UI changed without visual evidence')) {
    suggestions.push('Capture a screenshot or record a manual visual check for the changed screen.');
  }
  if (titles.has('Auth/session change lacks behavior verification')) {
    suggestions.push('Run the login/session regression path and record the command or manual result.');
  }
  if (titles.has('API/data-flow change lacks failure-path evidence')) {
    suggestions.push('Verify success and failure paths for the changed request or data flow.');
  }
  if (titles.has('Config/dependency change lacks runtime verification')) {
    suggestions.push('Run a build, typecheck, or local start command after the config/dependency change.');
  }
  if (titles.has('Claims mention tests but no passing test evidence exists') || titles.has('No verification evidence provided')) {
    suggestions.push('Add at least one passing test, lint, build, or manual verification entry before commit.');
  }
  if (suggestions.length === 0) suggestions.push('Review the diff once manually and keep the verification ledger with the commit notes.');
  return suggestions;
}

function normalizeLocaleValue(value) {
  return String(value || '')
    .trim()
    .split('.')[0]
    .split('@')[0]
    .replaceAll('_', '-')
    .toLowerCase();
}

function languageFromValue(value) {
  const locale = normalizeLocaleValue(value);
  if (!locale || locale === 'c' || locale === 'posix') return '';
  if (['zh', 'cn', 'chinese', '中文'].includes(locale) || locale.startsWith('zh-')) return 'zh';
  if (['en', 'english'].includes(locale) || locale.startsWith('en-')) return 'en';
  return '';
}

function detectReportLanguage(env = process.env) {
  const envLocale = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((item) => String(item || '').trim());
  if (envLocale) return languageFromValue(envLocale) || 'zh';
  const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  return languageFromValue(intlLocale) || 'zh';
}

function resolveReportLanguage(language, env = process.env) {
  const explicit = String(language || '').trim();
  if (!explicit || explicit.toLowerCase() === 'auto') return detectReportLanguage(env);
  return languageFromValue(explicit) || 'zh';
}

function localizeDecision(decision, language) {
  if (language !== 'zh') return decision;
  return (
    {
      Ready: '可提交',
      'Review before commit': '提交前复核',
      'Needs evidence': '证据不足',
    }[decision] || decision
  );
}

function localizeCategory(category, language) {
  if (language !== 'zh') return category;
  return (
    {
      api: 'API',
      auth: '登录/会话',
      code: '代码',
      config: '配置',
      docs: '文档',
      test: '测试',
      ui: 'UI',
    }[category] || category
  );
}

function localizeChangeStatus(status, language) {
  if (language !== 'zh') return status;
  return (
    {
      added: '新增',
      changed: '变更',
      deleted: '删除',
      modified: '修改',
      renamed: '重命名',
      untracked: '未跟踪',
    }[status] || status
  );
}

function localizeVerificationStatus(status, language) {
  if (language !== 'zh') return status;
  return (
    {
      passed: '通过',
      pass: '通过',
      success: '通过',
      successful: '通过',
      failed: '失败',
      fail: '失败',
      error: '错误',
      errored: '错误',
      unknown: '未知',
    }[status] || status
  );
}

function localizeSeverity(severity, language) {
  if (language !== 'zh') return severity;
  return (
    {
      high: '高',
      medium: '中',
      low: '低',
    }[severity] || severity
  );
}

function riskKey(risk) {
  return risk.key || RISK_KEYS[risk.title] || '';
}

function localizeRiskTitle(risk, language) {
  if (language !== 'zh') return risk.title;
  return (
    {
      noChanges: '未检测到 git 改动',
      noVerification: '缺少验证证据',
      verificationFailed: '验证记录包含失败',
      uiNoVisual: 'UI 改动缺少视觉证据',
      authNoBehavior: '登录/会话改动缺少行为验证',
      apiNoBehavior: 'API/数据流改动缺少行为验证',
      configNoRuntime: '配置/依赖改动缺少运行验证',
      claimsTestsNoEvidence: '声称已测试但缺少通过记录',
      completeNoLedger: '完成声明缺少证据 ledger',
    }[riskKey(risk)] || risk.title
  );
}

function localizeRiskEvidence(risk, language) {
  if (language !== 'zh') return risk.evidence;
  const key = riskKey(risk);
  if (key === 'noChanges') return '`git status` 没有报告改动文件。';
  if (key === 'noVerification') return '没有记录测试、lint、构建或人工检查。';
  if (key === 'verificationFailed') return '至少一条验证记录是 failed/error 状态。';
  if (key === 'uiNoVisual') {
    const count = Number.parseInt(String(risk.evidence).match(/\d+/)?.[0] || '0', 10);
    return `${count || '若干'} 个 UI 相关文件有改动，但没有通过截图、浏览器、模拟器或人工视觉检查。`;
  }
  if (key === 'authNoBehavior') return '登录、token、会话相关文件有改动，但没有通过测试或人工验证。';
  if (key === 'apiNoBehavior') return 'API 或请求代码有改动，但没有记录成功/失败路径验证。';
  if (key === 'configNoRuntime') return '配置、依赖或环境文件有改动，但没有构建、类型检查或启动证据。';
  if (key === 'claimsTestsNoEvidence') return '完成说明提到了测试，但 ledger 中没有通过的测试记录。';
  if (key === 'completeNoLedger') return '声称已完成，但没有提供验证记录。';
  return risk.evidence;
}

function localizedConfirmed(report, language) {
  if (language !== 'zh') return report.confirmed;
  const confirmed = [`从 git status 检测到 ${report.changes.length} 个改动文件。`];
  const categoryNames = Object.keys(report.categories).sort();
  if (categoryNames.length) {
    confirmed.push(`改动分类：${categoryNames.map((item) => localizeCategory(item, language)).join('、')}。`);
  }
  const passed = report.verifications.filter((item) => PASS_STATUSES.has(item.status.toLowerCase()));
  if (passed.length) {
    confirmed.push(`已记录通过的验证：${passed.map((item) => `${item.type} (${item.command})`).join('、')}。`);
  }
  return confirmed;
}

function localizedSuggestions(report, language) {
  if (language !== 'zh') return report.suggestions;
  const titles = new Set(report.risks.map((risk) => riskKey(risk)));
  const suggestions = [];
  if (titles.has('uiNoVisual')) suggestions.push('给改动页面补一张截图，或记录一次人工视觉检查。');
  if (titles.has('authNoBehavior')) suggestions.push('跑一遍登录/会话回归路径，并记录命令或人工结果。');
  if (titles.has('apiNoBehavior')) suggestions.push('验证这条请求或数据流的成功路径和失败路径。');
  if (titles.has('configNoRuntime')) suggestions.push('配置或依赖改动后，至少跑一次构建、类型检查或本地启动。');
  if (titles.has('claimsTestsNoEvidence') || titles.has('noVerification')) {
    suggestions.push('提交前补一条通过的测试、lint、构建或人工验证记录。');
  }
  if (suggestions.length === 0) suggestions.push('手动复核一次 diff，并把验证 ledger 放进提交说明或交付记录。');
  return suggestions;
}

function analyzeDelivery({ repo, intent = '', claims = '', verifications = [] }) {
  const repoRoot = gitRoot(repo);
  const normalized = verifications.map(normalizeVerification);
  const changes = collectChanges(repoRoot);
  const categories = summarizeCategories(changes);
  const risks = buildRisks(changes, categories, claims, normalized);
  let score = Math.max(0, 100 - risks.reduce((sum, risk) => sum + risk.penalty, 0));
  if (risks.length && normalized.length === 0) score = Math.min(score, 60);
  if (risks.some((risk) => risk.severity === 'high')) score = Math.min(score, 75);
  const decision = score >= 85 && risks.length === 0 ? 'Ready' : score >= 60 ? 'Review before commit' : 'Needs evidence';
  return {
    repo: repoRoot,
    intent: intent.trim(),
    claims: claims.trim(),
    score,
    decision,
    changes,
    categories,
    confirmed: buildConfirmed(changes, categories, normalized),
    risks,
    suggestions: buildSuggestions(risks),
    verifications: normalized,
  };
}

function renderMarkdown(report, language = 'auto') {
  const reportLanguage = resolveReportLanguage(language);
  if (reportLanguage === 'en') return renderEnglishMarkdown(report);
  return renderChineseMarkdown(report);
}

function renderEnglishMarkdown(report) {
  const lines = [
    '# Agent Proof Delivery Report',
    '',
    `Delivery confidence: ${report.score}/100`,
    `Decision: ${report.decision}`,
    '',
    '## Scope',
    `- Repo: \`${report.repo}\``,
    `- Intent: ${report.intent || '(not provided)'}`,
    `- Agent claims: ${report.claims || '(not provided)'}`,
    '',
    '## Confirmed',
  ];
  for (const item of report.confirmed) lines.push(`- ${item}`);
  lines.push('', '## Risks');
  if (report.risks.length) {
    lines.push('| Severity | Risk | Evidence |', '|---|---|---|');
    for (const risk of report.risks) lines.push(`| ${risk.severity} | ${risk.title} | ${risk.evidence} |`);
  } else {
    lines.push('- No blocking delivery risks found by the local evidence check.');
  }
  lines.push('', '## Suggestions');
  for (const item of report.suggestions) lines.push(`- ${item}`);
  lines.push('', '## File Changes');
  if (report.changes.length) {
    for (const change of report.changes) lines.push(`- ${change.status}: \`${change.path}\``);
  } else {
    lines.push('- No changed files detected.');
  }
  lines.push('', '## Verification Records');
  if (report.verifications.length) {
    for (const item of report.verifications) {
      const note = item.note ? ` - ${item.note}` : '';
      lines.push(`- ${item.type}: \`${item.command}\` -> ${item.status}${note}`);
    }
  } else {
    lines.push('- No verification entries were provided.');
  }
  return `${lines.join('\n')}\n`;
}

function renderChineseMarkdown(report) {
  const lines = [
    '# Agent Proof 交付验收报告',
    '',
    `交付可信度: ${report.score}/100`,
    `判定: ${localizeDecision(report.decision, 'zh')}`,
    '',
    '## 范围',
    `- 仓库: \`${report.repo}\``,
    `- 目标: ${report.intent || '（未提供）'}`,
    `- Agent 声称: ${report.claims || '（未提供）'}`,
    '',
    '## 已确认',
  ];
  for (const item of localizedConfirmed(report, 'zh')) lines.push(`- ${item}`);
  lines.push('', '## 风险');
  if (report.risks.length) {
    lines.push('| 严重级别 | 风险 | 证据 |', '|---|---|---|');
    for (const risk of report.risks) {
      lines.push(`| ${localizeSeverity(risk.severity, 'zh')} | ${localizeRiskTitle(risk, 'zh')} | ${localizeRiskEvidence(risk, 'zh')} |`);
    }
  } else {
    lines.push('- 本地证据检查没有发现阻塞性交付风险。');
  }
  lines.push('', '## 建议');
  for (const item of localizedSuggestions(report, 'zh')) lines.push(`- ${item}`);
  lines.push('', '## 文件改动');
  if (report.changes.length) {
    for (const change of report.changes) lines.push(`- ${localizeChangeStatus(change.status, 'zh')}: \`${change.path}\``);
  } else {
    lines.push('- 未检测到改动文件。');
  }
  lines.push('', '## 验证记录');
  if (report.verifications.length) {
    for (const item of report.verifications) {
      const note = item.note ? ` - ${item.note}` : '';
      lines.push(`- ${item.type}: \`${item.command}\` -> ${localizeVerificationStatus(item.status, 'zh')}${note}`);
    }
  } else {
    lines.push('- 未提供验证记录。');
  }
  return `${lines.join('\n')}\n`;
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--') {
      options._ = argv.slice(i + 1);
      break;
    }
    if (item.startsWith('--')) {
      const key = item.slice(2);
      if (key === 'allow-failure') {
        options[key] = true;
      } else {
        options[key] = argv[i + 1] || '';
        i += 1;
      }
    } else {
      options._.push(item);
    }
  }
  return options;
}

function readText(value, filePath) {
  if (filePath) return fs.readFileSync(filePath, 'utf8').trim();
  return value || '';
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandText(command) {
  return command.map(shellQuote).join(' ');
}

function currentScriptCommand() {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : 'agent-proof.mjs';
  return `node ${shellQuote(script)}`;
}

function recordCommand(options) {
  const command = options._ || [];
  if (command.length === 0) throw new Error('record requires a command after --');
  const ledgerPath = options.ledger || 'verification-ledger.json';
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  const durationMs = Date.now() - started;
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const text = commandText(command);
  const entry = {
    type: inferVerificationType({ command: text }),
    command: text,
    status: exitCode === 0 ? 'passed' : 'failed',
    exit_code: exitCode,
    duration_ms: durationMs,
    recorded_at: new Date().toISOString(),
    note: options.note || '',
  };
  const ledger = loadLedger(ledgerPath);
  ledger.verifications.push(entry);
  writeLedger(ledgerPath, ledger);
  console.log(`Recorded ${entry.status} verification in ${ledgerPath}`);
  return options['allow-failure'] ? 0 : exitCode;
}

function runCheck(options) {
  const intent = readText(options.intent, options['intent-file']);
  const claims = readText(options.claims, options['claims-file']);
  const verifications = loadVerifications(options['verification-file']);
  const report = analyzeDelivery({ repo: options.repo || '.', intent, claims, verifications });
  const output = options.output || 'delivery-report.md';
  const language = resolveReportLanguage(options.language || options.lang);
  writeText(output, renderMarkdown(report, language));
  console.log(`Wrote ${output} (score ${report.score}/100, ${report.decision})`);
  return 0;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function detectPackageManager(repo) {
  const pkgPath = path.join(repo, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = readJsonFile(pkgPath);
    const manager = String(pkg.packageManager || '').split('@')[0];
    if (manager) return manager;
  }
  if (fs.existsSync(path.join(repo, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repo, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(repo, 'bun.lock')) || fs.existsSync(path.join(repo, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function workspaceDirs(repo, pkg) {
  const workspaces = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : Array.isArray(pkg.workspaces?.packages)
      ? pkg.workspaces.packages
      : [];
  const dirs = [];
  for (const item of workspaces) {
    if (typeof item !== 'string') continue;
    if (item.endsWith('/*')) {
      const base = path.join(repo, item.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        const candidate = path.join(base, name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) dirs.push(candidate);
      }
    } else {
      const candidate = path.join(repo, item);
      if (fs.existsSync(path.join(candidate, 'package.json'))) dirs.push(candidate);
    }
  }
  return dirs;
}

function scriptCommand(manager, script, pkg, relativeDir) {
  if (relativeDir === '.') {
    if (manager === 'npm') return `npm run ${script}`;
    return `${manager} ${script}`;
  }
  if (manager === 'pnpm' && pkg.name) return `pnpm --filter ${pkg.name} ${script}`;
  if (manager === 'npm') return `npm --workspace ${relativeDir} run ${script}`;
  if (manager === 'yarn' && pkg.name) return `yarn workspace ${pkg.name} ${script}`;
  if (manager === 'bun') return `(cd ${relativeDir} && bun run ${script})`;
  return `(cd ${relativeDir} && ${manager} ${script})`;
}

function collectPackages(repo) {
  const rootPkgPath = path.join(repo, 'package.json');
  if (!fs.existsSync(rootPkgPath)) return [];
  const rootPkg = readJsonFile(rootPkgPath);
  const packages = [{ dir: repo, relativeDir: '.', pkg: rootPkg }];
  for (const dir of workspaceDirs(repo, rootPkg)) {
    packages.push({ dir, relativeDir: path.relative(repo, dir), pkg: readJsonFile(path.join(dir, 'package.json')) });
  }
  return packages;
}

function doctor(options) {
  const repo = path.resolve(options.repo || '.');
  const manager = detectPackageManager(repo);
  const packages = collectPackages(repo);
  if (packages.length === 0) {
    console.log(`No package.json found under ${repo}`);
    return 0;
  }
  console.log('Agent Proof project doctor');
  console.log(`Repo: ${repo}`);
  console.log(`Package manager: ${manager}`);
  console.log('');
  console.log('Available verification scripts:');
  const priorities = ['lint', 'typecheck', 'test', 'build'];
  const recommendations = [];
  for (const item of packages) {
    const scripts = item.pkg.scripts || {};
    const names = Object.keys(scripts).sort();
    const label = item.relativeDir === '.' ? 'root' : `${item.pkg.name || item.relativeDir} (${item.relativeDir})`;
    console.log(`- ${label}: ${names.length ? names.join(', ') : '(none)'}`);
    for (const script of priorities) {
      if (scripts[script]) recommendations.push(scriptCommand(manager, script, item.pkg, item.relativeDir));
    }
  }
  console.log('');
  if (recommendations.length) {
    console.log('Suggested record commands:');
    const prefix = currentScriptCommand();
    for (const command of [...new Set(recommendations)]) {
      console.log(`- ${prefix} record --ledger .agent-proof/verification-ledger.json -- ${command}`);
    }
  } else {
    console.log('No common verification scripts found. Run your project manually, then record the exact command.');
  }
  return 0;
}

function usage() {
  return `Usage:
  node agent-proof.mjs record --ledger verification-ledger.json -- <command...>
  node agent-proof.mjs check --repo <repo> --intent <text> --claims <text> --verification-file <ledger.json> --output delivery-report.md [--language auto|zh|en]
  node agent-proof.mjs doctor --repo <repo>
`;
}

export { analyzeDelivery, detectReportLanguage, inferVerificationType, loadLedger, renderMarkdown };

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    console.log(usage());
    return 0;
  }
  const options = parseOptions(rest);
  if (command === 'record') return recordCommand(options);
  if (command === 'check') return runCheck(options);
  if (command === 'doctor') return doctor(options);
  throw new Error(`unknown command: ${command}`);
}

const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entryPath) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`agent-proof: ${error.message}`);
    process.exitCode = 1;
  }
}
