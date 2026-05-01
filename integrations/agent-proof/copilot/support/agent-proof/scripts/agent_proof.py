#!/usr/bin/env python3
"""Generate a personal delivery evidence report for AI-assisted coding work."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


PASS_STATUSES = {"pass", "passed", "success", "successful", "ok", "green", "0"}
FAIL_STATUSES = {"fail", "failed", "error", "errored", "red", "nonzero", "non-zero"}

UI_EXTENSIONS = {".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".less"}
UI_MARKERS = {"screen", "screens", "page", "pages", "component", "components", "view", "views", "ui"}
AUTH_MARKERS = {"auth", "login", "session", "token", "oauth", "credential"}
API_MARKERS = {"api", "http", "request", "client", "fetch", "mutation", "query"}
CONFIG_NAMES = {
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "app.config.ts",
    "app.json",
    "eas.json",
    "tsconfig.json",
    "vite.config.ts",
    "webpack.config.js",
}
CONFIG_EXTENSIONS = {".env", ".toml", ".yaml", ".yml", ".config.js", ".config.ts"}
TEST_MARKERS = {"test", "tests", "__tests__", "spec"}
GENERATED_ARTIFACTS = {"verification-ledger.json", "delivery-report.md"}


def is_generated_artifact(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized in GENERATED_ARTIFACTS or normalized.startswith(".agent-proof/")


def run_git(repo: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def git_root(repo: Path) -> Path:
    root = run_git(repo, ["rev-parse", "--show-toplevel"]).strip()
    return Path(root)


def parse_status_line(line: str) -> dict[str, str]:
    code = line[:2]
    raw_path = line[3:].strip()
    path = raw_path.split(" -> ")[-1].strip()
    if code == "??":
        status = "untracked"
    elif "A" in code:
        status = "added"
    elif "D" in code:
        status = "deleted"
    elif "R" in code:
        status = "renamed"
    elif "M" in code:
        status = "modified"
    else:
        status = "changed"
    return {"status": status, "path": path}


def collect_changes(repo: Path) -> list[dict[str, str]]:
    output = run_git(repo, ["status", "--porcelain=v1"])
    changes = []
    for line in output.splitlines():
        if line.strip():
            change = parse_status_line(line)
            if not is_generated_artifact(change["path"]):
                changes.append(change)
    return changes


def path_segments(path: str) -> set[str]:
    clean = path.replace("\\", "/").lower()
    return {segment for segment in clean.split("/") if segment}


def classify_path(path: str) -> set[str]:
    lower = path.lower()
    name = Path(path).name.lower()
    suffixes = "".join(Path(path).suffixes).lower()
    suffix = Path(path).suffix.lower()
    segments = path_segments(path)
    categories: set[str] = set()

    if suffix in UI_EXTENSIONS or segments & UI_MARKERS:
        categories.add("ui")
    if segments & AUTH_MARKERS or any(marker in lower for marker in AUTH_MARKERS):
        categories.add("auth")
    if segments & API_MARKERS or any(marker in lower for marker in API_MARKERS):
        categories.add("api")
    if name in CONFIG_NAMES or suffix in CONFIG_EXTENSIONS or suffixes.endswith(".config.ts") or suffixes.endswith(".config.js"):
        categories.add("config")
    if segments & TEST_MARKERS or ".test." in lower or ".spec." in lower:
        categories.add("test")
    if lower.endswith((".md", ".mdx", ".rst")) or "docs" in segments:
        categories.add("docs")
    if not categories:
        categories.add("code")
    return categories


def summarize_categories(changes: list[dict[str, str]]) -> dict[str, list[str]]:
    categories: dict[str, list[str]] = {}
    for change in changes:
        for category in classify_path(change["path"]):
            categories.setdefault(category, []).append(change["path"])
    return categories


def infer_verification_type(entry: dict[str, Any]) -> str:
    explicit = str(entry.get("type") or entry.get("kind") or "").strip().lower()
    if explicit:
        return explicit
    command = str(entry.get("command") or entry.get("name") or "").lower()
    if any(token in command for token in ("test", "jest", "vitest", "pytest", "unittest")):
        return "test"
    if any(token in command for token in ("lint", "eslint", "ruff", "flake8")):
        return "lint"
    if any(token in command for token in ("build", "tsc", "typecheck", "expo prebuild")):
        return "build"
    if any(token in command for token in ("screenshot", "playwright", "browser", "simulator", "xcrun", "adb")):
        return "visual"
    if any(token in command for token in ("manual", "checked", "opened")):
        return "manual"
    return "other"


def normalize_verification(entry: dict[str, Any]) -> dict[str, str]:
    status = str(entry.get("status") or entry.get("result") or "").strip().lower()
    command = str(entry.get("command") or entry.get("name") or "").strip()
    return {
        "type": infer_verification_type(entry),
        "command": command or "(manual evidence)",
        "status": status or "unknown",
        "note": str(entry.get("note") or entry.get("notes") or "").strip(),
    }


def load_verifications(path: Path | None) -> list[dict[str, str]]:
    if path is None:
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        raw_entries = data
    elif isinstance(data, dict):
        raw_entries = data.get("verifications", [])
    else:
        raise ValueError("verification file must be a JSON list or an object with verifications")
    if not isinstance(raw_entries, list):
        raise ValueError("verifications must be a list")
    return [normalize_verification(entry) for entry in raw_entries if isinstance(entry, dict)]


def load_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "verifications": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"version": 1, "verifications": data}
    if isinstance(data, dict):
        data.setdefault("version", 1)
        data.setdefault("verifications", [])
        if not isinstance(data["verifications"], list):
            raise ValueError("ledger verifications must be a list")
        return data
    raise ValueError("ledger must be a JSON list or object")


def write_ledger(path: Path, ledger: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def command_text(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def record_command(command: list[str], ledger_path: Path, note: str = "", allow_failure: bool = False) -> int:
    if not command:
        raise ValueError("record requires a command after --")
    if command[0] == "--":
        command = command[1:]
    if not command:
        raise ValueError("record requires a command after --")

    started = time.monotonic()
    result = subprocess.run(command)
    duration_ms = int((time.monotonic() - started) * 1000)
    text = command_text(command)
    status = "passed" if result.returncode == 0 else "failed"
    entry = {
        "type": infer_verification_type({"command": text}),
        "command": text,
        "status": status,
        "exit_code": result.returncode,
        "duration_ms": duration_ms,
        "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "note": note,
    }
    ledger = load_ledger(ledger_path)
    ledger["verifications"].append(entry)
    write_ledger(ledger_path, ledger)
    print(f"Recorded {status} verification in {ledger_path}")
    if allow_failure:
        return 0
    return result.returncode


def has_passed(verifications: list[dict[str, str]], *types: str) -> bool:
    wanted = {item.lower() for item in types}
    for verification in verifications:
        if verification["type"].lower() in wanted and verification["status"].lower() in PASS_STATUSES:
            return True
    return False


def has_failed(verifications: list[dict[str, str]]) -> bool:
    return any(verification["status"].lower() in FAIL_STATUSES for verification in verifications)


def add_risk(risks: list[dict[str, Any]], title: str, evidence: str, severity: str, penalty: int) -> None:
    risks.append(
        {
            "title": title,
            "evidence": evidence,
            "severity": severity,
            "penalty": penalty,
        }
    )


def build_risks(
    changes: list[dict[str, str]],
    categories: dict[str, list[str]],
    claims: str,
    verifications: list[dict[str, str]],
) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    normalized_claims = claims.lower()

    if not changes:
        add_risk(risks, "No git changes detected", "git status did not report changed files.", "high", 25)

    if not verifications:
        add_risk(risks, "No verification evidence provided", "No test, lint, build, or manual check was recorded.", "high", 25)

    if has_failed(verifications):
        add_risk(risks, "Verification contains failures", "At least one recorded verification has a failed/error status.", "high", 25)

    if "ui" in categories and not has_passed(verifications, "visual", "screenshot", "manual", "browser", "simulator"):
        add_risk(
            risks,
            "UI changed without visual evidence",
            f"{len(categories['ui'])} UI-related file(s) changed, but no visual/manual verification passed.",
            "medium",
            22,
        )

    if "auth" in categories and not has_passed(verifications, "test", "e2e", "manual"):
        add_risk(
            risks,
            "Auth/session change lacks behavior verification",
            "Auth, login, token, or session files changed without passing test or manual evidence.",
            "high",
            20,
        )

    if "api" in categories and not has_passed(verifications, "test", "integration", "manual"):
        add_risk(
            risks,
            "API/data-flow change lacks failure-path evidence",
            "API or request code changed without recorded behavior verification.",
            "medium",
            16,
        )

    if "config" in categories and not has_passed(verifications, "build", "typecheck", "start", "manual"):
        add_risk(
            risks,
            "Config/dependency change lacks runtime verification",
            "Config, dependency, or environment-related files changed without build/start evidence.",
            "medium",
            16,
        )

    if any(word in normalized_claims for word in ("test", "tests pass", "tested", "测试", "验证通过")) and not has_passed(
        verifications, "test", "e2e", "integration"
    ):
        add_risk(
            risks,
            "Claims mention tests but no passing test evidence exists",
            "The completion claim references tests, but the ledger has no passing test entry.",
            "high",
            25,
        )

    if any(word in normalized_claims for word in ("complete", "done", "finished", "全部完成", "已完成")) and not verifications:
        add_risk(
            risks,
            "Completion claim has no evidence ledger",
            "The delivery claim says the work is complete, but no verification record was provided.",
            "medium",
            18,
        )

    return risks


def build_confirmed(changes: list[dict[str, str]], categories: dict[str, list[str]], verifications: list[dict[str, str]]) -> list[str]:
    confirmed = []
    confirmed.append(f"Detected {len(changes)} changed file(s) from git status.")
    if categories:
        confirmed.append("Changed categories: " + ", ".join(sorted(categories.keys())) + ".")
    passed = [item for item in verifications if item["status"].lower() in PASS_STATUSES]
    if passed:
        confirmed.append("Passing verification recorded: " + ", ".join(f"{item['type']} ({item['command']})" for item in passed) + ".")
    return confirmed


def build_suggestions(risks: list[dict[str, Any]]) -> list[str]:
    suggestions: list[str] = []
    titles = {risk["title"] for risk in risks}
    if "UI changed without visual evidence" in titles:
        suggestions.append("Capture a screenshot or record a manual visual check for the changed screen.")
    if "Auth/session change lacks behavior verification" in titles:
        suggestions.append("Run the login/session regression path and record the command or manual result.")
    if "API/data-flow change lacks failure-path evidence" in titles:
        suggestions.append("Verify success and failure paths for the changed request or data flow.")
    if "Config/dependency change lacks runtime verification" in titles:
        suggestions.append("Run a build, typecheck, or local start command after the config/dependency change.")
    if "Claims mention tests but no passing test evidence exists" in titles or "No verification evidence provided" in titles:
        suggestions.append("Add at least one passing test, lint, build, or manual verification entry before commit.")
    if not suggestions:
        suggestions.append("Review the diff once manually and keep the verification ledger with the commit notes.")
    return suggestions


def analyze_delivery(
    repo: str | Path,
    intent: str = "",
    claims: str = "",
    verifications: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    repo_path = git_root(Path(repo).resolve())
    normalized_verifications = [normalize_verification(item) for item in (verifications or [])]
    changes = collect_changes(repo_path)
    categories = summarize_categories(changes)
    risks = build_risks(changes, categories, claims, normalized_verifications)
    score = max(0, 100 - sum(int(risk["penalty"]) for risk in risks))
    if risks and not normalized_verifications:
        score = min(score, 60)
    if any(risk["severity"] == "high" for risk in risks):
        score = min(score, 75)
    decision = "Ready" if score >= 85 and not risks else "Review before commit" if score >= 60 else "Needs evidence"
    return {
        "repo": str(repo_path),
        "intent": intent.strip(),
        "claims": claims.strip(),
        "score": score,
        "decision": decision,
        "changes": changes,
        "categories": categories,
        "confirmed": build_confirmed(changes, categories, normalized_verifications),
        "risks": risks,
        "suggestions": build_suggestions(risks),
        "verifications": normalized_verifications,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Agent Proof Delivery Report",
        "",
        f"交付可信度: {report['score']}/100",
        f"判定: {report['decision']}",
        "",
        "## Scope",
        f"- Repo: `{report['repo']}`",
        f"- Intent: {report['intent'] or '(not provided)'}",
        f"- Agent claims: {report['claims'] or '(not provided)'}",
        "",
        "## 已确认",
    ]
    for item in report["confirmed"]:
        lines.append(f"- {item}")
    lines.extend(["", "## 风险"])
    if report["risks"]:
        lines.append("| Severity | Risk | Evidence |")
        lines.append("|---|---|---|")
        for risk in report["risks"]:
            lines.append(f"| {risk['severity']} | {risk['title']} | {risk['evidence']} |")
    else:
        lines.append("- No blocking delivery risks found by the local evidence check.")

    lines.extend(["", "## 建议"])
    for item in report["suggestions"]:
        lines.append(f"- {item}")

    lines.extend(["", "## 文件改动"])
    if report["changes"]:
        for change in report["changes"]:
            lines.append(f"- {change['status']}: `{change['path']}`")
    else:
        lines.append("- No changed files detected.")

    lines.extend(["", "## 验证记录"])
    if report["verifications"]:
        for item in report["verifications"]:
            note = f" - {item['note']}" if item["note"] else ""
            lines.append(f"- {item['type']}: `{item['command']}` -> {item['status']}{note}")
    else:
        lines.append("- No verification entries were provided.")

    return "\n".join(lines) + "\n"


def read_text_arg(value: str | None, file_value: str | None) -> str:
    if file_value:
        return Path(file_value).read_text(encoding="utf-8").strip()
    return value or ""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate an evidence-based AI delivery review report.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    check = subparsers.add_parser("check", help="Inspect local git changes and write a delivery report.")
    check.add_argument("--repo", default=".", help="Project repository path to inspect.")
    check.add_argument("--intent", default="", help="Original user request or delivery intent.")
    check.add_argument("--intent-file", help="File containing the original request or delivery intent.")
    check.add_argument("--claims", default="", help="Agent completion claim or final summary.")
    check.add_argument("--claims-file", help="File containing the agent completion claim.")
    check.add_argument("--verification-file", help="JSON file with a verifications list.")
    check.add_argument("--output", default="delivery-report.md", help="Markdown report output path.")
    record = subparsers.add_parser("record", help="Run a verification command and append it to a ledger.")
    record.add_argument("--ledger", default="verification-ledger.json", help="Verification ledger output path.")
    record.add_argument("--note", default="", help="Optional note to attach to the verification entry.")
    record.add_argument("--allow-failure", action="store_true", help="Record failed commands but exit 0.")
    record.add_argument("record_command", nargs=argparse.REMAINDER, help="Command to run, usually after --.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "check":
        intent = read_text_arg(args.intent, args.intent_file)
        claims = read_text_arg(args.claims, args.claims_file)
        verifications = load_verifications(Path(args.verification_file)) if args.verification_file else []
        report = analyze_delivery(args.repo, intent=intent, claims=claims, verifications=verifications)
        output = Path(args.output)
        write_text(output, render_markdown(report))
        print(f"Wrote {output} (score {report['score']}/100, {report['decision']})")
        return 0
    if args.command == "record":
        return record_command(args.record_command, Path(args.ledger), note=args.note, allow_failure=args.allow_failure)
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"agent-proof: {exc}", file=sys.stderr)
        raise SystemExit(1)
