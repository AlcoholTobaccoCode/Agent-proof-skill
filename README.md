# Agent Proof Skill

Agent Proof 是给“团队里的个人开发者”用的 AI 交付验收小工具。

你让 AI 改完代码后，别急着提交。先让它过一遍 Agent Proof，看看三件事：

- 这次到底改了哪些文件
- AI 最后说自己完成了什么
- 有没有真实验证记录，比如 typecheck、测试、构建、截图、人工检查

说白了就是一句话：

> AI 说做完了，先别信，让它把证据拿出来。

它不是团队后台，不管成员、权限、审批、PR bot、CI/CD。第一阶段只做一件事：帮个人开发者在提交前把“AI 交付到底靠不靠谱”看明白。

## 安装和更新

给 Codex / skills.sh 安装：

```bash
npx skills add https://github.com/AlcoholTobaccoCode/Agent-proof-skill --skill agent-proof
```

更新也跑同一条：

```bash
npx skills add https://github.com/AlcoholTobaccoCode/Agent-proof-skill --skill agent-proof
```

如果安装器问要不要覆盖，确认就行。想少点交互可以加 `--yes`：

```bash
npx skills add https://github.com/AlcoholTobaccoCode/Agent-proof-skill --skill agent-proof --yes
```

更新完最好重启一下 Codex 或你正在用的 agent 客户端，不然有些客户端会继续吃旧缓存。

注意：`npx skills add ...` 是把 skill 装给 agent 用，不是在你的业务项目里生成 `scripts/agent-proof.mjs`。所以在任意项目里手动跑 Agent Proof 时，不要写：

```bash
node scripts/agent-proof.mjs doctor --repo .
```

这条命令会去当前业务项目的 `scripts/` 目录找文件，项目里没有就会报 `Cannot find module`。通用跑法看下面。

## 第一次在项目里怎么跑

先进入你要检查的项目根目录。

第一步，让 Agent Proof 看看这个项目到底有哪些验证脚本：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo .
```

它会告诉你项目用的是 npm、pnpm、yarn 还是 bun，也会列出真实存在的 `lint`、`typecheck`、`test`、`build` 脚本。别上来就复制 `npm run lint`，项目里不一定有，上次那类低级路径和脚本假设就是这么来的。

第二步，复制 doctor 推荐的命令，用 `record` 记录一次真实验证：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
  --ledger .agent-proof/verification-ledger.json \
  -- pnpm typecheck
```

`record` 会真正运行 `pnpm typecheck`，然后把命令、退出码、耗时、通过/失败状态写进 `.agent-proof/verification-ledger.json`。

这个文件可以理解成“证据记录”。CLI 参数里还叫 `ledger`，是为了兼容脚本和老版本命令；用户心里把它当成“这次到底验了什么”的记录本就行。

第三步，生成交付验收报告：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check \
  --repo . \
  --intent "这次让 AI 改什么" \
  --claims "AI 最后声称完成了什么" \
  --verification-file .agent-proof/verification-ledger.json \
  --output .agent-proof/delivery-report.md
```

打开 `.agent-proof/delivery-report.md`，重点看：

- 评分是多少
- 有哪些风险
- 哪些证据缺了
- 需要补跑什么验证

低分不等于代码一定烂，它只说明证据不够。比如 UI 改了却没截图，配置改了却没 build，API 改了却没跑成功/失败路径，这些都会被打下来。

## 风险怎么消掉

Agent Proof 不是让你手动勾选“已完成”。那种勾选很容易变成自欺欺人。

它的规则是：

```text
风险出现 -> 补一条对应证据 -> 重新 check -> 风险自动消失
```

### UI 改动缺少视觉证据

如果报告里出现：

```text
UI 改动缺少视觉证据
```

意思是：你改了页面、组件或样式，但证据记录里没有截图、浏览器检查、模拟器检查或人工视觉检查。

能自动截图就记录截图命令：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
  --ledger .agent-proof/verification-ledger.json \
  -- xcrun simctl io booted screenshot .agent-proof/ui-check.png
```

如果只是人工检查，也要留下记录。当前版本可以先用一个一定成功的小命令配合 `--note`：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
  --ledger .agent-proof/verification-ledger.json \
  --note "已在浏览器检查首页，桌面和移动端布局正常" \
  -- node -e "console.log('manual visual check passed')"
