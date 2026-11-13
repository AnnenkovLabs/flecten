"""Run the real JSONL sidecar inside a task container; no model selection or judging."""

import argparse
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit


def runtime_config(model, base_url, reasoning, timeout, proxy=None):
    config = {
        "schemaVersion": 3, "useDefaults": False, "provider": "benchmark", "model": model,
        "reasoning": reasoning,
        "providers": {"benchmark": {
            "protocol": "openai-chat", "baseUrl": base_url, "apiKeyEnv": "BENCH_API_KEY",
            "models": {model: {"tools": True, "reasoning": True}},
        }},
        "failover": {"enabled": False, "providers": []},
        "skills": {"sources": []}, "modules": {"enabled": False, "roots": [], "dirs": []},
        "mcp": {"servers": {}}, "hooks": {}, "conversation": {"enabled": False},
        "catalog": {"autoRefresh": False}, "sessions": {"autoResume": False},
        "telemetry": {"enabled": False}, "update": {"autoCheck": False},
        "sandbox": {"enabled": False},
        "permissions": {"read": "allow", "write": "allow", "shell": "allow",
                        "network": "deny", "mcp": "deny", "skill": "deny",
                        "externalPath": "deny", "destructive": "allow"},
        "budgets": {"maxWallClockMs": timeout * 1000},
    }
    if proxy:
        config["providers"]["benchmark"]["proxy"] = proxy
    return config


def validate_event(event, model):
    if not isinstance(event, dict) or not isinstance(event.get("type"), str):
        raise ValueError("Sidecar event needs a typed object")
    if event["type"] == "model.fallback":
        raise ValueError("Model failover is forbidden in this attempt")
    if event["type"] in {"status", "session.started"} and event.get("model") != model:
        raise ValueError("Sidecar selected a different model")
    if event["type"] == "session.finished":
        result = event.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("usage"), dict):
            raise ValueError("Invalid session.finished result")
        for field in ("input", "output", "cached"):
            value = result["usage"].get(field)
            if type(value) is not int or value < 0:
                raise ValueError("Invalid token usage in session.finished")
        if type(result.get("turns")) is not int or result["turns"] < 0:
            raise ValueError("Invalid turn count in session.finished")
        if result.get("stopReason") not in {"done", "end", "stopped", "error", "max_turns", "budget"}:
            raise ValueError("Invalid stop reason in session.finished")
    return event


