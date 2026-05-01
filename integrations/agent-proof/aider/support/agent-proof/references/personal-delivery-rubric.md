# Personal Delivery Review Rubric

Use this rubric for individual developers checking AI-assisted coding work before commit.

## Core Principle

The agent's completion claim is not evidence. Evidence comes from git changes, command results, screenshots, manual checks, or explicit notes about what was not verified.

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

## Good Evidence

- exact command and status, such as `npm test -> passed`
- automatic ledger entries from `node scripts/agent-proof.mjs record -- <command>`
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
node generated-skills/agent-proof/scripts/agent-proof.mjs record --ledger verification-ledger.json -- npm test
node generated-skills/agent-proof/scripts/agent-proof.mjs check --repo . --verification-file verification-ledger.json --output delivery-report.md
```

Use Python only when Node is unavailable:

```bash
python3 generated-skills/agent-proof/scripts/agent_proof.py record --ledger verification-ledger.json -- python3 -m unittest
python3 generated-skills/agent-proof/scripts/agent_proof.py check --repo . --verification-file verification-ledger.json --output delivery-report.md
```

## Reviewer Tone

Be direct and skeptical without adding bureaucracy. The goal is to help one developer avoid embarrassing review misses, not to create a compliance process.