```

这条会在证据记录里写入一条通过的人工检查。下次重新跑 `check`，UI 视觉风险就会被这条证据覆盖。

### 声称已测试但缺少通过记录

如果报告里出现：

```text
声称已测试但缺少通过记录
```

意思是：AI 的交付说明里写了“测试通过”之类的话，但证据记录里没有任何通过的测试命令。嘴上说测过不算，得把真实命令跑一遍：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
  --ledger .agent-proof/verification-ledger.json \
  -- pnpm test
```

项目没有 `pnpm test` 就先跑：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo .
```

复制 doctor 推荐的真实测试、类型检查或构建命令。别硬抄不存在的脚本。

### 补完证据后重新生成报告

每补一条证据，都重新跑一次：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check \
  --repo . \
  --intent "这次让 AI 改什么" \
  --claims "AI 最后声称完成了什么" \
  --verification-file .agent-proof/verification-ledger.json \
  --output .agent-proof/delivery-report.md
```

如果风险还在，说明证据类型没对上，或者命令失败了。打开 `.agent-proof/verification-ledger.json` 看最近一条是不是 `status: "passed"`。

后续可以把人工检查简化成更顺手的命令，比如 `agent-proof evidence --type visual --status passed --note "..."`。当前版本还没有这个命令，所以文档里先按已经能跑的 `record --note ... -- node -e ...` 写。

## 让你的 AI 自动使用 Agent Proof

你可以把下面这段放进项目的 `AGENTS.md`、Codex 自定义指令、Cursor Rules、Windsurf Rules，或者其他 AI 工具的项目规则里。

重点是：不要写成“每次开始任务时就审查交付可信度”。任务刚开始还没改代码，审不出东西。也不要写成“每个小任务都必须完整跑一遍流程”，那会影响原本使用 AI 的效率。

正确做法是：

- 开始任务时记住用户意图
- 改完后先判断风险等级
- 高风险强制完整验收
- 低风险轻量说明
- 无文件改动直接跳过
- 报告归档到固定位置，方便以后回看

推荐模板：

```text
每次完成任务、准备回复用户前，先判断本次是否需要 Agent Proof。

分级规则：
1. 无文件改动 / 纯问答 / 只做方案讨论：
   - 跳过 Agent Proof。
   - 回复中说明“本次无文件改动，未运行 Agent Proof”。

2. 低风险改动：
   - 例如 README、注释、纯文案、提示词、小范围非运行时代码说明。
   - 可以跳过完整 Agent Proof，或只做轻量说明。
   - 回复中说明“本次为低风险改动，未运行完整 Agent Proof”，并说明未验证项。

3. 普通代码改动：
   - 使用 Agent Proof。
   - 至少记录一条真实验证证据，例如 typecheck、test、build、lint 或人工检查。

4. 高风险改动：
   - 必须使用 Agent Proof。
   - 高风险包括 UI、API、auth/session、配置、依赖、数据流、迁移、构建发布相关改动。
   - 必须补对应证据，不要只用口头声明。

5. 准备提交、PR、交付给他人、或用户明确要求验收：
   - 必须完整运行 Agent Proof 并归档报告。

完整 Agent Proof 执行要求：
1. 先运行：
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo .
   根据 doctor 输出选择当前项目真实存在的验证命令，不要假设一定有 npm run lint。

2. 至少记录一条真实验证证据：
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
     --ledger .agent-proof/verification-ledger.json \
     -- <真实验证命令>

3. 生成本次交付验收报告：
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check \
     --repo . \
     --intent "<本次用户需求>" \
     --claims "<AI 最终完成声明>" \
     --verification-file .agent-proof/verification-ledger.json \
     --output .agent-proof/delivery-report.md

4. 如果报告提示 UI、API、配置、测试证据不足，按报告建议补证据后重新 check。不要用口头声明替代证据。

5. 最终回复用户前，简要说明：
   - Agent Proof 评分和判定
   - 已记录哪些验证
   - 还有哪些风险或未验证项
   - 报告保存位置

原则：
- Agent Proof 是交付护栏，不是审批流。
- 不要为了流程拖慢用户原本使用 AI 的效率。
- 高风险强制，低风险轻量，无改动跳过。
- 流程由 AI 自己承担，不要把判断和跑命令的负担甩给用户。
```

