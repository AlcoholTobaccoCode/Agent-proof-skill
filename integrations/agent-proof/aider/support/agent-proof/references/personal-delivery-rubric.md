# Personal Delivery Review Rubric

Use this rubric for individual developers checking AI-assisted coding work before commit.

## Core Principle

The agent's completion claim is not evidence. Evidence comes from git changes, command results, screenshots, manual checks, or explicit notes about what was not verified.

Risks are not cleared by a manual checkbox. A risk is cleared by adding matching evidence to the evidence record and rerunning `check`.

Keep the workflow lightweight. Agent Proof should protect delivery quality without making the user feel trapped in process.

## When To Run Agent Proof

| Situation | Expected behavior |
|---|---|
| No file changes, pure Q&A, planning, or analysis | Skip Agent Proof and state that no file changes were made. |
| Low-risk docs, comments, copy, prompt-only edits | Lightweight mode is acceptable; state that full Agent Proof was not run and mention unverified items. |
| Normal code changes | Run Agent Proof and record at least one real verification command or manual check. |
| UI, API/data flow, auth/session, config, dependency, migration, build, or release changes | Full Agent Proof is required, with matching evidence for the changed surface. |
| Commit, PR, handoff, or explicit user request for verification | Full Agent Proof is required and the report should be archived if configured. |

Short version: high risk forced, low risk lightweight, no changes skipped.

## Score Bands

| Score | Decision | Meaning |
|---|---|---|
| 85-100 | Ready | Evidence covers the changed surface. Skim diff before commit. |
| 60-84 | Review before commit | Some evidence exists, but at least one important verification is missing. |
| 0-59 | Needs evidence | Missing or failed verification makes the delivery too risky to commit blindly. |

## Risk Checks

| Change or claim | Expected evidence | Risk if missing |
|---|---|---|
| UI files, screens, components, styles | screenshot, simulator/browser check, or manual visual note | UI changed without visual evidence |
| auth, login, token, session | regression test, manual login path, or e2e check | auth/session change lacks behavior verification |
| API, client, fetch, request, data flow | test, integration check, or manual success/failure path | API/data-flow change lacks failure-path evidence |
| config, env, dependency, build files | build, typecheck, local start, or runtime check | config/dependency change lacks runtime verification |
| claim says tests passed | passing test command in ledger | claim mentions tests but no passing test evidence |
| completion claim with no ledger | at least one verification entry or explicit unverified note | completion claim has no evidence ledger |

## How To Clear Common Risks

Use "evidence record" in user-facing explanations. `ledger` is the CLI/internal name for the same file.

| Report risk | What to add | Current command |
|---|---|---|
| UI changed without visual evidence | screenshot, browser/simulator check, or manual visual note | `record --note "Checked changed screen visually" -- node -e "console.log('manual visual check passed')"` |
| claim mentions tests but no passing test evidence | a real passing test command | `record -- pnpm test` |
| config/dependency change lacks runtime verification | typecheck, build, or local start command | `record -- pnpm typecheck` or `record -- pnpm build` |
| API/data-flow change lacks failure-path evidence | test/integration/manual check covering success and failure path | `record --note "Checked success and error response paths" -- node -e "console.log('manual api check passed')"` |

After adding evidence, rerun:

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check --repo . --verification-file .agent-proof/verification-ledger.json --output .agent-proof/delivery-report.md
```

If the risk remains, inspect `.agent-proof/verification-ledger.json` and confirm the relevant entry has `"status": "passed"` and a type/command that matches the risk.

## Good Evidence

- exact command and status, such as `npm test -> passed`
- automatic ledger entries from `npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record -- <command>`
- screenshot or simulator check for user-visible UI
- manual check note with the path checked and outcome
- explicit skipped verification with reason and next action

## Weak Evidence

- "looks good"
- "should work"
- "agent said done"
- command name without pass/fail status
- old test output from before the current diff

## Preferred Command Flow

Use Node first because most vibe coding machines already have it:

```bash
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill doctor --repo .
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill record --ledger .agent-proof/verification-ledger.json -- pnpm typecheck
npx --yes github:AlcoholTobaccoCode/Agent-proof-skill check --repo . --verification-file .agent-proof/verification-ledger.json --output .agent-proof/delivery-report.md
```

User-facing output follows the current system locale by default: `doctor`, `check` reports, completion messages, and `--help` use English for clear English locales, Chinese for clear Chinese locales, and Chinese as the fallback when detection is uncertain. Use `--language zh` or `--language en` when deterministic report language matters.

Use Python only when Node is unavailable:

```bash
python3 /path/to/Agent-proof-skill/scripts/agent_proof.py record --ledger .agent-proof/verification-ledger.json -- python3 -m unittest
python3 /path/to/Agent-proof-skill/scripts/agent_proof.py check --repo . --verification-file .agent-proof/verification-ledger.json --output .agent-proof/delivery-report.md
```

## Reviewer Tone

Be direct and skeptical without adding bureaucracy. The goal is to help one developer avoid embarrassing review misses, not to create a compliance process.
