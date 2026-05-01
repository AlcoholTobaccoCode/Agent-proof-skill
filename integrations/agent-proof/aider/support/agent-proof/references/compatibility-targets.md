# Agent Proof Compatibility Targets

This skill is native to Codex-style `SKILL.md` packages. Other tools need generated integration files.

## Support Matrix

| Target | Status | Generated Shape |
|---|---|---|
| codex | direct | `codex/agent-proof/SKILL.md` plus bundled `scripts/`, `references/`, `examples/`, `agents/` |
| antigravity | converted | `antigravity/agent-proof/SKILL.md` with Antigravity metadata and bundled support files |
| gemini-cli | converted | `gemini-cli/gemini-extension.json` plus `gemini-cli/skills/agent-proof/SKILL.md` |
| opencode | converted | `opencode/agents/agent-proof.md` plus `opencode/support/agent-proof/` |
| copilot | converted | `copilot/agents/agent-proof.md` plus `copilot/support/agent-proof/` |
| openclaw | converted | `openclaw/agent-proof/SOUL.md`, `AGENTS.md`, `IDENTITY.md` |
| cursor | converted | `cursor/rules/agent-proof.mdc` plus `cursor/support/agent-proof/` |
| aider | converted | `aider/CONVENTIONS.md` plus `aider/support/agent-proof/` |
| windsurf | converted | `windsurf/.windsurfrules` plus `windsurf/support/agent-proof/` |
| kimi | converted | `kimi/agent-proof/agent.yaml` plus `system.md` and support files |

## Commands

Audit compatibility:

```bash
node generated-skills/agent-proof/scripts/convert-integrations.mjs audit \
  --skill generated-skills/agent-proof
```

Generate all integration files:

```bash
node generated-skills/agent-proof/scripts/convert-integrations.mjs convert \
  --skill generated-skills/agent-proof \
  --out integrations/agent-proof \
  --tool all
```

Generate one target:

```bash
node generated-skills/agent-proof/scripts/convert-integrations.mjs convert \
  --skill generated-skills/agent-proof \
  --out integrations/agent-proof \
  --tool cursor
```

## Notes

- The converter is non-destructive and never installs into user config folders.
- Copilot and Codex are intentionally handled by this local converter even though the referenced `agency-agents` `convert.sh` does not emit those target outputs.
- Single-file targets such as Aider and Windsurf still need the support folder or original skill folder available for the deterministic Node/Python CLI.
- Converted support means file-format compatibility, not certified runtime behavior in every client version.
