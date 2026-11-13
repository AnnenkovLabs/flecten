# DeepSWE through Flecten

This adapter runs the compiled production sidecar inside Pier's task container.
DeepSWE's separate verifier grades the committed submission in a pristine container.
The existing `scripts/bench.ts` remains a deterministic mock-provider check.

The first private variants are derived from DeepSWE commit
`0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea`. They follow the
[MaxxBench method](https://maxxbench.unlap.ai/research/why-maxxbench/):
change requirements, reference solutions, hidden checks, and exact scoring IDs together.
They are local DeepSWE derivatives, not official DeepSWE or MaxxBench scores.

| Task | Changed requirements |
| --- | --- |
| ofetch circuit breaker | Threshold 3, cooldown 1250.5 ms, two probes, strict elapsed > cooldown, fractional precision |
| aiomonitor snapshots | First ID 41, capacity 7, empty names eligible for eviction, nonempty names protected |

## Prepare

```bash
uv tool install 'datacurve-pier==0.3.1'
git clone https://github.com/datacurve-ai/deep-swe .liquid/benchmarks/upstream/deep-swe
git -C .liquid/benchmarks/upstream/deep-swe checkout 0b9fabbb63b9104d678fe965e1632f2dd9eaa2ea
bun run build:agent
python3 bench/deepswe/mutate-ofetch.py
python3 bench/deepswe/mutate-aiomonitor.py
```

Docker and its Compose plugin must be available. Authoring scripts refuse to
overwrite existing tasks. Each task's `mutation.json` records source and variant hashes.
DeepSWE and MaxxBench benchmark contributions are Apache-2.0; upstream repository
licenses still apply. See the upstream `PROVENANCE.md` and `LICENSE`.

Create `.liquid/benchmarks/private/provider.env` with permissions 0600:

```dotenv
BENCH_BASE_URL=https://your-provider.example/v1
BENCH_API_KEY=your-key
```

Calibrate each variant before using it. The updated oracle must pass; the original
oracle and empty submission must fail. Tests are mounted only in fresh verifier
containers with networking disabled. Reference solutions run in separate producers.

```bash
python3 bench/deepswe/calibrate.py \
  .liquid/benchmarks/tasks/aiomonitor-task-snapshots-diff \
  --output .liquid/benchmarks/calibration/aiomonitor-new
```

## Run

Run one fixed model for an entire attempt. Flecten failover is disabled and a
`model.fallback` event fails the attempt. A different model starts a new container
from the base commit. Infrastructure retries are disabled at the Pier level.

```bash
PYTHONPATH=. pier run \
  -p .liquid/benchmarks/tasks/ofetch-per-origin-circuit-breaker \
  --agent-import-path bench.deepswe.flecten_agent:FlectenAgent \
  --model deepseek-v4.1-flash-1017 \
  --ak timeout_sec=3600 --ak reasoning=high \
  -n 1 -k 1 --max-retries 0 \
  --jobs-dir .liquid/benchmarks/jobs --job-name deepseek-ofetch-01
```

Pier permits inference traffic only to the configured provider hostname through
its authenticated proxy. Hidden tests, reference patches, the host workspace, and
the private env file are not uploaded to the agent. The process receives the API
key in its environment; this is process isolation, not a credential broker. Agent
shell tools receive the product's normal filtered environment. Provider credentials
and proxy authentication are redacted from saved sidecar output.

For multiple attempts, copy `dist/flecten-agent` and `dist/prompts` into a frozen
runtime directory and pass `--ak runtime_dir=/absolute/path/to/runtime` to every
run. `agent-build.json` records the exact uploaded binary and prompt hashes.

An interrupted container can preserve its repository and durable session. The
runner's `--session-id` resumes that session with the supplied instruction through
the standard `run` command and `resumed: true`. Use the product's `/continue` prompt,
the same model and runtime, and a separate logs directory. Record the interruption
and recovery as such; do not present it as an uninterrupted measurement.

The adapter disables user skills, modules, MCP, hooks, conversation roles,
auto-resume, and telemetry for a fixed standalone worker setup. The network policy
blocks background requests to other hosts, including dictionary/catalog updates.
Task repository instructions remain available through the normal product path.
The task instruction still requires the agent to commit its work; the adapter does
not silently commit an unfinished solution for it.

Every attempt saves the live sidecar stream, durable session/tool logs, runtime
configuration, run result, submitted patch, verifier output, and structured rewards
under its Pier job directory. `session.finished` determines execution completion;
the independent binary verifier reward determines task success. Report provider
pricing as unavailable if the endpoint supplies no verified prices, even if the
runtime's unpriced cost counter is zero.

Two tasks with one attempt each are a wiring pilot. A model comparison requires a
larger fixed task set, at least three independent attempts per task, and confidence
intervals. Private mutations reduce direct solution reuse but do not prove the
absence of training contamination. Freeze tasks before examining model answers.

Generate a report from completed saved trials, including unscored infrastructure
failures and a Wilson confidence interval:

```bash
python3 bench/deepswe/report.py .liquid/benchmarks/jobs \
  --output .liquid/benchmarks/report
```
