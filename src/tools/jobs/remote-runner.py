"""POSIX remote job protocol. Control requests do not own the job's stdio or lifetime."""
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid


def atomic(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    descriptor = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def identity(pid):
    try:
        # Linux start ticks distinguish a reused PID from the submitted process.
        fields = Path("/proc", str(pid), "stat").read_text().rsplit(")", 1)[1].split()
        if fields[0] == "Z":
            return None
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        return boot + ":" + fields[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def read(path):
    return json.loads(path.read_text())


def snapshot(directory):
    job = read(directory / "job.json")
    state = read(directory / "state.json") if (directory / "state.json").exists() else {"status": "starting"}
    if state["status"] == "starting" and (directory / "submitted.json").exists():
        submitted = read(directory / "submitted.json")
        if identity(submitted["pid"]) != submitted["startIdentity"]:
            state = {"status": "uncertain", "error": "Runner disappeared before creating its state; inspect this handle, do not resubmit."}
    if state.get("status") == "running" and identity(state["pid"]) != state["startIdentity"]:
        state = {**state, "status": "uncertain", "error": "Process disappeared without an exit record; do not resubmit."}
    return {"id": job["id"], "argv": job["argv"], "cwd": job["cwd"], **state}


def run(directory):
    job = read(directory / "job.json")
    state = {"status": "running", "pid": os.getpid(), "startIdentity": identity(os.getpid()), "startedAt": time.time() * 1000}
    atomic(directory / "state.json", state)
    with (directory / "stdout.log").open("ab", buffering=0) as stdout, (directory / "stderr.log").open("ab", buffering=0) as stderr:
        try:
            child = subprocess.Popen(job["argv"], cwd=job["cwd"], stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            state["childPid"] = child.pid
            atomic(directory / "state.json", state)
            code = child.wait()
            atomic(directory / "state.json", {**state, "status": "exited" if code == 0 else "failed", "exitCode": code, "finishedAt": time.time() * 1000})
        except Exception as error:
            atomic(directory / "state.json", {**state, "status": "failed", "error": str(error), "finishedAt": time.time() * 1000})


def control(request):
    if not Path("/proc/self/stat").exists():
        raise RuntimeError("Remote jobs require a Linux host with /proc process identity")
    directory = Path(request["directory"])
    operation = request["op"]
    if operation == "submit":
        job = {"id": request["id"], "argv": request["argv"], "cwd": request["cwd"]}
        digest = hashlib.sha256(json.dumps(job, sort_keys=True).encode()).hexdigest()
        directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            if read(directory / "job.json").get("digest") != digest:
                raise ValueError("Job id already belongs to another operation")
        else:
            atomic(directory / "job.json", {**job, "digest": digest})
            # Reuse the same program on the host; no shell interpolation or pgrep.
            runner = directory / "runner.py"
            runner.write_text(request["runner"])
            process = subprocess.Popen([sys.executable, str(runner), "run", str(directory)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            atomic(directory / "submitted.json", {"pid": process.pid, "startIdentity": identity(process.pid)})
        # The handle is durable even if the connection closes before this response.
        return snapshot(directory)
    if operation == "stop":
        state = snapshot(directory)
        if state["status"] == "running":
            pid = state["pid"]
            if identity(pid) == state["startIdentity"]:
                os.killpg(pid, signal.SIGTERM)
                deadline = time.monotonic() + 0.5
                while identity(pid) == state["startIdentity"] and time.monotonic() < deadline:
                    time.sleep(0.025)
                if identity(pid) == state["startIdentity"]:
                    os.killpg(pid, signal.SIGKILL)
                atomic(directory / "state.json", {**state, "status": "stopped", "finishedAt": time.time() * 1000})
        return snapshot(directory)
    state = snapshot(directory)
    if operation == "output":
        output = {}
        for channel in ("stdout", "stderr"):
            path = directory / (channel + ".log")
            if path.exists():
                with path.open("rb") as stream:
                    stream.seek(max(0, path.stat().st_size - 48000))
                    output[channel] = stream.read(48000).decode("utf-8", errors="replace")
            else:
                output[channel] = ""
        state["output"] = output
    return state


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        run(Path(sys.argv[2]))
    else:
        try:
            encoded = sys.argv[1]
            request = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            print(json.dumps(control(request)), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)
            sys.exit(1)
