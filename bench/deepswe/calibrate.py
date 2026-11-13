"""Check a mutated task against its oracle, original oracle, and empty patch."""

import argparse
import hashlib
import json
import subprocess
import time
import tomllib
from pathlib import Path


def command(arguments, output, timeout=300):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    output.write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f"Container command failed; inspect {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", type=Path)
    parser.add_argument("--upstream", type=Path, default=Path(".liquid/benchmarks/upstream/deep-swe"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    original = args.upstream.resolve() / "tasks" / task.name
    config = tomllib.loads((task / "task.toml").read_text())
    image = config["environment"]["docker_image"]
    base = config["metadata"]["base_commit_hash"]
    if not isinstance(image, str) or not isinstance(base, str) or len(base) != 40:
        raise ValueError("Invalid task image or base commit")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    inspection = subprocess.check_output(["docker", "image", "inspect", image], text=True)
    image_info = json.loads(inspection)[0]
    cases = []
    for name in ("mutated-oracle", "original-oracle", "no-op"):
        started = time.monotonic()
        folder = output / name
        artifacts = folder / "artifacts"
        artifacts.mkdir(parents=True)
        verifier = folder / "verifier"
        verifier.mkdir()
        commands = []
        if name == "no-op":
            (artifacts / "model.patch").write_text("")
        else:
            solution = (task if name == "mutated-oracle" else original) / "solution"
            shell = ("set -eu; cd /app; git config --global --add safe.directory /app; "
                     "git apply --check /solution/solution.patch; bash /solution/solve.sh; "
                     f"git diff --binary {base} HEAD > /logs/artifacts/model.patch")
            arguments = ["docker", "run", "--rm", "--network", "none", "--cpus", "2",
                         "--memory", "8g", "-v", f"{solution}:/solution:ro", "-v",
                         f"{artifacts}:/logs/artifacts", image, "/bin/bash", "-lc", shell]
            commands.append(arguments)
            command(arguments, folder / "oracle.log")
        arguments = ["docker", "run", "--rm", "--network", "none", "--cpus", "2",
                     "--memory", "8g", "-v", f"{task / 'tests'}:/tests:ro", "-v",
                     f"{artifacts}:/logs/artifacts:ro", "-v", f"{verifier}:/logs/verifier",
                     image, "/bin/bash", "/tests/test.sh"]
        commands.append(arguments)
        command(arguments, folder / "verifier.log")
        (folder / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        reward = json.loads((verifier / "reward.json").read_text())
        if not isinstance(reward, dict) or reward.get("reward") not in (0, 1):
            raise ValueError("Verifier did not return a binary reward")
        case = {"case": name, "reward": reward, "wallClockMs": round((time.monotonic() - started) * 1000),
                "model_patch_sha256": hashlib.sha256((artifacts / "model.patch").read_bytes()).hexdigest()}
        cases.append(case)
        (folder / "summary.json").write_text(json.dumps(case, indent=2) + "\n")
        print(json.dumps(case), flush=True)
    report = {"task": str(task), "image": image, "image_id": image_info["Id"],
              "image_digests": image_info["RepoDigests"], "cases": cases}
    (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    if [case["reward"]["reward"] for case in cases] != [1, 0, 0]:
        raise RuntimeError(f"Task calibration failed; inspect {output / 'summary.json'}")


if __name__ == "__main__":
    main()
