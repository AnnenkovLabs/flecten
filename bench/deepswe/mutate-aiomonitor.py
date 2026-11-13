"""Prepare a private DeepSWE snapshot variant with synchronized grading."""

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

TASK = "aiomonitor-task-snapshots-diff"
COMMIT = "0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea"
TESTS = '''import asyncio

import pytest

from aiomonitor import Monitor, start_monitor


@pytest.mark.asyncio
async def test_private_first_id_and_default_capacity():
    with Monitor(asyncio.get_running_loop(), console_enabled=False) as monitor:
        ids = [await monitor.capture_snapshot() for _ in range(9)]
        assert ids == list(range(41, 50))
        assert [item.id for item in monitor.list_snapshots()] == ids[-7:]


@pytest.mark.asyncio
async def test_private_start_monitor_inherits_default_capacity():
    with start_monitor(asyncio.get_running_loop(), console_enabled=False) as monitor:
        ids = [await monitor.capture_snapshot() for _ in range(8)]
        assert ids[0] == 41
        assert [item.id for item in monitor.list_snapshots()] == ids[-7:]


@pytest.mark.asyncio
async def test_private_empty_name_is_evicted_but_named_is_preserved():
    with Monitor(asyncio.get_running_loop(), max_snapshots=2, console_enabled=False) as monitor:
        empty = await monitor.capture_snapshot(name="")
        named = await monitor.capture_snapshot(name="keep")
        newest = await monitor.capture_snapshot()
        assert [item.id for item in monitor.list_snapshots()] == [named, newest]
        with pytest.raises(KeyError):
            monitor.get_snapshot(empty)


@pytest.mark.asyncio
async def test_private_whitespace_name_remains_protected():
    with Monitor(asyncio.get_running_loop(), max_snapshots=2, console_enabled=False) as monitor:
        named = await monitor.capture_snapshot(name=" ")
        old = await monitor.capture_snapshot()
        newest = await monitor.capture_snapshot()
        assert [item.id for item in monitor.list_snapshots()] == [named, newest]
        with pytest.raises(KeyError):
            monitor.get_snapshot(old)
'''


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"Expected one source anchor: {before!r}")
    return text.replace(before, after, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=Path(".liquid/benchmarks/upstream/deep-swe"))
    parser.add_argument("--output", type=Path, default=Path(".liquid/benchmarks/tasks") / TASK)
    args = parser.parse_args()
    actual = subprocess.check_output(["git", "-C", str(args.upstream), "rev-parse", "HEAD"], text=True).strip()
    if actual != COMMIT:
        raise ValueError("DeepSWE checkout differs from the pinned commit")
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite {args.output}")
    source = args.upstream / "tasks" / TASK
    shutil.copytree(source, args.output)
    instruction = (source / "instruction.md").read_text()
    instruction = replace_once(instruction, "IDs auto-increment from 1", "IDs auto-increment from 41")
    instruction = replace_once(instruction, "max_snapshots (default 10)", "max_snapshots (default 7)")
    instruction = replace_once(instruction, "evicting oldest unnamed first, preserving named.",
                               'evicting oldest unnamed first, preserving named. A snapshot is unnamed when its name is None or the empty string ""; any nonempty name, including whitespace, is protected. These defaults also apply through start_monitor.')
    (args.output / "instruction.md").write_text(instruction)
    solution = (source / "solution/solution.patch").read_text()
    for before, after in [("+        max_snapshots: int = 10,", "+        max_snapshots: int = 7,"),
                          ("+        self._snapshot_counter = 0", "+        self._snapshot_counter = 40"),
                          ("if s.name is None", 'if s.name in (None, "")')]:
        solution = replace_once(solution, before, after)
    (args.output / "solution/solution.patch").write_text(solution)
    filename = "tests/test_snapshot_mutation.py"
    patch = (source / "tests/test.patch").read_text()
    patch += (f"diff --git a/{filename} b/{filename}\nnew file mode 100644\n"
              f"--- /dev/null\n+++ b/{filename}\n@@ -0,0 +1,{len(TESTS.splitlines())} @@\n")
    patch += "".join("+" + line for line in TESTS.splitlines(keepends=True))
    (args.output / "tests/test.patch").write_text(patch)
    script = (source / "tests/test.sh").read_text()
    script = replace_once(script, "pytest tests/test_snapshot.py -v",
                           "pytest tests/test_snapshot.py tests/test_snapshot_mutation.py -v")
    (args.output / "tests/test.sh").write_text(script)
    config = json.loads((source / "tests/config.json").read_text())
    names = ["test_private_first_id_and_default_capacity",
             "test_private_start_monitor_inherits_default_capacity",
             "test_private_empty_name_is_evicted_but_named_is_preserved",
             "test_private_whitespace_name_remains_protected"]
    config["f2p_node_ids"].extend("tests.test_snapshot_mutation." + name for name in names)
    (args.output / "tests/config.json").write_text(json.dumps(config, indent=2) + "\n")
    manifest = {"variant": "aiomonitor-snapshot-identity-v1", "upstream_commit": actual,
                "upstream_repository": "https://github.com/datacurve-ai/deep-swe", "task_id": TASK,
                "changes": {"first_id": [1, 41], "default_capacity": [10, 7],
                            "unnamed": ["None", "None or empty string"]},
                "upstream_sha256": {}, "variant_sha256": {}}
    for path in sorted(p.relative_to(source) for p in source.rglob("*") if p.is_file()):
        manifest["upstream_sha256"][str(path)] = hashlib.sha256((source / path).read_bytes()).hexdigest()
        manifest["variant_sha256"][str(path)] = hashlib.sha256((args.output / path).read_bytes()).hexdigest()
    (args.output / "mutation.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"task": str(args.output), "feature_checks": len(config["f2p_node_ids"])}))


if __name__ == "__main__":
    main()
