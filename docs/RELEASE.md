# Релиз

Версия живёт в `package.json`. Тег начинается с `v`: `v0.1.1`. Каждой версии соответствует отдельный раздел `## 0.1.1` в `CHANGELOG.md`; дата и описание идут под заголовком. Этот раздел становится текстом GitHub Release без списка коммитов, будущих изменений и заметок других версий.

Flecten пока в альфе. Релизы публикуются в GitHub Releases с отметкой Pre-release и установщиками, а не остаются только git-тегами. Альфа не попадает в стабильный канал обновлений.

## Локальная проверка

```bash
bun run verify
bun run package
bun run smoke:packaged
```

`verify` гоняет тесты, типы, линт и обе сборки. `package` собирает распакованное приложение в `release/`. `smoke:packaged` запускает упакованное приложение, ждёт editable composer и реальный preload bridge, получает `status` через renderer и проверяет отображённую модель. Проверяется канонический путь встроенного бинарника агента; dev и agent overrides окружения очищаются. Smoke использует отдельный профиль.

Для замера готовности самого окна после packaging: `bun scripts/measure-desktop-startup.mjs release/linux-unpacked/flecten` (подставь executable своей платформы). Скрипт делает пять скрытых запусков со свежими профилями и ждёт отрисованную модель из backend status, editable composer, шрифты и два кадра. На Linux без графической сессии используй `xvfb-run -a`. P95 должен уложиться в8с; cache ОС не сбрасывается. `scripts/measure-startup.mjs` отдельно измеряет compiled sidecar до первого status.

## Установщики

`electron-builder.yml` задаёт цели: AppImage для Linux, DMG и ZIP для macOS, NSIS для Windows. Иконка лежит в `build/icon.png`. macOS использует hardened runtime и entitlements из `build/entitlements.mac.plist`.

## Auto-update

Упакованные сборки по умолчанию берут обновления из GitHub Releases продукта (`AnnenkovLabs/flecten`). Источник можно переопределить: `update.github` (owner и repo) задаёт другой репозиторий, `update.feedUrl` в конфиге или `FLECTEN_UPDATE_URL` в окружении задают свой generic-фид и имеют приоритет над GitHub. В dev без явного источника обновления выключены: окно не делает сетевых запросов и не падает, чип скрыт.

GitHub-источник читает `GET /repos/{owner}/{repo}/releases` и берёт самый свежий опубликованный релиз по `published_at`. Draft не считается никогда; stable пропускает prerelease, beta берёт самый новый включая prerelease. В релизе обязательны assets канала: `latest*.yml` (или `beta*.yml`), соответствующий `*.signed.json` и установщики. Без подписанного manifest релиз отвергается до загрузки байтов.

Feed задаёт базу generic-фида. Пример: `https://updates.example.com/flecten/`. Разрешены `https` и `http` только для loopback (`localhost`, `127.0.0.1`, `[::1]`). URL с логином или паролем отклоняется, ошибка показывается в чипе и в настройках.

Секция `update` конфига управляет циклом: `channel` (beta по умолчанию, stable для GA-выпусков), `github`, `feedUrl`, `autoCheck`, `autoDownload`, `installOnQuit`. По умолчанию авто-поля включены. Нормализованные настройки приходят в оболочку вместе со `status` и применяются без перезапуска. Проверка идёт через 10 с после старта и затем каждые 4 ч; ошибки повторяются с backoff от 15 мин до 4 ч. Найденное обновление скачивается в фоне с прогрессом в чипе. Установка происходит по кнопке перезапуска (`quitAndInstall(false, true)`) или штатным механизмом electron-updater при выходе с кодом 0, если включён `installOnQuit`. Идущий прогон не прерывается. В automated-режиме фоновые проверки выключены. Ошибки приходят в статус и показываются, IPC не бросает их в renderer.

Сервер обновлений хранит установщики и метаданные electron-builder:

- Windows: `latest.yml` и NSIS `.exe`.
- macOS: `latest-mac.yml`, `.zip` и `.dmg`.
- Linux: `latest-linux.yml` и `.AppImage`.

Канал `stable` читает эти файлы `latest*`. Канал `beta` требует `beta.yml`, `beta-mac.yml`, `beta-linux.yml` и соответствующие установщики; подписанный manifest генерируется для каждого канала отдельно.

