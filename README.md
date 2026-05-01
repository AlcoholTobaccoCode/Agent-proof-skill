# Agent Proof Skill

Agent Proof 是一个给个人开发者用的 AI 交付验收 skill。

它不负责替你写代码，而是在 AI agent 说“完成了”之后，帮你在提交前检查：

- git 实际改了哪些文件
- agent 声称完成了什么
- 测试、lint、build、截图、人工检查有没有证据
- 有没有“说测试通过但没有测试记录”的假完成
- UI、auth、API、config 等改动是否缺少对应验证

一句话：

> AI 说做完了，先别信，让它拿证据。

## 安装

Codex / skills.sh 方式：

```bash
npx skills add https://github.com/AlcoholTobaccoCode/Agent-proof-skill --skill agent-proof
```

本地开发时可以直接在仓库根目录运行：

```bash
node scripts/agent-proof.mjs --help
```

## 快速使用

先让 Agent Proof 扫一下项目里真实存在的验证脚本，不要默认假设 `npm run lint` 一定存在：

```bash
node scripts/agent-proof.mjs doctor --repo /path/to/project
```

再用 Node 记录验证命令，Node 是默认推荐入口：

```bash
node scripts/agent-proof.mjs record \
  --ledger .agent-proof/verification-ledger.json \
  -- pnpm typecheck
```

建议把 `.agent-proof/` 加进被测项目的 `.gitignore`。即使没加，`check` 也会忽略 `.agent-proof/`、根目录 `verification-ledger.json` 和根目录 `delivery-report.md`，避免自生成文件污染报告。

再生成交付验收报告：

```bash
node scripts/agent-proof.mjs check \
  --repo /path/to/project \
  --intent "Fix login persistence" \
  --claims "Login persistence is complete and tests pass" \
  --verification-file .agent-proof/verification-ledger.json \
  --output .agent-proof/delivery-report.md
```

报告默认按当前系统语言生成：能确认英文环境就输出英文，能确认中文环境就输出中文，`C` / `POSIX` / 无法判断时回落中文。需要手动指定时加：

```bash
node scripts/agent-proof.mjs check \
  --repo /path/to/project \
  --verification-file .agent-proof/verification-ledger.json \
  --output .agent-proof/delivery-report.md \
  --language zh
```

如果 Node 不可用，可以用 Python 兜底：

```bash
python3 scripts/agent_proof.py record \
  --ledger .agent-proof/verification-ledger.json \
  -- python3 -m unittest
```

## 多工具兼容

原生支持：

- Codex

转换支持：

- Antigravity
- Gemini CLI
- OpenCode
- Copilot
- OpenClaw
- Cursor
- Aider
- Windsurf
- Kimi

生成所有兼容格式：

```bash
node scripts/convert-integrations.mjs convert \
  --skill . \
  --out integrations/agent-proof \
  --tool all
```

审查兼容状态：

```bash
node scripts/convert-integrations.mjs audit --skill .
```

转换产物在 `integrations/agent-proof/`。转换脚本只写仓库内文件，不会修改你的 `~/.config`、`.cursor`、`.opencode` 等真实工具配置目录。

## 仓库结构

```text
.
├── SKILL.md
├── agents/
│   └── openai.yaml
├── examples/
│   └── delivery-report.md
├── integrations/
│   └── agent-proof/
├── references/
│   ├── compatibility-targets.md
│   └── personal-delivery-rubric.md
├── scripts/
│   ├── agent-proof.mjs
│   ├── agent_proof.py
│   └── convert-integrations.mjs
└── tests/
    ├── agent-proof.test.mjs
    ├── convert-integrations.test.mjs
    └── test_agent_proof.py
```

## 验证

```bash
npm test
```

或者分别运行：

```bash
node --check scripts/agent-proof.mjs
node --check scripts/convert-integrations.mjs
node --test tests/agent-proof.test.mjs tests/convert-integrations.test.mjs
python3 -m py_compile scripts/agent_proof.py
python3 -m unittest tests/test_agent_proof.py
```

Skill 基础校验：

```bash
python /path/to/skill-creator/scripts/quick_validate.py .
```

如果你在别的机器上没有 Codex 的 `quick_validate.py`，可以跳过这条；Node/Python 测试是主要运行时验证。

## 许可证

MIT
