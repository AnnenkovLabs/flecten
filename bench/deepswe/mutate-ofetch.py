"""Author the private ofetch variant from a pinned DeepSWE checkout."""

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

TASK = "ofetch-per-origin-circuit-breaker"
UPSTREAM_COMMIT = "0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea"
VARIANT = "ofetch-fractional-cooldown-v1"


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one exact source anchor: {old!r}")
    return text.replace(old, new, 1)


def test_block(text, title):
    start = text.index(f'  it("{title}", async () => {{')
    end = text.index('\n  it("', start + 1)
    return text[start:end]


FRACTIONAL_TESTS = '''  async function checkFractionalCooldown(
    circuitBreaker: true | { threshold: number; cooldown: number; halfOpenMaxRequests: number },
    threshold: number,
    cooldown: number
  ) {
    const clock = vi.spyOn(Date, "now").mockReturnValue(8192.25);
    try {
      const mockFetch = vi.fn(() => Promise.resolve(jsonResponse(500, '{"error":true}')));
      const guardedFetch = createFetch({ fetch: mockFetch });
      const options = { retry: 0, circuitBreaker };
      for (let attempt = 0; attempt < threshold; attempt++) {
        await guardedFetch(`https://fractional-clock.example/fail-${attempt}`, options).catch(() => {});
      }
      for (const elapsed of [cooldown - 0.25, cooldown]) {
        clock.mockReturnValue(8192.25 + elapsed);
        await expectOpenCircuitRejection(guardedFetch("https://fractional-clock.example/blocked", options));
        expect(mockFetch).toHaveBeenCalledTimes(threshold);
      }
      clock.mockReturnValue(8192.25 + cooldown + 0.25);
      mockFetch.mockResolvedValueOnce(jsonResponse(200, '"ok"'));
      await expect(guardedFetch("https://fractional-clock.example/probe", options)).resolves.toBe("ok");
      expect(mockFetch).toHaveBeenCalledTimes(threshold + 1);
    } finally {
      clock.mockRestore();
    }
  }

  it("uses default cooldown=1250.5 when circuitBreaker is true", async () => {
    await checkFractionalCooldown(true, 3, 1250.5);
  });

  it("private mutation preserves configured fractional cooldown and rejects equality", async () => {
    await checkFractionalCooldown({ threshold: 1, cooldown: 2.25, halfOpenMaxRequests: 1 }, 1, 2.25);
  });

'''

QUOTA_TEST = '''  it("uses default halfOpenMaxRequests=2 when circuitBreaker is true", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(16384.25);
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse(500, '{"error":true}')));
    const guardedFetch = createFetch({ fetch: mockFetch });
    const options = { retry: 0, circuitBreaker: true as const };
    const probes: Promise<unknown>[] = [];
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await guardedFetch(`https://default-half-open.example/fail-${attempt}`, options).catch(() => {});
      }
      await expectOpenCircuitRejection(guardedFetch("https://default-half-open.example/blocked", options));
      expect(mockFetch).toHaveBeenCalledTimes(3);
      mockFetch.mockImplementation(() => pending.then(() => jsonResponse(200, '"ok"')));
      clock.mockReturnValue(16384.25 + 1250.75);
      probes.push(guardedFetch("https://default-half-open.example/probe-1", options));
      probes.push(guardedFetch("https://default-half-open.example/probe-2", options));
      await expectOpenCircuitRejection(guardedFetch("https://default-half-open.example/probe-3", options));
      expect(mockFetch).toHaveBeenCalledTimes(5);
      release?.();
      await expect(Promise.all(probes)).resolves.toEqual(["ok", "ok"]);
    } finally {
      release?.();
      await Promise.allSettled(probes);
      clock.mockRestore();
    }
  });

'''


def mutate_instruction(text):
    for old, new in [("threshold = 5", "threshold = 3"),
                     ("cooldown = 30000", "cooldown = 1250.5"),
                     ("halfOpenMaxRequests = 1", "halfOpenMaxRequests = 2")]:
        text = replace_once(text, old, new)
    text = replace_once(text, "`open` -> `half-open` after `cooldown`",
                        "`open` -> `half-open` only when elapsed time is strictly greater than `cooldown`; equality remains blocked")
    return replace_once(text, "Use `Date.now()` for cooldown and half-open gating so fake timers work deterministically.",
                        "Use `Date.now()` for cooldown and half-open gating so fake timers work deterministically. Preserve fractional millisecond values in both the clock and cooldown without rounding or truncation. These defaults apply to `true` and omitted object fields; explicit per-request values override them. The strict equality boundary applies to configured cooldowns too.")