Текущая Alpha явно собирает metadata канала `beta`. Для стабильного выпуска переключи `publish.channel` в `electron-builder.yml` и шаблон metadata в release workflow вместе.

`electron-builder.yml` содержит generic publish только для генерации метаданных, без URL внешнего сервера. Artifacts на сервер кладёт CI или оператор. electron-builder не загружает их и не требует токен.

Для macOS обновление должно быть подписано тем же Developer ID, иначе Squirrel.Mac откажется его применять. На Windows остаётся платформенная проверка publisher. На всех платформах приложение дополнительно требует Ed25519-подпись metadata; Linux AppImage проверяет SHA512 скачанных bytes через штатную pipeline.

## SBOM

```bash
bun run sbom
```

`scripts/sbom.mjs` читает `package.json` и `bun.lock` и пишет CycloneDX 1.5 в `release/sbom.json`. Компоненты это все пакеты lock с версиями и purl. Лицензии берутся из `node_modules/<name>/package.json`, когда пакет установлен локально. Генератор не ходит в сеть и не добавляет зависимостей.

`bun run checksums` вызывает генератор до подсчёта хешей, поэтому `release/SHA256SUMS.txt` покрывает `sbom.json`. Итоговая CI job запускает `bun scripts/release-checksums.mjs` до сохранения candidate. Release публикует готовые metadata, SBOM, signatures и checksums.

## Быстрый выпуск

Обычный выпуск состоит из двух независимых этапов: CI заранее готовит проверенный комплект для коммита, Release публикует этот комплект без пересборки. Версия и changelog фиксируются до подготовки. Изменения рабочего дерева в выпуск не попадают.

1. Обнови `package.json` и раздел этой версии в `CHANGELOG.md`, закоммить и отправь `main`.
2. Дождись зелёного CI и job **ready to release** для этого коммита. Она сохраняет готовый candidate на 14 дней.
3. Из `main` выполни одну команду:

```bash
bun run release:publish
```

Команда проверяет, что HEAD уже отправлен в публичный `main`, находит успешный CI именно для этого SHA, проверяет все обязательные jobs и доступность candidate. Только затем создаёт аннотированный тег версии из закоммиченного `package.json` и отправляет его. Тег запускает короткий Release workflow. Альфа публикуется как GitHub Pre-release с описанием и файлами.

Подготовка идёт фоном после push. Быстрая публикация готового комплекта целится в 30-90 секунд; время зависит от очереди GitHub и передачи файлов. Сборка новой версии имеет отдельный бюджет: его определяет самая медленная параллельная job. Эти ориентиры не заменяют измерение реальных runs.

## CI: подготовка один раз

`.github/workflows/ci.yml` запускается на PR, push в `main` и вручную. Одновременно работают:

- **verify** на Linux, macOS и Windows: тесты, типы, линт и обе сборки.
- **Quality** как reusable workflow: docs, coverage с порогом 85% и три параллельных Electron shard. Скрытые окна, committed visual goldens на 1480x940 и 1180x640, обязательный preflight и проверка Computer сохраняются. HTML report, traces и снимки ошибок доступны в artifacts.
- **Build installers** на Linux, Windows и macOS arm64/Intel. В доверенном `main` собираются реальные установщики; PR проверяет распакованные приложения без signing secrets. Каждый пакет проходит smoke. Linux запускает публикуемый AppImage с Chromium sandbox. На Windows дополнительно проверяется самостоятельный старт агента.

Неблокирующий dependency audit остаётся отдельной job. Самостоятельные дублирующие запуски Quality на main и повторная packaging job после verify удалены.

Итоговая **ready to release** требует успеха verify, Quality и всех четырёх packaging jobs. Она объединяет metadata обеих архитектур macOS, подписывает update metadata Ed25519, готовит SBOM, checksums и текст релиза из changelog. Без ключей подписанный candidate не создаётся. Отсутствие платформенного сертификата остаётся явно отмечено `UNSIGNED-macos.txt` или `UNSIGNED-windows.txt`.

Файл `release-candidate.json` связывает repository, workflow, точный SHA, версию, run ID и attempt со всеми именами файлов, размерами и SHA256. Candidate включает шесть обязательных установщиков, metadata трёх каналов beta, подписи, SBOM и changelog. Архив сохраняется без дополнительного сжатия готовых бинарников.

## Release: публикация готовых файлов