def run(args):
    secret = os.environ.get("BENCH_API_KEY", "")
    base_url = os.environ.get("BENCH_BASE_URL", "")
    url = urlsplit(base_url)
    if not secret or url.scheme not in {"http", "https"} or not url.hostname or url.username:
        raise ValueError("Missing valid private provider environment")
    if not args.model.strip() or args.timeout < 1:
        raise ValueError("A fixed model and positive timeout are required")
    instruction = Path(args.instruction).read_text()
    if not instruction.strip():
        raise ValueError("Task instruction is empty")
    logs = Path(args.logs)
    logs.mkdir(parents=True, exist_ok=True)
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    secrets = {secret, json.dumps(secret)[1:-1]}
    if proxy:
        secrets.add(proxy)
        if urlsplit(proxy).password:
            secrets.add(urlsplit(proxy).password)

    def sanitize(text):
        for value in secrets:
            text = text.replace(value, "[REDACTED]")
        return text

    def save_json(path, value):
        path.write_text(sanitize(json.dumps(value, ensure_ascii=False, indent=2)) + "\n")

    started = time.monotonic()
    summary = {"model": args.model, "reasoning": args.reasoning, "turns": 0,
               "usage": {"input": 0, "output": 0, "cached": 0}, "stopReason": "error",
               "toolCalls": 0, "toolFailures": 0, "providerRetries": 0,
               "compactions": 0, "peakContextTokens": 0}
    if args.session_id:
        summary["resumedSessionId"] = args.session_id
    process = None
    with tempfile.TemporaryDirectory(prefix="flecten-runtime-") as directory:
        config = runtime_config(args.model, base_url, args.reasoning, args.timeout, proxy)
        config_path = Path(directory) / "config.json"
        config_path.write_text(json.dumps(config))
        save_json(logs / "runtime-config.json", config)
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("FLECTEN_", "LIQUID_"))}
        environment.update({"FLECTEN_CONFIG": str(config_path), "FLECTEN_CWD": os.getcwd(),
                            "FLECTEN_PROMPTS_DIR": str(Path(args.binary).parent / "prompts"),
                            "FLECTEN_SECRET_BACKEND": "file"})
        pending = queue.Queue()

        def read_stdout(stream):
            for line in stream:
                pending.put(line)
            pending.put(None)

        def read_stderr(stream):
            with (logs / "sidecar-stderr.log").open("w") as target:
                for line in stream:
                    target.write(sanitize(line))
                    target.flush()

        try:
            process = subprocess.Popen([args.binary], cwd=os.getcwd(), env=environment,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, bufsize=1)
            readers = [threading.Thread(target=read_stdout, args=(process.stdout,), daemon=True),
                       threading.Thread(target=read_stderr, args=(process.stderr,), daemon=True)]
            for reader in readers:
                reader.start()
            submitted = False
            finished = False
            with (logs / "sidecar-events.jsonl").open("w") as events:
                while not finished:
                    remaining = args.timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        summary["stopReason"] = "timeout"
                        raise TimeoutError("Agent wall-clock budget exceeded")
                    try:
                        line = pending.get(timeout=min(remaining, 1))
                    except queue.Empty:
                        continue
                    if line is None:
                        raise RuntimeError("Sidecar exited without session.finished")
                    event = validate_event(json.loads(line), args.model)
                    events.write(sanitize(json.dumps(event, ensure_ascii=False)) + "\n")
                    events.flush()
                    kind = event["type"]
                    if kind == "status" and not submitted:
                        if event.get("trustRequired") or event.get("configError"):
                            raise RuntimeError("Isolated benchmark configuration is not ready")
                        summary["system"] = event.get("system")
                        summary["contextWindow"] = event.get("contextWindow")
                        summary["maxOutputTokens"] = event.get("maxOutputTokens")
                        command = {"type": "run", "prompt": instruction, "reasoning": args.reasoning}
                        if args.session_id:
                            command.update({"sessionId": args.session_id, "resumed": True})
                        process.stdin.write(json.dumps(command) + "\n")
                        process.stdin.flush()
                        submitted = True
                    elif kind == "error":
                        raise RuntimeError(event.get("message", "Sidecar returned an error"))
                    elif kind == "session.started":
                        summary["sessionId"] = event.get("sessionId")
                        summary["system"] = event.get("system")
                    elif kind == "turn.started":
                        summary["turns"] = event.get("turn", summary["turns"])
                    elif kind == "usage":
                        for key in summary["usage"]:
                            value = event.get("usage", {}).get(key, 0)
                            if type(value) is int and value >= 0:
                                summary["usage"][key] += value
                    elif kind == "tool.started":
                        summary["toolCalls"] += 1
                    elif kind == "tool.finished" and event.get("result", {}).get("ok") is False:
                        summary["toolFailures"] += 1
                    elif kind == "provider.retry":
                        summary["providerRetries"] += 1
                    elif kind == "context.compacted":
                        summary["compactions"] += 1
                    elif kind == "context.usage":
                        summary["peakContextTokens"] = max(summary["peakContextTokens"], event.get("used", 0))
                    elif kind == "session.finished":
                        summary.update({key: event["result"][key] for key in ("usage", "turns", "stopReason")})
                        spent = event["result"].get("budget", {}).get("spent", {})
                        if "costUsd" in spent:
                            summary["costUsd"] = spent["costUsd"]
                        finished = True
        except Exception as error:
            summary["error"] = sanitize(str(error))
        finally:
            if process:
                if process.poll() is None:
                    process.stdin.close()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                for reader in readers:
                    reader.join(timeout=2)
                summary["sidecarExitCode"] = process.returncode
            sessions = Path.cwd() / ".liquid/sessions"
            if sessions.is_dir():
                for source in sessions.rglob("*"):
                    if source.is_file() and not source.is_symlink():
                        target = logs / "sessions" / source.relative_to(sessions)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        contents = source.read_bytes()
                        for value in secrets:
                            contents = contents.replace(value.encode(), b"[REDACTED]")
                        target.write_bytes(contents)
            summary["wallClockMs"] = round((time.monotonic() - started) * 1000)
            save_json(logs / "run-result.json", summary)
    return 0 if summary["stopReason"] in {"done", "end"} and "error" not in summary else 1


def self_check():
    config = runtime_config("fixed-model", "https://example.com/v1", "high", 30)
    assert config["failover"]["enabled"] is False
    assert config["providers"]["benchmark"]["apiKeyEnv"] == "BENCH_API_KEY"
    assert "apiKey" not in config["providers"]["benchmark"]
    assert validate_event({"type": "message.delta", "text": "session.finished"}, "fixed-model")
    for event in ({"type": "model.fallback"}, {"type": "session.started", "model": "other"},
                  {"type": "session.finished", "result": {}}):
        try:
            validate_event(event, "fixed-model")
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid event passed the protocol boundary")
    print("sidecar adapter protocol check passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--instruction")
    parser.add_argument("--model")
    parser.add_argument("--session-id", help="Resume the existing durable session after an interruption")
    parser.add_argument("--reasoning", default="high")
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--binary", default="/opt/flecten/flecten-agent")
    parser.add_argument("--logs", default="/logs/agent")
    arguments = parser.parse_args()
    if arguments.self_check:
        self_check()
    elif not arguments.instruction or not arguments.model:
        parser.error("--instruction and --model are required")
    else:
        raise SystemExit(run(arguments))