def mutate_solution(text):
    for old, new in [("@default 5", "@default 3"),
                     ("@default 30000", "@default 1250.5"),
                     ("@default 1\n", "@default 2\n"),
                     ("resolved.threshold ?? 5", "resolved.threshold ?? 3"),
                     ("resolved.cooldown ?? 30_000", "resolved.cooldown ?? 1250.5"),
                     ("resolved.halfOpenMaxRequests ?? 1", "resolved.halfOpenMaxRequests ?? 2"),
                     ("if (now < retryAt)", "if (now <= retryAt)")]:
        text = replace_once(text, old, new)
    return text


def mutate_tests(patch):
    marker = "diff --git a/test/circuit-breaker.test.ts b/test/circuit-breaker.test.ts\n"
    prefix, section = patch.split(marker)
    header, additions = section.split("@@ -0,0 +1,1707 @@\n")
    lines = additions.splitlines(keepends=True)
    if not all(line.startswith("+") for line in lines):
        raise ValueError("Expected an entirely new upstream test file")
    text = "".join(line[1:] for line in lines)
    for title in ["applies default circuitBreaker values when set to true",
                  "uses full default failureStatusCodes when circuitBreaker is true"]:
        old = test_block(text, title)
        text = replace_once(text, old, old.replace("attempt < 5", "attempt < 3").replace("CalledTimes(5)", "CalledTimes(3)"))
    text = replace_once(text, test_block(text, "uses default cooldown=30000 when circuitBreaker is true"), FRACTIONAL_TESTS)
    text = replace_once(text, test_block(text, "uses default halfOpenMaxRequests=1 when circuitBreaker is true"), QUOTA_TEST)
    blob = hashlib.sha1(f"blob {len(text.encode())}\0".encode() + text.encode()).hexdigest()
    header = replace_once(header, "index 0000000..125718c", f"index 0000000..{blob[:7]}")
    return prefix + marker + header + f"@@ -0,0 +1,{len(text.splitlines())} @@\n" + "".join("+" + line for line in text.splitlines(keepends=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=Path(".liquid/benchmarks/upstream/deep-swe"))
    parser.add_argument("--output", type=Path, default=Path(".liquid/benchmarks/tasks") / TASK)
    args = parser.parse_args()
    actual = subprocess.check_output(["git", "-C", str(args.upstream), "rev-parse", "HEAD"], text=True).strip()
    if actual != UPSTREAM_COMMIT:
        raise ValueError(f"Expected pinned upstream {UPSTREAM_COMMIT}, got {actual}")
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite {args.output}")
    source = args.upstream / "tasks" / TASK
    shutil.copytree(source, args.output)
    transformations = {"instruction.md": mutate_instruction, "solution/solution.patch": mutate_solution,
                       "tests/test.patch": mutate_tests}
    for path, transform in transformations.items():
        (args.output / path).write_text(transform((source / path).read_text()))
    config_path = args.output / "tests/config.json"
    config = json.loads(config_path.read_text())
    if not isinstance(config.get("f2p_node_ids"), list):
        raise ValueError("Expected DeepSWE exact failure-to-pass node IDs")
    config["f2p_node_ids"] = [name.replace("cooldown=30000", "cooldown=1250.5").replace("halfOpenMaxRequests=1", "halfOpenMaxRequests=2") for name in config["f2p_node_ids"]]
    config["f2p_node_ids"].append("test/circuit-breaker.test.ts: ofetch circuit breaker > private mutation preserves configured fractional cooldown and rejects equality")
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    manifest = {"variant": VARIANT, "upstream_repository": "https://github.com/datacurve-ai/deep-swe",
                "upstream_commit": actual, "task_id": TASK,
                "changes": {"threshold": [5, 3], "cooldown": [30000, 1250.5],
                            "halfOpenMaxRequests": [1, 2], "half_open_boundary": [">= cooldown", "> cooldown"]},
                "upstream_sha256": {}, "variant_sha256": {}}
    for path in sorted(p.relative_to(source) for p in source.rglob("*") if p.is_file()):
        manifest["upstream_sha256"][str(path)] = hashlib.sha256((source / path).read_bytes()).hexdigest()
        manifest["variant_sha256"][str(path)] = hashlib.sha256((args.output / path).read_bytes()).hexdigest()
    (args.output / "mutation.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"task": str(args.output), "variant": VARIANT, "feature_checks": len(config["f2p_node_ids"])}))


if __name__ == "__main__":
    main()