`.github/workflows/release.yml` принимает тег `v*` или ручной запуск на существующем теге. Тег обязан совпадать с версией в `package.json`.

1. Найти успешный run доверенного `ci.yml` в `AnnenkovLabs/flecten`: только `main`, события push или workflow_dispatch, точный SHA тега. Каждый обязательный gate должен иметь `success`; skipped и neutral не принимаются.
2. Скачать конкретный immutable artifact ID этого run attempt. Проверить SHA256 архива из GitHub API, затем точный набор файлов, их размеры и hashes, provenance, версии metadata/SBOM и подписи Ed25519. Проверка повторяется до работы с GitHub Release.
3. Создать draft, загрузить проверенные bytes и опубликовать GitHub Pre-release. Тег повторно сверяется с исходным коммитом непосредственно перед публикацией.

В Release нет установки Electron, тестовой матрицы, E2E, packaging или повторной генерации SBOM и подписей. Приватный ключ ему не нужен. Он публикует тот же комплект, который прошёл CI.

### Если candidate ещё не готов

Команда выпуска и Release завершаются с понятной ошибкой и ссылкой на CI. Они не начинают скрытую пересборку и не создают пустой релиз. Дождись текущего CI. Если комплект истёк или удалён, повторно подготовь main:

```bash
gh workflow run ci.yml --ref main
```

Для временного сбоя в подготовке используй **Re-run failed jobs**. Успешные платформенные jobs сохраняются; промежуточные artifacts заменяются только внутри этого CI run, финальные candidates имеют отдельное имя для каждого attempt.

### Повторная публикация

После сетевого сбоя можно продолжить существующий draft:

```bash
gh workflow run release.yml --ref v0.1.2
```

Совпадающие файлы сохраняются, недостающие догружаются. Конфликт имени, размера или SHA256 блокирует выпуск. Уже опубликованный релиз допускает только успешный повтор без изменений при полном совпадении комплекта и описания. Другие bytes или notes требуют новой версии. Опубликованные теги не перемещаются.

## Проверки перед выпуском

Законченную правку проверяй один раз:

```bash
bun run verify
```

При изменениях интерфейса дополнительно просмотри приложение на 1480x940 и 1180x640. Зелёные проверки на текущем коде повторно не запускаются для уверенности. CI подтверждает качество того же коммита перед созданием candidate.

Платформенная подпись включается при наличии секретов:

- `CSC_LINK`, `CSC_KEY_PASSWORD` для Apple Developer ID.
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` для Windows, с fallback к общему сертификату.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` для notarization.

Без платформенных сертификатов установщики остаются unsigned и явно сообщают об этом. Для рабочего auto-update на macOS нужен Developer ID. Подпись Ed25519 metadata обязательна на всех платформах независимо от платформенного сертификата.

## Ключ канала обновлений

CI variable `UPDATE_SIGNING_PUBLIC_KEY` содержит Ed25519 public PEM. Packaging запускает `bun scripts/sign-update-manifests.mjs --pin`, сохраняя его в `shell/update-public-key.pem` внутри приложения. Этот generated file исключён из git. Runtime не читает ключ из feed или environment.

CI secret `UPDATE_SIGNING_PRIVATE_KEY` доступен только итоговой job подготовки candidate в доверенном main. `bun scripts/sign-update-manifests.mjs` сверяет keypair, version, размеры и SHA512 actual artifacts, затем пишет `latest*.signed.json` перед checksums. Их надо публиковать рядом с `latest*.yml` и installer. Без ключей локальная сборка явно получает `UNSIGNED-updates.txt`; приложение отвергает неподписанный канал. CI не допускает такой комплект к публикации.

Updater проверяет подпись, версию и каждый artifact URL/hash/size до availability. Download разрешён только для проверенного immutable snapshot. Замена metadata после check и bytes после подписи блокируется. Differential и web installer paths отключены. Пользователь может отложить загрузку или установку.

Installer больше350МиБ блокируется до публикации checksums. Agent имеет отдельный бюджет85МиБ для Linux и macOS, 86МиБ для Windows. В 0.1.3 с Bun 1.4.2 измерены 80,5МиБ на linux-x64 и 85,1МиБ (89 201 152 bytes) на windows-x64. Windows получает 0,9МиБ запаса из-за большего native runtime; лимиты остальных платформ сохранены.
