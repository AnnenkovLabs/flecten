"""Summarize saved Pier results without invoking models or modifying tasks."""

import argparse
import json
import math
import statistics
from pathlib import Path


def wilson(passed, total):
    if not total:
        return None
    z = 1.959963984540054
    proportion = passed / total
    scale = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / scale
    radius = z * math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / scale
    return [max(0, center - radius), min(1, center + radius)]


def load_trial(path):
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or not isinstance(data.get("task_name"), str):
        raise ValueError(f"Invalid Pier result: {path}")
    agent = data.get("agent_result") or {}
    metadata = agent.get("metadata") or {}
    verifier = data.get("verifier_result") or {}
    rewards = verifier.get("rewards") or {}
    reward_path = path.parent / "verifier/reward.json"
    if reward_path.exists():
        rewards = json.loads(reward_path.read_text())
    value = rewards.get("reward")
    if value is not None and value not in (0, 1):
        raise ValueError(f"Invalid binary reward: {reward_path}")
    exception = data.get("exception_info") or {}
    interruption_path = path.parent.parent / "interruption.json"
    interruption = json.loads(interruption_path.read_text()) if interruption_path.exists() else None
    return {
        "job": path.parent.parent.name, "task": data["task_name"],
        "trial": data.get("trial_name"), "path": str(path.parent.resolve()),
        "model": (data.get("agent_info") or {}).get("model_info"),
        "reward": value, "checks": rewards,
        "exception": exception.get("exception_type"),
        "exception_message": exception.get("exception_message"),
        "turns": metadata.get("turns", agent.get("n_agent_steps")),
        "input_tokens": agent.get("n_input_tokens"), "output_tokens": agent.get("n_output_tokens"),
        "cached_tokens": agent.get("n_cache_tokens"),
        "wallClockMs": metadata.get("wallClockMs"),
        "tool_calls": metadata.get("toolCalls"), "tool_failures": metadata.get("toolFailures"),
        "provider_retries": metadata.get("providerRetries"),
        "compactions": metadata.get("compactions"), "stop_reason": metadata.get("stopReason"),
        "system_prompt_hash": (metadata.get("system") or {}).get("hash"),
        "interruption": interruption,
        "cost_usd": None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = [load_trial(path) for path in sorted(args.jobs.glob("*/*/result.json"))]
    if not rows:
        raise ValueError("No completed Pier trials found")
    scored = [row for row in rows if row["reward"] is not None]
    passed = sum(row["reward"] == 1 for row in rows)
    times = [row["wallClockMs"] for row in scored if row["wallClockMs"] is not None]
    report = {"phase": "pilot", "attempts": len(rows), "scored_attempts": len(scored),
              "passed": passed, "unscored_attempts": len(rows) - len(scored),
              "all_attempts_success_ci95_wilson": wilson(passed, len(rows)),
              "scored_attempts_success_ci95_wilson": wilson(passed, len(scored)),
              "input_tokens": sum(row["input_tokens"] or 0 for row in rows),
              "output_tokens": sum(row["output_tokens"] or 0 for row in rows),
              "p50_wall_clock_ms": statistics.median(times) if times else None,
              "p95_wall_clock_ms_nearest_rank": sorted(times)[math.ceil(.95 * len(times)) - 1] if times else None,
              "cost_usd": None, "cost_note": "Provider prices not independently verified",
              "trials": rows}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    models = sorted({str(row["model"].get("name")) for row in rows if isinstance(row["model"], dict)})
    lines = ["# Private DeepSWE pilot", "", "Models: " + ", ".join(f"`{name}`" for name in models) + ".",
             "Production Flecten sidecar, Pier 0.3.1, separate hidden verifier, no in-task failover.", "",
             "| Task | Reward | Feature | Regression | Turns | Tools | Seconds |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for row in rows:
        checks = row["checks"]
        feature = f"{checks.get('f2p_passed', '?')}/{checks.get('f2p_total', '?')}"
        regression = f"{checks.get('p2p_passed', '?')}/{checks.get('p2p_total', '?')}"
        seconds = round(row["wallClockMs"] / 1000, 1) if row["wallClockMs"] is not None else "unknown"
        lines.append(f"| {row['task']} | {row['reward'] if row['reward'] is not None else 'unscored'} | {feature} | {regression} | {row['turns']} | {row['tool_calls']} | {seconds} |")
    interval = report["scored_attempts_success_ci95_wilson"]
    if interval:
        lines += ["", f"Scored attempts: {passed}/{len(scored)}; 95% Wilson interval "
                  f"{interval[0]:.1%} to {interval[1]:.1%}. This small pilot does not estimate full DeepSWE performance."]
    interrupted = [row for row in rows if row["interruption"]]
    lines += ["", f"All attempts including infrastructure failures: {passed}/{len(rows)}.",
              f"Reported input tokens: {report['input_tokens']:,}; output tokens: {report['output_tokens']:,}.",
              "Cost is unavailable because endpoint prices have not been verified.", "",
              "The initial adapter failure occurred before any model response and remains in the report.",
              "Every task begins from a fresh base checkout; no model change occurred inside an attempt.",
              "Each private task passed oracle/no-op/original-solution calibration before the model run.",
              "The task variants and verifiers were frozen before inspecting model solutions.",
              "The original public solutions can still be present in training data; private mutation is not proof of no contamination.",
              "Only one attempt per task was planned. Reliability and model ranking remain unmeasured.", "",
              "Raw trial directories:", ""]
    lines += [f"- `{row['path']}`" for row in rows]
    if interrupted:
        lines += ["", "Interrupted runs:", ""]
        lines += [f"- {row['task']}: host restart; resumed through durable replay with the same model. "
                  "Its grade shows the recovered artifact; timing is not an uninterrupted run." for row in interrupted]
    (args.output / "summary.md").write_text("\n".join(lines) + "\n")
    print(f"Saved {len(rows)} attempts; {passed}/{len(scored)} scored attempts passed")


if __name__ == "__main__":
    main()
