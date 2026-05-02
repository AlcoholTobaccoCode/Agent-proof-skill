#!/usr/bin/env python3
"""Generate a personal delivery evidence report for AI-assisted coding work."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import locale
import os
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
RISK_KEYS = {
    "No git changes detected": "no_changes",
    "No verification evidence provided": "no_verification",
    "Verification contains failures": "verification_failed",
    "UI changed without visual evidence": "ui_no_visual",
    "Auth/session change lacks behavior verification": "auth_no_behavior",
    "API/data-flow change lacks failure-path evidence": "api_no_behavior",
    "Config/dependency change lacks runtime verification": "config_no_runtime",
    "Claims mention tests but no passing test evidence exists": "claims_tests_no_evidence",
    "Completion claim has no evidence ledger": "complete_no_ledger",
}


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


def localize_record_status(status: str, language: str) -> str:
    if language != "zh":
        return status
    return {
        "passed": "通过",
        "failed": "失败",
    }.get(status, status)


def record_command(command: list[str], ledger_path: Path, note: str = "", allow_failure: bool = False, language: str = "auto") -> int:
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
    output_language = resolve_report_language(language)
    if output_language == "zh":
        print(f"已记录{localize_record_status(status, output_language)}验证到 {ledger_path}")
    else:
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


def normalize_locale_value(value: str | None) -> str:
    return str(value or "").strip().split(".")[0].split("@")[0].replace("_", "-").lower()


def language_from_value(value: str | None) -> str:
    locale_value = normalize_locale_value(value)
    if not locale_value or locale_value in {"c", "posix"}:
        return ""
    if locale_value in {"zh", "cn", "chinese", "中文"} or locale_value.startswith("zh-"):
        return "zh"
    if locale_value in {"en", "english"} or locale_value.startswith("en-"):
        return "en"
    return ""


def detect_report_language(env: dict[str, str] | None = None) -> str:
    current_env = os.environ if env is None else env
    env_locale = next(
        (item for item in [current_env.get("LC_ALL"), current_env.get("LC_MESSAGES"), current_env.get("LANG")] if str(item or "").strip()),
        None,
    )
    if env_locale:
        return language_from_value(env_locale) or "zh"
    locale_name = locale.getlocale()[0]
    return language_from_value(locale_name) or "zh"


def resolve_report_language(language: str | None = None, env: dict[str, str] | None = None) -> str:
    explicit = str(language or "").strip()
    if not explicit or explicit.lower() == "auto":
        return detect_report_language(env)
    return language_from_value(explicit) or "zh"


def localize_decision(decision: str, language: str) -> str:
    if language != "zh":
        return decision
    return {
        "Ready": "可提交",
        "Review before commit": "提交前复核",
        "Needs evidence": "证据不足",
    }.get(decision, decision)


def localize_category(category: str, language: str) -> str:
    if language != "zh":
        return category
    return {
        "api": "API",
        "auth": "登录/会话",
        "code": "代码",
        "config": "配置",
        "docs": "文档",
        "test": "测试",
        "ui": "UI",
    }.get(category, category)


def localize_change_status(status: str, language: str) -> str:
    if language != "zh":
        return status
    return {
        "added": "新增",
        "changed": "变更",
        "deleted": "删除",
        "modified": "修改",
        "renamed": "重命名",
        "untracked": "未跟踪",
    }.get(status, status)


def localize_verification_status(status: str, language: str) -> str:
    if language != "zh":
        return status
    return {
        "passed": "通过",
        "pass": "通过",
        "success": "通过",
        "successful": "通过",
        "failed": "失败",
        "fail": "失败",
        "error": "错误",
        "errored": "错误",
        "unknown": "未知",
    }.get(status, status)


def localize_severity(severity: str, language: str) -> str:
    if language != "zh":
        return severity
    return {"high": "高", "medium": "中", "low": "低"}.get(severity, severity)


def risk_key(risk: dict[str, Any]) -> str:
    return str(risk.get("key") or RISK_KEYS.get(str(risk.get("title") or ""), ""))


def localize_risk_title(risk: dict[str, Any], language: str) -> str:
    if language != "zh":
        return str(risk["title"])
    return {
        "no_changes": "未检测到 git 改动",
        "no_verification": "缺少验证证据",
        "verification_failed": "验证记录包含失败",
        "ui_no_visual": "UI 改动缺少视觉证据",
        "auth_no_behavior": "登录/会话改动缺少行为验证",
        "api_no_behavior": "API/数据流改动缺少行为验证",
        "config_no_runtime": "配置/依赖改动缺少运行验证",
        "claims_tests_no_evidence": "声称已测试但缺少通过记录",
        "complete_no_ledger": "完成声明缺少证据 ledger",
    }.get(risk_key(risk), str(risk["title"]))


def localize_risk_evidence(risk: dict[str, Any], language: str) -> str:
    if language != "zh":
        return str(risk["evidence"])
    key = risk_key(risk)
    if key == "no_changes":
        return "`git status` 没有报告改动文件。"
    if key == "no_verification":
        return "没有记录测试、lint、构建或人工检查。"
    if key == "verification_failed":
        return "至少一条验证记录是 failed/error 状态。"
    if key == "ui_no_visual":
        digits = "".join(ch for ch in str(risk["evidence"]) if ch.isdigit())
        count = digits or "若干"
        return f"{count} 个 UI 相关文件有改动，但没有通过截图、浏览器、模拟器或人工视觉检查。"
    if key == "auth_no_behavior":
        return "登录、token、会话相关文件有改动，但没有通过测试或人工验证。"
    if key == "api_no_behavior":
        return "API 或请求代码有改动，但没有记录成功/失败路径验证。"
    if key == "config_no_runtime":
        return "配置、依赖或环境文件有改动，但没有构建、类型检查或启动证据。"
    if key == "claims_tests_no_evidence":
        return "完成说明提到了测试，但 ledger 中没有通过的测试记录。"
    if key == "complete_no_ledger":
        return "声称已完成，但没有提供验证记录。"
    return str(risk["evidence"])


def localized_confirmed(report: dict[str, Any], language: str) -> list[str]:
    if language != "zh":
        return list(report["confirmed"])
    confirmed = [f"从 git status 检测到 {len(report['changes'])} 个改动文件。"]
    category_names = sorted(report["categories"].keys())
    if category_names:
        confirmed.append("改动分类：" + "、".join(localize_category(item, language) for item in category_names) + "。")
    passed = [item for item in report["verifications"] if item["status"].lower() in PASS_STATUSES]
    if passed:
        confirmed.append("已记录通过的验证：" + "、".join(f"{item['type']} ({item['command']})" for item in passed) + "。")
    return confirmed


def localized_suggestions(report: dict[str, Any], language: str) -> list[str]:
    if language != "zh":
        return list(report["suggestions"])
    keys = {risk_key(risk) for risk in report["risks"]}
    suggestions: list[str] = []
    if "ui_no_visual" in keys:
        suggestions.append("给改动页面补一张截图，或记录一次人工视觉检查。")
    if "auth_no_behavior" in keys:
        suggestions.append("跑一遍登录/会话回归路径，并记录命令或人工结果。")
    if "api_no_behavior" in keys:
        suggestions.append("验证这条请求或数据流的成功路径和失败路径。")
    if "config_no_runtime" in keys:
        suggestions.append("配置或依赖改动后，至少跑一次构建、类型检查或本地启动。")
    if "claims_tests_no_evidence" in keys or "no_verification" in keys:
        suggestions.append("提交前补一条通过的测试、lint、构建或人工验证记录。")
    if not suggestions:
        suggestions.append("手动复核一次 diff，并把验证 ledger 放进提交说明或交付记录。")
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


def render_markdown(report: dict[str, Any], language: str = "auto") -> str:
    report_language = resolve_report_language(language)
    if report_language == "en":
        return render_english_markdown(report)
    return render_chinese_markdown(report)


def render_english_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Agent Proof Delivery Report",
        "",
        f"Delivery confidence: {report['score']}/100",
        f"Decision: {report['decision']}",
        "",
        "## Scope",
        f"- Repo: `{report['repo']}`",
        f"- Intent: {report['intent'] or '(not provided)'}",
        f"- Agent claims: {report['claims'] or '(not provided)'}",
        "",
        "## Confirmed",
    ]
    for item in report["confirmed"]:
        lines.append(f"- {item}")
    lines.extend(["", "## Risks"])
    if report["risks"]:
        lines.append("| Severity | Risk | Evidence |")
        lines.append("|---|---|---|")
        for risk in report["risks"]:
            lines.append(f"| {risk['severity']} | {risk['title']} | {risk['evidence']} |")
    else:
        lines.append("- No blocking delivery risks found by the local evidence check.")

    lines.extend(["", "## Suggestions"])
    for item in report["suggestions"]:
        lines.append(f"- {item}")

    lines.extend(["", "## File Changes"])
    if report["changes"]:
        for change in report["changes"]:
            lines.append(f"- {change['status']}: `{change['path']}`")
    else:
        lines.append("- No changed files detected.")

    lines.extend(["", "## Verification Records"])
    if report["verifications"]:
        for item in report["verifications"]:
            note = f" - {item['note']}" if item["note"] else ""
            lines.append(f"- {item['type']}: `{item['command']}` -> {item['status']}{note}")
    else:
        lines.append("- No verification entries were provided.")

    return "\n".join(lines) + "\n"


def render_chinese_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Agent Proof 交付验收报告",
        "",
        f"交付可信度: {report['score']}/100",
        f"判定: {localize_decision(report['decision'], 'zh')}",
        "",
        "## 范围",
        f"- 仓库: `{report['repo']}`",
        f"- 目标: {report['intent'] or '（未提供）'}",
        f"- Agent 声称: {report['claims'] or '（未提供）'}",
        "",
        "## 已确认",
    ]
    for item in localized_confirmed(report, "zh"):
        lines.append(f"- {item}")
    lines.extend(["", "## 风险"])
    if report["risks"]:
        lines.append("| 严重级别 | 风险 | 证据 |")
        lines.append("|---|---|---|")
        for risk in report["risks"]:
            lines.append(
                f"| {localize_severity(risk['severity'], 'zh')} | {localize_risk_title(risk, 'zh')} | {localize_risk_evidence(risk, 'zh')} |"
            )
    else:
        lines.append("- 本地证据检查没有发现阻塞性交付风险。")

    lines.extend(["", "## 建议"])
    for item in localized_suggestions(report, "zh"):
        lines.append(f"- {item}")

    lines.extend(["", "## 文件改动"])
    if report["changes"]:
        for change in report["changes"]:
            lines.append(f"- {localize_change_status(change['status'], 'zh')}: `{change['path']}`")
    else:
        lines.append("- 未检测到改动文件。")

    lines.extend(["", "## 验证记录"])
    if report["verifications"]:
        for item in report["verifications"]:
            note = f" - {item['note']}" if item["note"] else ""
            lines.append(f"- {item['type']}: `{item['command']}` -> {localize_verification_status(item['status'], 'zh')}{note}")
    else:
        lines.append("- 未提供验证记录。")

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
    check.add_argument("--language", default="auto", help="Report language: auto, zh, or en. Defaults to system locale.")
    record = subparsers.add_parser("record", help="Run a verification command and append it to a ledger.")
    record.add_argument("--ledger", default="verification-ledger.json", help="Verification ledger output path.")
    record.add_argument("--note", default="", help="Optional note to attach to the verification entry.")
    record.add_argument("--language", default="auto", help="Output language: auto, zh, or en. Defaults to system locale.")
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
        language = resolve_report_language(args.language)
        write_text(output, render_markdown(report, language))
        if language == "zh":
            print(f"已写入 {output}（评分 {report['score']}/100，{localize_decision(report['decision'], language)}）")
        else:
            print(f"Wrote {output} (score {report['score']}/100, {report['decision']})")
        return 0
    if args.command == "record":
        return record_command(args.record_command, Path(args.ledger), note=args.note, allow_failure=args.allow_failure, language=args.language)
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"agent-proof: {exc}", file=sys.stderr)
        raise SystemExit(1)
