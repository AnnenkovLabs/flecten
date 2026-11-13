"""Pier adapter for the compiled production Flecten sidecar."""

import hashlib
import json
import shlex
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values
from pier.agents.base import BaseAgent
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.network import NetworkAllowlist
from pydantic import BaseModel, ConfigDict, Field


ROOT = Path(__file__).resolve().parents[2]
PRIVATE_ENV = ROOT / ".liquid/benchmarks/private/provider.env"
INSTALL_DIR = "/opt/flecten"


class Connection(BaseModel):
    model_config = ConfigDict(extra="ignore")
    BENCH_API_KEY: str = Field(min_length=1, repr=False)
    BENCH_BASE_URL: str = Field(min_length=1)

    def domain(self) -> str:
        url = urlsplit(self.BENCH_BASE_URL)
        if url.scheme not in {"https", "http"} or not url.hostname or url.username:
            raise ValueError("BENCH_BASE_URL must be an HTTP(S) URL without credentials")
        return url.hostname


class FlectenAgent(BaseAgent):
    def __init__(self, *args, timeout_sec=3600, reasoning="high", runtime_dir=None, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.model_name or not self.model_name.strip():
            raise ValueError("Pier must supply the fixed model_name for this attempt")
        if not isinstance(timeout_sec, int) or timeout_sec < 1:
            raise ValueError("timeout_sec must be a positive integer")
        if reasoning not in {"minimal", "low", "medium", "high", "xhigh", "max"}:
            raise ValueError("Unsupported reasoning effort")
        # Validation errors must never include the input containing a credential.
        raw = dotenv_values(PRIVATE_ENV)
        try:
            self.connection = Connection.model_validate(raw)
            self.connection.domain()
        except ValueError:
            raise ValueError("Invalid or missing private benchmark provider settings") from None
        self.timeout_sec = timeout_sec
        self.reasoning = reasoning
        self.runtime_dir = Path(runtime_dir).resolve() if runtime_dir else ROOT / "dist"

    @staticmethod
    def name() -> str:
        return "flecten"

    def version(self) -> str:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        )
        return result.stdout.strip()

    def network_allowlist(self) -> NetworkAllowlist:
        return NetworkAllowlist(domains=[self.connection.domain()])

    async def setup(self, environment: BaseEnvironment) -> None:
        for source in (self.runtime_dir / "flecten-agent", self.runtime_dir / "prompts/base.md"):
            if not source.is_file():
                raise RuntimeError("Build the production agent before running DeepSWE")
        prepared = await environment.exec(
            f"mkdir -p {INSTALL_DIR}/prompts /logs/agent && chmod 777 /logs/agent",
            user="root", timeout_sec=30,
        )
        if prepared.return_code:
            raise RuntimeError("Could not prepare Flecten installation directory")
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        files = [self.runtime_dir / "flecten-agent", *sorted((self.runtime_dir / "prompts").rglob("*.md"))]
        hashes = {str(path.relative_to(self.runtime_dir)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in files}
        (self.logs_dir / "agent-build.json").write_text(json.dumps(hashes, indent=2) + "\n")
        await environment.upload_file(self.runtime_dir / "flecten-agent", f"{INSTALL_DIR}/flecten-agent")
        await environment.upload_dir(self.runtime_dir / "prompts", f"{INSTALL_DIR}/prompts")
        await environment.upload_file(Path(__file__).with_name("sidecar_runner.py"),
                                      f"{INSTALL_DIR}/sidecar_runner.py")
        installed = await environment.exec(
            f"chmod -R a+rX {INSTALL_DIR} && chmod a+rx {INSTALL_DIR}/flecten-agent && python3 --version",
            user="root", timeout_sec=30,
        )
        if installed.return_code:
            raise RuntimeError("The task image needs Python 3 and a compatible Linux runtime")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not isinstance(instruction, str) or not instruction.strip():
            raise ValueError("Task instruction must be nonempty text")
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="flecten-pier-") as directory:
            task_input = Path(directory) / "instruction.md"
            task_input.write_text(instruction)
            await environment.upload_file(task_input, f"{INSTALL_DIR}/instruction.md")
        command = shlex.join([
            "python3", f"{INSTALL_DIR}/sidecar_runner.py", "--instruction",
            f"{INSTALL_DIR}/instruction.md", "--model", self.model_name,
            "--reasoning", self.reasoning, "--timeout", str(self.timeout_sec),
        ])
        result = await environment.exec(
            command, timeout_sec=self.timeout_sec + 90,
            env=environment.agent_process_env({
                "BENCH_API_KEY": self.connection.BENCH_API_KEY,
                "BENCH_BASE_URL": self.connection.BENCH_BASE_URL,
            }),
        )
        with tempfile.TemporaryDirectory(prefix="flecten-result-") as directory:
            summary = Path(directory) / "run-result.json"
            await environment.download_file("/logs/agent/run-result.json", summary)
            data = json.loads(summary.read_text())
        if not isinstance(data, dict) or not isinstance(data.get("usage"), dict):
            raise RuntimeError("Flecten returned an invalid run result")
        usage = data["usage"]
        for source, target in (("input", "n_input_tokens"), ("output", "n_output_tokens"),
                               ("cached", "n_cache_tokens")):
            value = usage.get(source)
            if isinstance(value, int) and value >= 0:
                setattr(context, target, value)
        context.n_agent_steps = data.get("turns")
        context.peak_context_tokens = data.get("peakContextTokens")
        context.summarization_count = data.get("compactions")
        context.cost_usd = data.get("costUsd")
        context.metadata = data
        if result.return_code:
            raise RuntimeError(f"Flecten failed: {data.get('error') or data.get('stopReason')}")
