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

## Workflow

1. Capture the delivery intent.
   Use the user's original request, a short summary, or an intent file. If the exact request is unavailable, state that the report is based on a reconstructed intent.

2. Capture the agent claim.
   Use the final answer, handoff note, or commit-prep summary. Do not treat the claim as evidence; treat it as something to verify.

3. Capture verification evidence.
   Prefer automatic ledger generation with the Node script. Use Python only as a fallback when Node is unavailable.

   ```bash
   node /path/to/agent-proof/scripts/agent-proof.mjs record \
     --ledger verification-ledger.json \
     -- npm test
   ```

   This runs the command, records exit code, duration, status, timestamp, and inferred verification type, then appends the result to the ledger. For a command that may fail but should still be recorded without stopping the shell flow, add `--allow-failure`.

4. Run the local checker.
   Use the Node checker first:

   ```bash
   node /path/to/agent-proof/scripts/agent-proof.mjs check \
     --repo /path/to/project \
     --intent "Fix login persistence" \
     --claims "Login persistence is complete and tests pass" \
     --verification-file verification-ledger.json \
     --output delivery-report.md
   ```

   If Node is unavailable, use the Python fallback:

   ```bash
   python3 /path/to/agent-proof/scripts/agent_proof.py check \
     --repo /path/to/project \
     --intent "Fix login persistence" \
     --claims "Login persistence is complete and tests pass" \
     --verification-file verification-ledger.json \
     --output delivery-report.md
   ```

5. Read the report like a gate, not a summary.
   A low score means "needs evidence", not necessarily "bad code". Recommend the smallest missing verification step before commit.

## Verification Ledger

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
