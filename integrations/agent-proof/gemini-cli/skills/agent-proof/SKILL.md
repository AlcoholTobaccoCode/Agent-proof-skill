---
name: agent-proof
description: Use when reviewing an individual developer's AI-assisted coding delivery before commit, especially vibe coding work that needs evidence-based checks for git changes, agent claims, tests, build/lint results, UI screenshots, manual verification, and missing-risk disclosure.
---
# Agent Proof

## Overview

Use this skill to produce a personal delivery evidence report before a developer commits AI-assisted code. Keep the scope individual and local: this is not a team approval system, SaaS backend, PR bot, CI replacement, or permissions workflow.

The default deliverable is a concise Markdown report that answers:

- What changed in git?
- What did the user ask for?
- What did the agent claim was complete?
- What verification evidence exists?
- What important evidence is missing before commit?

## Friction Budget

Agent Proof is a delivery guardrail, not an approval workflow. Do not slow the user down with a full ritual for every tiny task.

Use this triage before running the full flow:

- No file changes, pure Q&A, planning, or analysis: skip Agent Proof and state that no file changes were made.
- Low-risk docs, comments, copy, or prompt-only edits: lightweight mode is acceptable; mention that full Agent Proof was not run and list any unverified items.
- Normal code changes: run Agent Proof and record at least one real verification command or manual check.
- High-risk changes: always run Agent Proof and record matching evidence. High-risk includes UI, API/data flow, auth/session, config, dependency, migration, build, or release changes.
- Commit/PR/handoff or explicit user request for verification: always run the full flow and archive the report if configured.

The agent should absorb this process. Do not ask the user to decide which command to run unless local context is genuinely insufficient.

## Workflow

1. Capture the delivery intent.
   Use the user's original request, a short summary, or an intent file. If the exact request is unavailable, state that the report is based on a reconstructed intent.

2. Capture the agent claim.
   Use the final answer, handoff note, or commit-prep summary. Do not treat the claim as evidence; treat it as something to verify.

3. Capture verification evidence.
   Prefer automatic ledger generation with the Node script. Use Python only as a fallback when Node is unavailable.

   First inspect the target project's actual scripts. When the user is inside an arbitrary project, prefer the GitHub package entrypoint so the command works without knowing the skill install path:

   ```bash
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo .
   ```

   Record verification with the same universal entrypoint:

   ```bash
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
     --ledger .agent-proof/verification-ledger.json \
     -- pnpm typecheck
   ```

   If the skill is already checked out locally and the absolute path is known, direct Node execution is also valid:

   ```bash
   node /path/to/agent-proof/scripts/agent-proof.mjs record \
     --ledger .agent-proof/verification-ledger.json \
     -- pnpm typecheck
   ```

   This runs the command, records exit code, duration, status, timestamp, and inferred verification type, then appends the result to the ledger. For a command that may fail but should still be recorded without stopping the shell flow, add `--allow-failure`.

4. Run the local checker.
   Use the Node checker first through the universal GitHub package entrypoint:

   ```bash
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check \
     --repo . \
     --intent "Fix login persistence" \
     --claims "Login persistence is complete and tests pass" \
     --verification-file .agent-proof/verification-ledger.json \
     --output .agent-proof/delivery-report.md
   ```

   If the local skill path is known, direct Node execution is also valid:

   ```bash
   node /path/to/agent-proof/scripts/agent-proof.mjs check \
     --repo /path/to/project \
     --intent "Fix login persistence" \
     --claims "Login persistence is complete and tests pass" \
     --verification-file .agent-proof/verification-ledger.json \
     --output .agent-proof/delivery-report.md
   ```

   User-facing output defaults to the user's current system language, including `doctor`, `check` reports, completion messages, and `--help`. The CLI emits English for clear English locales, Chinese for clear Chinese locales, and falls back to Chinese when locale detection is uncertain. To force a language, add `--language zh` or `--language en`.

   If Node is unavailable, use the Python fallback:

   ```bash
   python3 /path/to/agent-proof/scripts/agent_proof.py check \
     --repo /path/to/project \
     --intent "Fix login persistence" \
     --claims "Login persistence is complete and tests pass" \
     --verification-file .agent-proof/verification-ledger.json \
     --output .agent-proof/delivery-report.md \
     --language zh
   ```

5. Read the report like a gate, not a summary.
   A low score means "needs evidence", not necessarily "bad code". Recommend the smallest missing verification step before commit.

   Do not tell the user to manually mark a risk complete. A risk is cleared by adding matching evidence to the evidence record and rerunning `check`.

   For UI visual evidence, prefer a real screenshot/browser/simulator command. If the user performed a manual visual check and no screenshot tooling is available, record it with a passing command plus a clear note:

   ```bash
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
     --ledger .agent-proof/verification-ledger.json \
     --note "Checked the changed home screen in browser; desktop and mobile layouts look correct" \
     -- node -e "console.log('manual visual check passed')"
   ```

   For "claims mention tests but no passing test evidence", run and record the real project test command, for example:

   ```bash
   npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record \
     --ledger .agent-proof/verification-ledger.json \
     -- pnpm test
   ```

## Verification Ledger

For user-facing explanations, call the ledger an "evidence record" first and mention the filename second. `ledger` is the CLI/internal term; `.agent-proof/verification-ledger.json` is the file that stores what was actually checked.

The checker accepts JSON shaped as either a list or an object with `verifications`:

```json
{
  "verifications": [
    {
      "type": "test",
      "command": "npm test",
      "status": "passed",
      "note": "Auth persistence regression covered"
    },
    {
      "type": "visual",
      "command": "iOS simulator screenshot",
      "status": "passed",
      "note": "Home screen checked on small viewport"
    }
  ]
}
```

Supported `status` values are intentionally loose. Prefer `passed` or `failed` for clarity.

Manual ledger entries are allowed, but automatic `record` entries are preferred because they preserve command text, exit code, duration, and timestamp.

`check` ignores its own root-level `verification-ledger.json`, `delivery-report.md`, and `.agent-proof/` artifacts when scanning git changes, so local evidence files do not pollute the delivery report.

## Review Rules

Use the generated score as a triage signal:

- `85-100`: likely ready, still skim the diff.
- `60-84`: review before commit and add focused evidence for the listed risks.
- `0-59`: do not commit as-is; evidence is missing or verification failed.

Read `references/personal-delivery-rubric.md` when you need the full scoring logic or want to manually review a report.

## Compatibility Conversion

The native package is Codex-compatible. For Antigravity, Gemini CLI, OpenCode, Copilot, OpenClaw, Cursor, Aider, Windsurf, and Kimi, generate converted integration files:

```bash
node /path/to/agent-proof/scripts/convert-integrations.mjs audit \
  --skill /path/to/agent-proof

node /path/to/agent-proof/scripts/convert-integrations.mjs convert \
  --skill /path/to/agent-proof \
  --out integrations/agent-proof \
  --tool all
```

Read `references/compatibility-targets.md` for the support matrix and generated file shapes. The converter writes output files only; it does not install into local tool configuration directories.

## Output Shape

Use `examples/delivery-report.md` as the preferred report shape. Keep the report short enough for a personal pre-commit check:

- score and decision first
- scope and claims
- confirmed evidence
- risks
- next actions
- changed files
- verification records

## Boundaries

Do not add team-heavy workflow unless the user explicitly asks. Avoid:

- team member management
- permissions and approval chains
- SaaS dashboards
- organization reporting
- mandatory PR bot integration
- CI/CD replacement

If the user asks for team rollout later, first preserve this personal workflow and add integrations around it.
