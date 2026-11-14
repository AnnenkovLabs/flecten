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

Секция `update` конфига управляет циклом: `channel` (stable или beta), `github`, `feedUrl`, `autoCheck`, `autoDownload`, `installOnQuit`. По умолчанию авто-поля включены. Нормализованные настройки приходят в оболочку вместе со `status` и применяются без перезапуска. Проверка идёт через 10 с после старта и затем каждые 4 ч; ошибки повторяются с backoff от 15 мин до 4 ч. Найденное обновление скачивается в фоне с прогрессом в чипе. Установка происходит по кнопке перезапуска (`quitAndInstall(false, true)`) или штатным механизмом electron-updater при выходе с кодом 0, если включён `installOnQuit`. Идущий прогон не прерывается. В automated-режиме фоновые проверки выключены. Ошибки приходят в статус и показываются, IPC не бросает их в renderer.

Сервер обновлений хранит установщики и метаданные electron-builder:

- Windows: `latest.yml` и NSIS `.exe`.
- macOS: `latest-mac.yml`, `.zip` и `.dmg`.
- Linux: `latest-linux.yml` и `.AppImage`.

Канал `stable` читает эти файлы `latest*`. Канал `beta` требует `beta.yml`, `beta-mac.yml`, `beta-linux.yml` и соответствующие установщики; подписанный manifest генерируется для каждого канала отдельно.

`electron-builder.yml` содержит generic publish только для генерации метаданных, без URL внешнего сервера. Artifacts на сервер кладёт CI или оператор. electron-builder не загружает их и не требует токен.

Для macOS обновление должно быть подписано тем же Developer ID, иначе Squirrel.Mac откажется его применять. На Windows остаётся платформенная проверка publisher. На всех платформах приложение дополнительно требует Ed25519-подпись metadata; Linux AppImage проверяет SHA512 скачанных bytes через штатную pipeline.

## SBOM

```bash
bun run sbom
```

`scripts/sbom.mjs` читает `package.json` и `bun.lock` и пишет CycloneDX 1.5 в `release/sbom.json`. Компоненты это все пакеты lock с версиями и purl. Лицензии берутся из `node_modules/<name>/package.json`, когда пакет установлен локально. Генератор не ходит в сеть и не добавляет зависимостей.

`bun run checksums` вызывает генератор до подсчёта хешей, поэтому `release/SHA256SUMS.txt` покрывает `sbom.json`. Publish job уже запускает `bun scripts/release-checksums.mjs`. Metadata, SBOM, signatures и checksums включаются в publish job.

## CI

`.github/workflows/ci.yml` проверяет Linux, macOS и Windows на каждый PR. Packaged smoke собирает и запускает распакованное приложение на каждой из трёх ОС; Linux использует xvfb. Quality сохраняет полный текстовый coverage report и LCOV с порогом 85%, запускает скрытый Electron и сравнивает committed goldens на 1480x940 и 1180x640. Preflight запрещает пропустить весь Electron набор из-за отсутствующей среды. Playwright HTML report, traces и failure screenshots сохраняются как CI artifacts. Audit зависимостей идёт отдельной неблокирующей job.

## GitHub Actions release

Тег `v*` запускает `.github/workflows/release.yml`:

1. `prepare` проверяет совпадение тега и версии, извлекает соответствующий раздел `CHANGELOG.md` и создаёт черновик GitHub Release. Пустой, отсутствующий или повторяющийся раздел блокирует выпуск с понятной ошибкой.
2. `verify` на трёх ОС и общий Quality workflow проверяют тесты, типы, линт, сборки, docs, coverage, Electron и visual regression.
3. `package` на трёх ОС, только после зелёных verify и Quality; packaged smoke проходит перед upload. На Linux проверяется каждый публикуемый AppImage через `FLECTEN_SMOKE_EXECUTABLE` и `APPIMAGE_EXTRACT_AND_RUN=1`.
4. `publish` скачивает только release artifacts, подписывает update metadata, генерирует SBOM и `SHA256SUMS.txt`, загружает все файлы в GitHub Release и снимает статус черновика. Альфа остаётся Pre-release.

При ошибке проверок или сборки новый релиз остаётся черновиком, ссылка на тег не считается готовым выпуском. После временного сбоя среды используй Re-run failed jobs в Actions. Для полного повторного запуска существующего тега доступен `gh workflow run release.yml --ref v0.1.1`; запуск на ветке отвергается. Если исправление меняет код, выпусти новую версию с новым тегом. Повторный прогон обновляет тот же релиз и заменяет совпадающие assets, не создавая дубликат и не возвращая уже опубликованный релиз в черновик.

Подпись включается сама, когда заданы секреты:

- `CSC_LINK`, `CSC_KEY_PASSWORD` для Apple Developer ID и Windows-сертификата.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` для notarization.

Без секретов сборка остаётся unsigned, а `scripts/notarize.cjs` пишет в лог, что notarization пропущена. Это не скрытая ошибка: релиз явно не получает подпись. Unsigned сборка запускается и проверяет обновления, но macOS не применит обновление без подписи Developer ID. Для рабочего auto-update macOS требует Developer ID. На всех платформах обязательно совпадение с закреплённым ключом Ed25519 канала.

## Выпуск версии

1. Обнови `package.json` и добавь понятный раздел этой версии в `CHANGELOG.md`. Опиши видимые изменения, исправления и ограничения; будущие планы оставь в «Не выпущено».
2. Выполни проверки ниже и просмотри интерфейс в двух размерах.
3. Закоммить изменения и отправь `main`, затем создай аннотированный тег той же версии и отправь его в `origin`.
4. Дождись зелёного Release workflow. Проверь опубликованный GitHub Release, его описание, установщики, SBOM и checksums. Тег или черновик сами по себе выпуск не завершают.

```bash
bun run verify
bun run app:shot
```

Проверь снимок и окно на 1480x940 и 1180x640. Убедись, что версия в `package.json` совпадает с тегом, а в пакете лежат `flecten-agent` и `prompts/`.

## Ключ канала обновлений

CI variable `UPDATE_SIGNING_PUBLIC_KEY` содержит Ed25519 public PEM. Packaging запускает `bun scripts/sign-update-manifests.mjs --pin`, сохраняя его в `shell/update-public-key.pem` внутри приложения. Этот generated file исключён из git. Runtime не читает ключ из feed или environment.

CI secret `UPDATE_SIGNING_PRIVATE_KEY` доступен только publish job. `bun scripts/sign-update-manifests.mjs` сверяет keypair, version, размеры и SHA512 actual artifacts, затем пишет `latest*.signed.json` перед checksums. Их надо публиковать рядом с `latest*.yml` и installer. Без ключей release явно получает `UNSIGNED-updates.txt`; приложение отвергает неподписанный канал.

Updater проверяет подпись, версию и каждый artifact URL/hash/size до availability. Download разрешён только для проверенного immutable snapshot. Замена metadata после check и bytes после подписи блокируется. Differential и web installer paths отключены. Пользователь может отложить загрузку или установку.

Installer больше350МиБ блокируется до публикации checksums. Agent имеет отдельный бюджет85МиБ. Итоговый текущий замер фиксируется во внутренних материалах.
