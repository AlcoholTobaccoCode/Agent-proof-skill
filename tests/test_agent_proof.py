import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT_PATH = SKILL_DIR / "scripts" / "agent_proof.py"


def load_agent_proof():
    spec = importlib.util.spec_from_file_location("agent_proof", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    run(["git", "init"], repo)
    run(["git", "config", "user.email", "agent-proof@example.test"], repo)
    run(["git", "config", "user.name", "Agent Proof"], repo)
    (repo / "src" / "screens").mkdir(parents=True)
    (repo / "src" / "screens" / "Home.tsx").write_text(
        "export function Home() { return null; }\n",
        encoding="utf-8",
    )
    run(["git", "add", "."], repo)
    run(["git", "commit", "-m", "initial"], repo)
    return repo


class AgentProofTests(unittest.TestCase):
    def test_ui_change_without_visual_verification_is_flagged(self):
        agent_proof = load_agent_proof()
        with tempfile.TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / "src" / "screens" / "Home.tsx").write_text(
                "export function Home() { return <Button title=\"Save\" />; }\n",
                encoding="utf-8",
            )

            report = agent_proof.analyze_delivery(
                repo=repo,
                intent="Polish the home screen UI before commit",
                claims="Home screen polish is complete",
                verifications=[{"type": "test", "command": "npm test", "status": "passed"}],
            )

        self.assertLess(report["score"], 80)
        self.assertTrue(any("UI" in risk["title"] for risk in report["risks"]))
        self.assertTrue(any("visual" in action.lower() or "screenshot" in action.lower() for action in report["suggestions"]))

    def test_claimed_tests_without_test_evidence_is_flagged(self):
        agent_proof = load_agent_proof()
        with tempfile.TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / "src" / "auth").mkdir(parents=True)
            (repo / "src" / "auth" / "session.ts").write_text(
                "export const persistSession = () => true;\n",
                encoding="utf-8",
            )

            report = agent_proof.analyze_delivery(
                repo=repo,
                intent="Fix login persistence",
                claims="Login persistence is complete and tests pass",
                verifications=[],
            )

        self.assertLessEqual(report["score"], 60)
        self.assertTrue(any("test" in risk["title"].lower() for risk in report["risks"]))

    def test_cli_writes_markdown_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = make_repo(tmp_path)
            (repo / "src" / "screens" / "Home.tsx").write_text(
                "export function Home() { return <Text>Done</Text>; }\n",
                encoding="utf-8",
            )
            ledger = tmp_path / "ledger.json"
            ledger.write_text(
                json.dumps({"verifications": [{"type": "lint", "command": "npm run lint", "status": "passed"}]}),
                encoding="utf-8",
            )
            output = tmp_path / "delivery-report.md"

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT_PATH),
                    "check",
                    "--repo",
                    str(repo),
                    "--intent",
                    "Polish home UI",
                    "--claims",
                    "UI is complete",
                    "--verification-file",
                    str(ledger),
                    "--output",
                    str(output),
                ],
                check=True,
                text=True,
                capture_output=True,
            )

            self.assertTrue(output.exists())
            text = output.read_text(encoding="utf-8")
            self.assertIn("交付可信度", text)
            self.assertIn("风险", text)
            self.assertIn(str(output), result.stdout)

    def test_record_command_generates_ledger_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            ledger = tmp_path / "verification-ledger.json"

            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT_PATH),
                    "record",
                    "--ledger",
                    str(ledger),
                    "--",
                    "python3",
                    "-c",
                    "raise SystemExit(0)",
                ],
                check=True,
                text=True,
                capture_output=True,
            )

            data = json.loads(ledger.read_text(encoding="utf-8"))
            self.assertEqual(len(data["verifications"]), 1)
            self.assertEqual(data["verifications"][0]["status"], "passed")
            self.assertEqual(data["verifications"][0]["exit_code"], 0)
            self.assertIn("python3 -c", data["verifications"][0]["command"])
            self.assertIn(str(ledger), result.stdout)


if __name__ == "__main__":
    unittest.main()
