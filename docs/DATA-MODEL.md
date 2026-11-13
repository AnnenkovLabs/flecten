# Модель данных

## Раскладка

```text
.liquid/
  sidecar.lock            замок ядра: pid, токен, время старта
  secrets.json            ключи из настроек, права 0600
  memory.json             память проекта
  checkpoints/            pre-image и post-image для /undo и /redo
  shadow/                 теневой git для снимков shell-команд
  todos/<sessionId>.json
  cache/                  каталог моделей
  trash/                  удалённые задачи
  skills/                 skills проекта
  liquid.db               план, кодом пока не пишется
  profile.json            план
  terms.jsonl             план
  sessions/
    index.json
    <sessionId>/
      spec.json
      events.jsonl
      queue.json          очередь сообщений, переживает перезапуск
      pages/
        p1.md
        p2.md
      logs/
        <toolCallId>.log
```

Проект хранит состояние в `.liquid/`. Сессия хранит спеку, события, очередь, выжимки и полные логи тулов. Файлы состояния пишутся атомарно: временный файл и rename. В проекте работает одно ядро: его держит `sidecar.lock`, подробности в [PROTOCOL.md](PROTOCOL.md).

## SQLite

План. Сейчас ядро хранит всё в файлах из раскладки выше, `bun:sqlite` не подключён.

```sql
sessions(id, raw, created_at, finished_at)
pages(id, session_id, criterion_id, title, handoff, created_at)
profile_entries(id, kind, text, source, weight, created_at)
terms(term, definition, source, updated_at)
```

`kind` принимает `preference`, `vocabulary`, `taste`, `anti_pattern`, `decision`.

`weight` растёт, когда запись подтверждается повторно, и падает, когда юзер её отменяет.

## События

`events.jsonl` это append-only лог. Одна строка, одно событие из `Event`. Секреты вырезаны. Сырое сообщение юзера хранится в `sessions.raw` и в первом событии слово в слово.

## Профиль

`profile.json` это снимок для чтения. Источник правды для запросов это `profile_entries`.

```json
{
  "preferences": [],
  "vocabulary": {},
  "taste": [],
  "antiPatterns": [],
  "decisions": []
}
```

## Термины

`terms.jsonl`, одна запись на строку:

```json
{"term":"ии слоп","definition":"...","source":"user","date":"2026-10-19"}
```

`source` принимает `user`, `kb`, `docs`, `web`. Запись из web без даты не используется.

## Спека

`spec.json` валидируется схемой из `src/core/spec/schema.ts`. Критерии имеют стабильные id `c1`, `c2`.

## Выжимка страницы

`pages/p1.md` содержит разделы: `Changed`, `Invariants`, `Next`, `Risks`. Пустые разделы остаются, чтобы дешёвая проверка видела пропуск.

## Логи

Полный вывод тула лежит в `logs/<toolCallId>.log`. В контекст идёт обрезанная версия. Логи не коммитятся и удаляются вместе с сессией по команде `liquid clean` (M2).