如果你想让 AI 把每天的报告集中到一个文件，可以再加这段：

```text
Agent Proof 报告归档规则：
- 报告根目录：<你自己的报告目录>/agent-proof
- 项目名：优先使用 git 根目录文件夹名
- 每天一个归档文件：<报告根目录>/<项目名>/YYYY-MM-DD.md
- 同一天的多个任务追加到同一个 md 中
- 每个任务用二级标题分隔：## HH:mm 任务重点
- 不要把 agent-proof check --output 直接写到当天归档文件，避免覆盖旧任务；先输出到 .agent-proof/delivery-report.md，再把本次报告内容追加到当天归档文件
```

macOS 本机路径示例：

```text
报告根目录：/Users/Shared/ai_memory/skills-test/agent-proof
当天归档文件：/Users/Shared/ai_memory/skills-test/agent-proof/<项目名>/YYYY-MM-DD.md
任务标题：## HH:mm 调整首页 UI
```

你原来的写法：

```text
审查结果放在 '/Users/Shared/ai_memory/skills-test/agent-proof/${项目名称}/${日期}_${时间}.md' 当天的任务放在同一个 md 中
```

这里有个小冲突：`${日期}_${时间}.md` 会变成每个任务一个文件，不是“当天同一个 md”。如果想当天一个文件，建议改成：

```text
审查结果追加到 '/Users/Shared/ai_memory/skills-test/agent-proof/${项目名称}/${日期}.md'，每个任务标题为 '## ${时间} ${任务重点}'。
```

## 语言规则

Agent Proof 的用户可见输出默认跟随当前系统语言：

- 明确是英文环境：输出英文
- 明确是中文环境：输出中文
- `C`、`POSIX`、空值、识别不准：兜底输出中文

现在这些输出都会走这个规则：

- `doctor` 项目体检输出
- `check` 生成的 Markdown 报告
- `record` / `check` 的完成提示
- `--help` 帮助文本

想强制指定语言就加：

```bash
--language zh
```

或者：

```bash
--language en
```

例如：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo . --language zh
```

## 推荐放哪里

建议把 Agent Proof 的产物都放到 `.agent-proof/`：

```text
.agent-proof/
├── verification-ledger.json
└── delivery-report.md
```

然后在业务项目的 `.gitignore` 里加：

```gitignore
.agent-proof/
```

即使你忘了加，Agent Proof 在扫描 git 改动时也会忽略 `.agent-proof/`、根目录 `verification-ledger.json`、根目录 `delivery-report.md`，不会把自己生成的报告当成你的业务改动。

## Node 优先，Python 兜底

默认推荐用 Node 版，因为现在 vibe coding 常见环境基本都有 Node：

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill --help
```

如果 Node 真不可用，可以用 Python 版兜底。但 Python 版需要你知道 Agent Proof 的真实安装路径或克隆路径，不要写业务项目里的相对路径：

```bash
python3 /path/to/Agent-proof-skill/scripts/agent_proof.py record \
  --ledger .agent-proof/verification-ledger.json \
  -- python3 -m unittest
```

## 支持哪些工具

原生支持：

- Codex

转换后支持：

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
npm run convert
```

或者直接跑：

```bash
node scripts/convert-integrations.mjs convert \
  --skill . \
  --out integrations/agent-proof \
  --tool all
```

审查兼容状态：

```bash
npm run audit
```

转换产物在 `integrations/agent-proof/`。转换脚本只写仓库内文件，不会偷偷改你的 `~/.config`、`.cursor`、`.opencode` 等真实工具配置目录。

## 仓库结构

```text
.
├── SKILL.md
├── agents/
├── examples/
├── integrations/
├── references/
├── scripts/
│   ├── agent-proof.mjs
│   ├── agent_proof.py
│   └── convert-integrations.mjs
└── tests/
```

## 开发验证

跑完整测试：

```bash
npm test
```

分开跑：

```bash
npm run test:node
npm run test:python
```

Skill 基础校验：

```bash
python /path/to/skill-creator/scripts/quick_validate.py .
```

如果你在别的机器上没有这个 `quick_validate.py`，可以跳过。真正的运行时验证主要看 Node/Python 测试。

## 许可证

MIT
