# Бенч

Реальный DeepSWE с приватными мутациями и production sidecar запускается через
[адаптер Pier](deepswe/README.md). Описанный ниже mock runner проверяет механизмы харнесса.

20 задач лежат в `tasks/`, по одной на файл. Формат, проверки, метрики и baseline описаны во внутренних материалах.

## Прогон

```bash
bun scripts/bench.ts
bun scripts/bench.ts --filter read-config,edit-version
bun test tests/unit/bench.test.ts
```

По умолчанию mock-провайдер работает локально, сеть не нужна. Отчёт пишется в `results/<timestamp>/`: `report.json` и `summary.md`.

## Baseline

Codex запускается только с явным флагом:

```bash
BENCH_CODEX_CLI=1 bun scripts/bench.ts
```

Без флага или без бинарника baseline помечается `skipped` с причиной, цифры не подставляются.

## Правила

- Одна задача проверяет один сценарий харнесса.
- Фикстуры и ходы mock-провайдера лежат в JSON задачи.
- Проверки детерминированные, без сети и без времени.
- Падение baseline не маскируется: недоступные проверки помечаются `unscored`.
