# Changelog

## 0.1.7

21 ноября 2026 · Alpha

**Twin перестал быть ревьюером над агентами и стал твоим буквальным двойником: он читает твои реакции на лету, врывается в чат твоим голосом прямо посреди работы и проверяет сделанное своими глазами через `read`, `grep` и `glob`.** Агентная петля освободилась от обязательной бюрократии страниц и научилась параллелить хвост после `context begin`, Twin научился учиться на десяти харнессах сразу (включая память и правила проектов), а правки файлов больше не ломают `UTF-16` и не пишут за пределы песочницы.

### 🔥 Хайлайты релиза

- **Twin теперь настоящий клон, а не судья.** Раньше Twin сидел между Talker и Worker и выносил вердикты по коду задачи. Теперь он копирует именно тебя: учится непрерывно прямо на ходу из каждого твоего сообщения, реакции и раздражения (`twin.observe` в фоне, без единого лишнего запроса к модели в чате), а на финальной проверке сверяет обещанное в саммари с тем, что агенты реально написали в файлах, через базовые `read`, `grep` и `glob`. Если работа ушла не туда, Twin пишет сообщение первым лицом твоим голосом и агенты сразу правят то, что сломали.
- **Twin живьём появляется в треде как 3D-пушистый пузырь.** Его реплики больше не висят в отдельной панели: они приходят прямо в чат с пометкой `actor: "twin"`, а вокруг текста рендерится объёмный rounded-rectangle монстр с реймарченным мехом по контуру в реальном времени на GLSL. Если Twin решил промолчать, в тред не приходит ничего.
- **Twin учится на всём, что у тебя есть.** К девяти прежним источникам добавился **Command Code** (с полной иерархией глобальных и проектных `.commandcode/taste`), а почти каждый импортёр теперь тянет не только сессии, но и сохранённые памяти и правила: `~/.claude/projects/*/memory` и `CLAUDE.md`, `~/.codex/memories` и `AGENTS.md`, `~/.omp` c `mnemopi.db`, CLI/Desktop `kilo.db` (SQLite) плюс IDE-таски, `~/.dsh/memories`, `instruction_entry` у OpenCode, `~/.hermes/memories` и `.flecten/memory.json`. Обучение идёт батчами по ~120 сообщений и ~80 000 символов без искусственных потолков на сессии, сообщения и символы, а профиль вырос с 64 до 200 живых черт.
- **Сдача этапов и критериев одним пакетным шагом.** Обязательный `context begin` перед любой работой, десяток пустых согласовательных ходов и запрет финалить без закрытой страницы ушли в прошлое. `context` с `op: "compact"` сжимает готовый блок, короткие задачи завершаются напрямую без лишнего раунд-трипа, критерии сдаются пачкой `reports` сразу, а рантайм сам привязывает успешные результаты инструментов к критериям с типом `tool_result` вместо того, чтобы заставлять модель выписывать номера вызовов.

### 📈 Сводка боевых замеров: Было -> Стало

В теории:

| Метрика | До улучшений (0.1.6) | После улучшений (0.1.7) | Чистый выигрыш в % | Во сколько раз круче |
| --- | --- | --- | --- | --- |
| Обязательные служебные ходы на страницы контекста | 2 обязательных хода (`begin` перед работой + `complete` после) | 0 ходов у коротких задач, 1 `compact` у многоэтапных | -50%..-100% бюрократии | **Короткая задача финалится сразу** |
| Сдача критериев готовности | 5 отдельных вызовов `criterion`, каждый со своим ID вызова | 1 вызов с `reports` на все 5 пунктов + авто-привязка успешных `tool_result` | -80.0% ходов на приёмку | **В 5 раз быстрее** закрытие пяти критериев |
| Потолок обученного профиля Twin | 64 активных черты и 5 000 хэшей сообщений | 200 черт и 50 000 хэшей без потолка на сессии | +212.5% живого профиля | **В 3.1 раза больше** твоих привычек |
| Потолки одного прогона обучения Twin | 100 сессий / 160 сообщений / 64 000 символов | Батчи ~120 сообщений и ~80 000 символов без потолка на прогон | +25.0% на батч и неограниченный прогон | **Не теряем хвост истории** |
| Батч `context begin` + разведка файлов | Полностью последовательный: `begin`, затем каждое чтение своим ходом | `begin` один раз, вся разведка хвостом в параллель | -75.0% последовательных ходов | **В 4 раза плотнее** старт блока |
| Источники обучения Twin | 9 харнессов, только сессии | 10 харнессов с сессиями, памятью и правилами проектов | +100% типов сигнала | **В 2 раза больше** контекста о тебе |
| Записанный прогон, который оборвался на `max_tokens` | Все вызовы в батче летели в мусор | Полные вызовы исполняются, спасается только обрезанный хвост | +100% полезной работы на обрыве | **Ни одного потерянного** шага |
| Потери кодировки при правке файлов | `UTF-16` файл перезаписывался как `UTF-8` с битым содержимым | Кодировка и `BOM` сохраняются, путь проверяется с учётом симлинков и песочницы | -100% битых файлов | **Файл остаётся собой** |

### 🧠 Главные инженерные победы под капотом

- **Twin как отдельный живой агент, а не кабинетный ревьюер:** `SessionTwinDriver` слушает весь поток событий чата, считает шаги, наполняет доказательную базу и не показывает пользователю свои внутренние вызовы инструментов и размышления. Он врывается на чекпоинтах каждые 2 шага (максимум 2 раза за прогон) и один раз на финальном разборе, сохраняя твой поток внимания чистым.
- **Десять импортёров с честной фильтрацией шума:** Разведка и загрузка жёстко отсекают служебные сессии, внутренние промпты и сабагентов во всех харнессах: Claude `subagents/`, `isSidechain`, `agentId`; Codex `thread_source: "subagent"`, `parent_thread_id`; OMP `parentSession`; Command Code `isMeta`, `isSidechain`, `isAutomated`; OpenCode `parent_id`; Hermes `parent_session_id`; Flecten `_worker`, `internal` и собственные реплики Twin с `actor: "twin"`.
- **Прозрачные ручные инструкции из IDE-диффов:** `twin.teach` записывает урок из кода без единого запроса к модели, а профиль хранится отдельно от памяти проекта в `.flecten/twin.json` (schema v2, атомарная запись), чтобы вкус никогда не подменял проектные факты.
- **Петля без лишних кругов:** Стухший `max_tokens` больше не выбрасывает весь батч вызовов, `run.interrupted` участвует в журнале как настоящая граница прогона, а `stop` отвечает честно, если останавливать было нечего.

### ⚡ Улучшения интерфейса и навигации

- **Выбор модели прямо в обучении Twin.** В разделе источников появились выбор модели обучения, уровня размышлений и варианта с честным предупреждением о стоимости, а активность обучения раскладывается в аккуратный раскрываемый трейс батчей, инструментов и размышлений.
- **Спокойные настройки моделей и словарь в один экран.** Карточки ролей переехали в ровную сетку с явными подписями `Model`, `Reasoning level` и `Model variant`, а словарь получил счётчики источников, обновление с датой синхронизации, пилюли категорий с `+N` и раскрывающиеся определения.
- **Защёлканные диалоги и композер.** Меню, модалки и кнопки `Send -> Stop -> Continue` больше не дёргают вёрстку и не теряют фокус при быстрых повторных кликах.

### 🛠 Исправления

- **Пустые сообщения и потерянный ответ Talker.** После финиша Worker Talker стартует мгновенно, а не после 15-секундной паузы, и сохраняет заглушку вместо финального текста только когда она действительно нужна: ответ пользователю больше не пропадает.
- **Двойная остановка и ложные закрытия сессий.** Повторный `stop` при уже остановленной работе возвращает честный ответ вместо тишины, а журнал больше не считает прогон завершённым, пока живой Worker ещё работает, и корректно переносит это состояние через перезапуск сессии.
- **Каретка, песочница и симлинки при записи файлов.** Терминал теперь корректно ловит маркер завершения команды в новом выводе, а `edit` и `write` проверяют путь с учётом песочницы и симликов, пишут байты через атомарную замену и не портят `UTF-16` и `UTF-8` с `BOM`.
- **Восстановление после падения.** Прерванный прогон помечается как `run.interrupted` только если он действительно возобновлялся, поэтому повторных дублей и ложных записей «interrupted» в истории больше нет.

### 📦 Перед обновлением

- **Linux AppImage и Windows:** С версий `0.1.2` и новее обновление прилетает автоматически через встроенный канал **Beta**. Для версий `0.1.0` и `0.1.1` нужна однократная ручная установка.
- **macOS:** Скачай свежий установщик со страницы релиза. Статус платформенных подписей явно указан в файлах релиза.

[Все изменения относительно 0.1.6](https://github.com/AnnenkovLabs/flecten/compare/v0.1.6...v0.1.7)

## 0.1.6

19 ноября 2026 · Alpha

**Flecten 0.1.6 снимает искусственные потолки контекста, включает нативный AST/BM25 поисковый контур в 100% датасетном формате, ускоряет поиск в боевой песочнице до 100 раз и переводит агентную работу на прямое действие без бюрократии, холостых чтений и потери KV-кэша.** Talker теперь думает с полноценным `reasoning` выбранной модели и отвечает за `0 мс` после завершения работы Worker, интерактивные HTML-дашборды собираются за треть токенов благодаря декларативной авто-гидратации, а Zero-Loss фильтр терминала и кэш слепков теневого Git сокращают шум и паузы при разработке в 3-3.5 раза.

### 🔥 Хайлайты релиза

- **Снайперский AST/BM25 поиск вместо слепого перебора строк.** Обычный текстовый поиск заваливал агента сотнями совпадений из тестов и документации или возвращал пустоту на запросах из 2-3 слов. Новый контур ранжирования (формулы Semble, Probe и Tilth) раскладывает `camelCase` и `snake_case` на смысловые подтокены, поднимает реальные определения функций, классов и типов в `src/` на самый верх выдачи (`3x-4.5x` буст), пессимизирует тесты и документацию (`0.3x`), гасит шум из одного файла (`0.5^excess`) и для топ-3 найденных определений сразу разворачивает компактное тело функции в родном для весов модели формате `ripgrep`. А если точная регулярка не дала совпадений, нативный предфильтр `ripgrep` + Okapi BM25 за 20-35 мс находит самые плотные точки пересечения терминов по всему репозиторию.
- **Прямой переход `Поиск -> Правка`, умные границы чтения и Tail-Only защита KV-кэша.** Файлы, увиденные агентом в поиске, прочитанные при построчном срезе длинных строк или изученные дочерними сабагентами (`explore` / `implement`), сразу регистрируются в общей памяти прочитанных файлов: агент больше не тратит холостые ходы на повторное чтение перед правкой. При чтении крупных файлов окно автоматически дотягивается на `+-15 строк` до границ целой функции и показывает карту оставшихся символов с точными строками `(Lstart-end)`, при промахе по отступам ошибка сразу содержит 15 эталонных строк вокруг цели, а сессионная дедупликация отсекает повторный показ уже виденных тел функций на хвосте без единой мутации прошлых сообщений и со 100% сохранением KV-кэша.
- **Полное окно контекста (200k-1M), думающий Talker с откликом 0 мс и 100% датасетная чистота.** Сняты искусственные зажимы рабочего окна (`32k` у Talker и `96k` у Worker) и жёсткие потолки на вывод инструментов с делением бюджета на число параллельных вызовов. Файлы, результаты поиска и вывод терминала больше не оборачиваются в синтетические плашки `## Untrusted data` и 15 строк пустых метаданных (обёртка осталась только для реального внешнего мира: веб и внешние серверы), а подсказки словаря добавляются в хвост без поломки KV-кэша (~90% попаданий в кэш провайдера). Talker наследует модель, `reasoning` и `variant` напрямую из выбора пользователя в поле ввода, запускается за `0 мс` после финиша Worker (убран 15-секундный троттлинг), а Worker за `0 токенов` в режиме `peek` мгновенно подсматривает живой диалог с пользователем без лишних запросов к модели.
- **Разблокированный нативный `ripgrep` в песочнице, быстрый теневой Git и сдача этапов за 1 ход.** Поиск кода и файлов при активных правилах безопасности больше не падает в медленный однопоточный обход, а всегда летает на нативном `ripgrep` (25-40 мс вместо 2-10 секунд) с точечной проверкой прав по результатам. Слепки рабочего дерева для `/undo` вокруг терминальных команд переиспользуют горячий кэш предыдущего шага (вдвое меньше пауз Git). Разведка на старте идёт свободно без обязательного открытия страницы, открытие логической страницы объединяется в один батч с первыми действиями, а закрытие всех критериев готовности, завершение страницы и финальный отчёт проходят одним пакетным шагом.
- **Zero-Loss фильтр терминала и декларативные интерактивные HTML-дашборды за 35% токенов.** Вывод команд в терминале честно эмулирует перезапись строки кареткой `\r` (схлопывая прогресс-бары скачивания и сборки в финальную строчку) и при падении тестов сворачивает длинные списки зелёных проверок, сохраняя 100% текста ошибки и стектрейса буква в букву. А финальные интерактивные HTML-отчёты с вкладками, карточками метрик, полосками прогресса и кнопками выбора теперь собираются из коротких однострочных декларативных атрибутов с авто-гидратацией в UI и поддержкой жирного шрифта в обычных ответах Talker.

### 📈 Сводка боевых замеров: Было -> Стало

В теории:

| Метрика | До улучшений | После улучшений (0.1.6) | Чистый выигрыш в % | Во сколько раз круче |
| --- | --- | --- | --- | --- |
| Скорость поиска кода и файлов при активной песочнице | 1 500 - 10 000 мс (однопоточный обход) | 25 - 40 мс (нативный `ripgrep` + пост-фильтр прав) | -98.0% времени ожидания поиска | **В 40-100 раз быстрее** каждый поиск |
| Рабочее окно контекста и параллельные чтения | Зажато до 32k / 96k + деление лимита на батч и срез из середины | Полное окно модели (200k-1M) без деления на батч и без ложных обрезаний | +100%..+500% доступного окна | **В 2.5-6 раз больше** живого кода в памяти |
| Пауза перед ответом Talker после финиша Worker | До 15 000 мс искусственного троттлинга между активностями | 0 мс (мгновенный старт ответа Talker по готовности) | -100% мёртвого ожидания ответа | **Мгновенный отклик** сразу после работы |
| Попадание в провайдерский KV-кэш (Cache Hit Rate) | Сброс префикса из-за вставки словаря 2-м сообщением и мусорных шапок | ~90% попаданий (чистый датасетный формат + словарь в хвосте + Tail-Only дедупликация) | +20%..+35% экономии на обёртках | **В 3.5-5 раз дешевле** входные токены |
| Поисковые шаги до выхода на точку правки | 4 - 6 шагов (шум из `tests/` и пустые ответы на запросах из 2-3 слов) | 1 шаг (определения наверху + авто-тело топ-3 + `rg`-BM25 по подтокенам) | -80.0% холостых поисковых ходов | **В 4-5 раз быстрее** локализация кода |
| Холостые чтения перед правкой и при промахе отступов | Обязательное чтение после поиска/сабагента и 2 хода на ретрай правки | Прямая правка после поиска/сабагента и 15 строк авто-прицела в ошибке | -100% дублирующих чтений перед правкой | **С 3 ходов до 1 хода** на цикл правки |
| Терминальный шум при падении тестов и сборки | 40 - 120 КБ `\r`-прогрессов, шапок метаданных и сотен зелёных проверок | 1 - 2.5 КБ чистого стектрейса и блока падения без потери деталей | -95.0% мусора из вывода терминала | **В 20-40 раз чище** фидбек от тестов |
| Накладные расходы теневого Git (`/undo`) на серию команд | 2 полных сканирования дерева на каждую команду (3-5 с) | Переиспользование горячего слепка между командами с инвалидацией при записи | -50.0% пауз между командами терминала | **В 2 раза быстрее** серии запусков |
| Служебные раунды на логические страницы и сдачу критериев | 5 - 7 одиночных ходов на старт страницы и поштучную сдачу пунктов | Свободная разведка + 1-2 пакетных хода для всех критериев и финала | -71.4% бюрократических раунд-трипов | **В 3.5 раза меньше** служебных шагов |
| Выходные токены на интерактивный HTML-дашборд | 900 - 1 500 токенов ручной вёрстки вкладок, баров и скриптов | 300 - 500 токенов с декларативной авто-гидратацией | -65.0% выходных токенов на вёрстку | **В 2.5 раза быстрее** отрисовка отчёта |
| Страничное и блочное сжатие рабочего контекста сессии | 100k - 120k токенов сырых файлов, дублей, обёрток и логов | 15k - 20k токенов чистого 100% датасетного кода | -83.3% объёма рабочего контекста | **В 5-6 раз легче** окно внимания модели |
| **ОБЩИЙ ИТОГ по скорости, стоимости и точности агента** | Зажатый, зашумлённый конвейер с потерей кэша и бюрократией | Чистый датасетный контекст, думающий Talker, снайперский поиск и 100% KV-кэш | **Комплексное ускорение и сжатие цикла** | **Общий буст работы агента в 3 - 3.5 раза** 🚀 |

### 🧠 Главные инженерные победы под капотом

- **100% родной датасетный формат без выхода из распределения весов (In-Distribution):** Вычищены искусственные обёртки вокруг чтения локальных файлов, поиска и терминала, а также обрезка файлов из середины, из-за которой модели теряли структуру кода. Вся математика ранжирования, Okapi BM25, выравнивание срезов по границам функций и дедупликация работают прозрачно, отдавая модели канонический вид `path:line: код` и `N: строка`.
- **Полноценное мышление Talker и бесшовный мост с Worker:** Talker больше не принуждается к отключённому размышлению (`reasoning: "none"`), умеет настраивать уровень размышлений в настройках моделей и запускает Worker без хрупких падений на перефразированных ограничениях пользователя, а Worker видит весь живой чат за 0 токенов.
- **Параллельное чтение без глобальной пробки:** Вызовы чтения и поиска в одном батче с правками больше не выстраиваются в общую блокирующую очередь позади пишущих инструментов, а сабагенты напрямую делятся прочитанными файлами с родительским Worker.
- **Неубиваемая сдача критериев после подруливания (`steer`) и ревизий Twin:** История проверок больше не стирается в ноль при уточнении задачи на ходу, система принимает как нативные провайдерские, так и внутренние идентификаторы вызовов (плюс резолв по имени инструмента или последней проверке) и сама выводит список доступных успешных проверок прямо в напоминании.

### 🛠 Исправления

- **Авто-прицел на 15 строк при промахе в `edit`.** Если агент ошибся в отступах или окружающих строках, текст ошибки сразу возвращает 15 реальных пронумерованных строк файла вокруг ближайшего совпадения, позволяя закрыть правку следующим же ходом без повторного вызова `read`.
- **Устранение мёртвых петель при сдаче задачи после `steer`.** Исправлена ошибка, из-за которой после вмешательства пользователя или ревизии Twin стиралась таблица результатов инструментов и перезаписывались идентификаторы вызовов, что приводило к отклонению валидных проверок.
- **Стабильность миграции хранилища и платформенных проверок на Windows и macOS.** Повышена надёжность восстановления прерванной миграции хранилища, очистки временных директорий на Windows и проверки упакованных сборок.

### 📦 Перед обновлением

- **Linux AppImage и Windows:** С версий `0.1.2` и новее обновление прилетает автоматически через встроенный канал **Beta**. Для версий `0.1.0` и `0.1.1` нужна однократная ручная установка.
- **macOS:** Скачай свежий установщик со страницы релиза. Статус платформенных подписей явно указан в файлах релиза.

[Все изменения относительно 0.1.5](https://github.com/AnnenkovLabs/flecten/compare/v0.1.5...v0.1.6)

## 0.1.5

18 ноября 2026 · Alpha

**Обновлённый агентный харнесс Flecten тратит в 3.52 раза меньше незакэшированных токенов, ошибается в 4.33 раза реже и позволяет живо общаться с Talker прямо во время работы Worker.** Интерактивные HTML-ответы передают твой выбор обратно в диалог в один клик, а обновление встроенного ядра и десктопной оболочки закрыло критические RCE, 1-day и XSS/MITM-векторы и ускорило холодный старт.

### 🔥 Хайлайты релиза

- **Живой диалог с Talker без остановки Worker.** Больше не нужно сидеть перед спиннером или жать Stop, чтобы уточнить деталь: пиши напрямую Talker, пока Worker выполняет тяжёлую задачу в фоне, или откладывай сообщения через **Queue** на следующий этап. Если у самого Worker возникнет вопрос по задаче, он сначала спросит Talker по уже обсуждённому контексту чата, не дёргая тебя по пустякам.
- **Интерактивные HTML-ответы с прямой обратной связью.** Визуальные отчёты, таблицы, карточки вариантов и дашборды внутри чата перестали быть статичной картинкой: кликай по вариантам прямо в отчёте, чтобы прикрепить выбор к следующему сообщению или отправить решение агенту мгновенно одной кнопкой.
- **Кратное ускорение и удешевление агентной работы.** Залповая разведка файлов, сквозные якоря в многофайловых патчах, липкий кэш провайдера и пакетное ведение списка задач радикально сократили число холостых шагов, стоимость прогона и количество сбоев на сложных инженерных задачах.

### 📈 Сводка боевых замеров: Было -> Стало

Мы провели 24 чистых прогона на модели `gpt-6.2-sol` (12 на базовой версии и 12 на обновлённом харнессе) через параллельный шлюз с защитой от превышения лимитов.

В теории:

| Метрика | До улучшений (База) | После улучшений | Чистый выигрыш в % | Во сколько раз круче |
| --- | --- | --- | --- | --- |
| Незакэшированные токены на прогон | 268 090 токенов | 76 171 токен | −71.6% мусорных входных токенов | **В 3.52 раза меньше оплаты** за свежие токены |
| Общие входные токены на задачу | 351 375 токенов | 127 755 токенов | −63.6% нагрузки на контекст | **В 2.75 раза легче** контекстное окно |
| Доля попадания в кэш (Cache Hit Rate) | 23.7% в среднем | 40.4% (в пике до 78.1%) | +70.5% к эффективности кэширования | **В 1.7 раза чаще** попадаем в горячий кэш |
| Лишние шаги агента (Turns на задачу) | 11.08 ходов | 7.67 ходов | −30.8% лишних шагов | **В 1.45 раза быстрее** финиш по раундам |
| Ошибки и затыки инструментов | 3.25 сбоя на прогон | 0.75 сбоя на прогон | −76.9% трения инструментов | **В 4.33 раза меньше** сбоев и откатов |
| Стабильность прохождения 3 из 3 (`pass^3`) | 0.0% | 25.0% (на сложных задачах 100%) | +25 процентных пунктов надёжности | **С нуля до железобетонного** прохождения |
| Средний балл по критериям (Check Score) | 48.6% | 58.3% | +20.0% к глубине решения | **Качественнее закрывает** краевые случаи |
| Сжатие статического системного промта | 20 463 токена | 14 266 токенов | −30.3% постоянного балласта | **Экономит токены** на каждом первом ходе |

### 🧠 Главные инженерные победы сессии

- **Смерть холостых шагов и очередей чтений:** За счёт включения параллельных вызовов на уровне транспорта и перевода агента на залповую разведку мы превратили 16 унылых шагов чтения по одному файлу в 2 плотных хода, где модель видит всю картину сразу.
- **Атомарные правки без поломок:** Патчер научился сквозным контекстным якорям. До этого 100% попыток накатить многофайловый патч падали с ошибками, заставляя модель метаться и переписывать файлы целиком. Теперь сбои патчей упали до нуля.
- **Липкий кэш провайдера:** Добавление заголовков привязки сессии и вынос динамических переменных окружения в хвост промта зафиксировали первые 14 000 токенов неподвижными. Кэш взлетел с 23% до 78% на связных этапах.
- **Снятие бюрократии:** Списки задач и критерии приёмки теперь создаются и закрываются едиными пакетами в одно касание вместо десятка пустых согласовательных ходов.

### 🛡 Зачистка RCE, 1-day и побегов из песочницы: что и с какой версии обновили

Мы обновили вшитый рантайм агента, десктопный движок Chromium/Electron, санитайзер HTML и цепочку сборки, закрыв свежие критические и 1-day уязвимости:

| Компонент | Было (0.1.4) | Стало (0.1.5) | Какие RCE / 1-day / критические уязвимости закрыты | Что изменилось у тебя на практике |
| --- | --- | --- | --- | --- |
| **Встроенное ядро агента (Bun)** | `1.4.2` | `1.4.4` | **CVE-2026-111497 (Memory Corruption / RCE-примитив в Brotli):** запись за границы буфера (out-of-bounds write) в C-декодере Brotli при распаковке любого HTTP-ответа с `Content-Encoding: br` через `fetch()`.<br>**GHSA-26q8-h657-pf84 (High, TLS MITM):** вырезаны 8 скомпрометированных сертификатов `eMudhra / emSign`, чьи приватные ключи утекли в паблик и позволяли перехватывать и подменять любой HTTPS-трафик.<br>**GHSA-cf8x-9m69-3gg3 (High, Header Accordions DoS):** закрыта 1-day атака QPACK-амплификации в HTTP/3, где один пакет в 20 КБ вешал CPU на 100% или выжирал 2 ГБ RAM. | Агент защищён от подмены HTTPS-трафика провайдеров и эксплойтов при чтении сжатых веб-ответов. Сам бинарник ядра стартует быстрее (до первого статуса ~`1044 мс`), а движок JavaScriptCore и `Bun.SQL` тратят до 48% меньше CPU. |
| **Десктопная оболочка (Electron / Chromium / V8 / Node)** | `Electron 45.0.0`<br>(`Chromium 156.0.8078.47`, `Node 24.22.1`) | `Electron 45.3.4`<br>(`Chromium 156.0.8078.100`, `V8 15.6.75.57`, `Node 24.22.3`) | **RCE через обход File System Access (`#55329`):** закрыта дыра, позволявшая обойти блоклист и записать исполняемый пейлоад напрямую в `.git/hooks` или сетевые UNC-шары гипервизора (`vmware-host`, `vboxsvr`, `psf`) для выполнения произвольного кода при следующем `git`-действии.<br>**65+ 1-day бэкпортов безопасности Chromium, V8, Skia, Dawn и ANGLE (`#55491`, `#55708`, `#55747`):** закрыты Use-After-Free (UAF) в `MediaStream`, `WebMediaPlayerMS` и `PostMessageSupport` (эксплойты памяти рендерера), баги JIT-компилятора V8 (`Maglev` / `TurboFan` / `Turboshaft`), подмена origin через `about:blank` и скомпрометированные сертификаты `eMudhra` (`#55742`). | Любой внешний контент, отчёты и предпросмотры рендерятся в пропатченной песочнице Chromium без риска тихой записи в `.git/hooks` твоего репозитория. Убрана утечка памяти при контекстных кликах и ускорен локальный `net.fetch()`. |
| **Санитайзер HTML и рендер чата (DOMPurify, Marked, Mermaid, TipTap)** | `dompurify 3.4.17`<br>`marked 18.1.1`<br>`mermaid 12.2.0`<br>`@tiptap/* 3.33.0` | `dompurify 3.4.18`<br>`marked 18.2.1`<br>`mermaid 12.3.0`<br>`@tiptap/* 3.34.0` | **GHSA-qm7q-q8h9-jg8q (DOMPurify XSS / Arbitrary JS Execution):** обход `SAFE_FOR_TEMPLATES` через вложенные `<form>` и осиротевшие закрывающие теги, когда после очистки и повторного парсинга `innerHTML` осколки текста склеивались обратно в боевой шаблон `{{constructor.constructor(...)()}}`, плюс закрыто загрязнение белого списка тегов через хуки. | Полная защита от выполнения вредоносного JS, когда модель анализирует чужие репозитории, дампы или логи с XSS-пейлоадами и выводит их в чат, Markdown, Mermaid-схемы или интерактивные HTML-карточки. |
| **Сетевой стек, упаковка и компилятор (Undici, Minimatch, Tar, Vite, TS)** | `undici 7.30.1`<br>`minimatch 11.0.8`<br>`tar 7.5.22`<br>`vite 8.3.5`<br>`typescript 6.0.3` | `undici 7.30.2`<br>`minimatch 11.0.9`<br>`tar 7.5.23`<br>`vite 8.3.8`<br>`@typescript/native 7.0.2` | **CVE-2026-116592 / GHSA-mqg3-3v4r-cm32 (High, CVSS 7.4 в Undici):** отравление HTTP-кэша и утечка приватных ответов через промежуточные редиректы (обход неполного патча `CVE-2026-109829`).<br>**GHSA-cf2h-pxjq-68xw, GHSA-c859-jr93-m5j4, GHSA-hqmv-qgp3-jx75 (Minimatch):** исчерпание памяти в кэше паттернов и обход экранирования.<br>**Supply-chain защита CI:** все 5 внешних GitHub Actions (`checkout v7.0.1`, `setup-bun v2.2.0`, `cache v6.1.0`, `upload-artifact v7.0.2`, `download-artifact v8.0.2`) намертво прибиты по SHA-хэшам коммитов. | **Пользователям десктопа ничего ставить вручную не нужно:** ускоренный и защищённый движок уже вшит внутрь установщика. А для тех, кто собирает Flecten из исходников (`Bun 1.4.4+`, `Node.js 22.12+`), проверка типов через нативный компилятор `TypeScript 7.0.2` ускорилась **в 6 раз (`11.32 с -> 1.89 с`, −83.3% времени)**. |

### ⚡ Улучшения интерфейса и навигации

- **Контекстная пластика и морфинг кнопок.** В композере кнопка **Send -> Stop -> Continue** плавно меняет контур на месте через `MorphIcons` и всегда остаётся под курсором, пока слева от неё раскрываются **Queue** и **Steer**. Размытие фона в диалогах плавно нарастает и уходит, а меню раскрываются ровно от своей кнопки.
- **Свободный порядок проектов и мгновенный архив чатов.** Перетаскивай папки проектов в боковой панели в удобном порядке, а старые ветки открывай из отдельного компактного выдвижного списка, не разворачивая длинное дерево истории всего проекта.
- **Каменная стабильность фокуса и контролов.** Меню выбора модели, модальные окна настроек, тултипы и кнопки композера больше не дёргают вёрстку и не теряют фокус клавиатуры при быстрых повторных кликах или смене состояния задачи.

### 🛠 Исправления

- **Защита от оборванных вызовов и умные подсказки при правках.** Если поток провайдера обрывается на лимите токенов посреди вызова пишущего инструмента, Flecten блокирует повреждённую запись до изменения файла. При несовпадении фрагмента в `edit` агент сразу получает точную подсказку (например, о случайно захваченных номерах строк) и исправляет вызов за один ход.
- **Строгая изоляция чатов при параллельной работе.** Живые уточнения для Talker, сообщения из очереди и клики в интерактивных HTML-отчётах жёстко привязаны к своему чату и не пересекаются при быстром переключении между активными задачами.

### 📦 Перед обновлением

- **Linux AppImage:** С версий `0.1.2` и новее обновление прилетает автоматически через встроенный канал **Beta**. Для версий `0.1.0` и `0.1.1` нужна однократная ручная установка.
- **Windows и macOS:** Скачай свежий установщик со страницы релиза, если твоя текущая сборка ещё не обновляется изнутри приложения. Статус платформенных подписей явно указан в файлах релиза.

[Все изменения относительно 0.1.4](https://github.com/AnnenkovLabs/flecten/compare/v0.1.4...v0.1.5)

## 0.1.4

November 17, 2026 · Alpha

**Inspect Worker progress, blockers, and verification evidence in real time while a task is running.** Talker and Worker can now run on separate models, with all role costs aggregated into a single per-chat total.

### ✨ New

- **Dedicated Worker activity feed.** Open the `Worker` tab to inspect executed commands, errors, and permission prompts. Every task checklist item shows whether it is resolved and why, separating runtime-verified command outputs from model self-assessment. Refining the task prompts Worker to re-verify which completed items still hold.
- **Per-role model configuration.** Configure separate models for the primary agent, Talker, Worker, subagents, and vision helper in **Models**. The composer model picker sets the active chat's executor, letting Talker stay on a fast lightweight model while Worker handles heavy execution.
- **Unified per-chat spend counter.** Total chat cost aggregates Talker turns, Worker execution, subagents, Twin, and auxiliary calls across restarts. When a provider omits usage receipts, the UI explicitly marks the total as incomplete.
- **Provider secret protection.** Known API key and password formats are replaced with reversible placeholder tags before context leaves the machine, while file writes and shell commands require confirmation. The provider's own connection API key is still sent to authenticate requests. See [Provider Protection](https://github.com/AnnenkovLabs/flecten/blob/v0.1.4/docs/PROVIDER-PROTECTION.md).
- **Artifact-backed build verification.** Agents can declare expected output archives or reports for a command; Flecten verifies file existence, size bounds, and optional checksums before marking the check green.

### ⚡ Improvements

- **Seamless chat and draft restoration.** Relaunching reopens the last active chat. Unsent text, `@` mentions, and attachment lists persist independently per chat and workspace.
- **Crash-resilient Worker state.** Worker persists partial progress, its last confirmed action, and stop reasons across crashes. When a remote Linux job disconnects, Flecten inspects remote process state before re-running it.
- **Compact completed stages.** Finished Worker pages compress into structured summaries with outcomes and evidence links for subsequent model turns while archiving full transcripts on disk. Nested directory instructions load on demand as files inside them are touched.
- **Chunked reads for large files and directories.** The `read` tool can resume mid-line on very long lines, the file explorer warns when directory listings are truncated, and terminal/background-job scratch files stay scoped to their chat.
- **Sharper keyboard navigation for menus and tooltips.** Closing a menu restores focus cleanly; tooltip copy is selectable and dismisses on `Esc`.
- **Interruptible Twin training.** Disabling Twin mid-import halts ingestion immediately while preserving traits already learned and keeping Twin disabled across restarts.

### 🛠 Fixes

- **Windows:** Fixed a first-launch directory-creation hang and a false storage-migration conflict when Windows resolved the same path via 8.3 short names and full names.
- **macOS:** Fixed SSH agent socket connections (including symlinked sockets) and restricted remote jobs strictly to required connection credentials.
- **Providers:** Quota exhaustion on one model no longer blocks switching to sibling models with remaining quota. Truncated OpenAI Chat tool-call streams no longer execute incomplete commands.
- **Persistence and permissions:** Event-log, config, and queue write failures now surface immediately. Session grants no longer leak into forked chats or survive security policy edits.

### 📦 Before Updating

- **Windows and Linux AppImage:** Versions `0.1.2`+ update automatically via the built-in **Beta** channel. Versions `0.1.0` and `0.1.1` require a one-time manual install.
- **macOS:** Download the Intel or Apple Silicon installer manually until Apple Developer ID signing is configured.
- **First launch with existing `.liquid` data:** Flecten verifies and migrates chats, attachments, memory, and checkpoints from `.liquid` to `.flecten` behind a dedicated confirmation screen while leaving original files untouched on disk. Interrupted migrations resume cleanly, and any conflicts display the exact backup paths.

[Full diff from 0.1.3](https://github.com/AnnenkovLabs/flecten/compare/v0.1.3...v0.1.4)

## 0.1.3

November 15, 2026

**Message branching, per-chat model selection, and stricter Twin learning.** Edit prior prompts without losing earlier branches, tailor models per conversation, and scale the desktop UI to fit your display.

### Edit and Branch Conversations

- **Edit prior messages directly in the composer.** Modify prompt text and attachments to branch the conversation from any point while keeping your unsent bottom draft separate and intact.
- **Switch freely between conversation branches.** Version switchers on edited messages restore the full downstream branch across restarts and feed the selected branch to the model.
- **Reuse persisted attachments across edits.** Keep, remove, or add files when editing a message; existing attachments hydrate from session storage even if the original source file was deleted from disk.
- **Locked history during active execution.** Editing and branch switching remain disabled while a run is in flight so active model context never mutates mid-turn.

### Per-Chat Model Selection

- **Independent model, reasoning, and variant per chat.** Switching tasks restores each chat's chosen model without altering global defaults for new chats; in-flight requests finish on the model that started them.
- **Generation-free model metadata lookup.** Adding or editing a model populates capabilities, context limits, and supported parameters from provider APIs and the built-in catalog without spending tokens on test completions.
- **Optional hourly model auto-refresh.** Enable automatic catalog refresh per provider while preserving manual capability overrides by default (with opt-in overwrite); edits saved while a refresh is in flight take precedence.
- **Offline provider setup.** Save provider URLs and API keys without a live connectivity check, then configure models manually with explicit wire-protocol selection.
- **Stricter model identity matching.** Catalog resolution accounts for canonical IDs and fine-tuned derivatives while preserving version/checkpoint distinctions and prioritizing live provider API metadata.

### More Reliable Twin Learning

- **Schema- and quote-verified trait updates.** Twin accepts raw or fenced JSON, validates every field, and verifies exact source quotes against real user messages so truncated completions or hallucinated quotes never corrupt the persona profile.
- **Atomic profile updates.** Traits, revisions, and processed-message cursors commit only after durable disk writes succeed, allowing re-imports to retry failed batches cleanly.
- **Stale-update protection on cancel or workspace switch.** Late model responses or polling ticks after disabling Twin or switching projects are discarded, and empty imports report explicitly when no new messages exist.

### Workspace Ergonomics

- **Interface zoom from 75% to 125%.** Scales typography, controls, and thread layout immediately via window profile settings, with one-click reset to `100%`.
- **Quick profile rename and settings in the sidebar.** Edit your profile name directly from the sidebar footer, with header settings fallback when the sidebar is collapsed or in IDE mode.
- **Expanded technical dictionary.** Added categories covering models, agents, benchmarks, MCP, web, CSS, infrastructure, mobile platforms, and product terms; remote updates extend built-in entries without overwriting project-local definitions.
- **Clean-slate module marketplace.** Removed bundled demo modules and implicit repository seeding while retaining custom HTTPS catalog feeds and installed-package management.

### Installation and Updates

**Linux AppImage and Windows builds on `0.1.2` can update in-app via the Beta channel** using the pinned Ed25519 key. Versions `0.1.0` and `0.1.1` still require a one-time manual upgrade, and macOS installs remain manual pending Apple Developer ID signing.

[Full diff from 0.1.2](https://github.com/AnnenkovLabs/flecten/compare/v0.1.2...v0.1.3)

## 0.1.2

November 15, 2026

**Signed GitHub updates, multi-project sidebar navigation, and unified access controls.** Streamlines everyday workspace switching and establishes Ed25519-verified auto-updates for subsequent alpha builds.

### Signed Updates from GitHub

- **Automatic alpha discovery on `beta`.** Default update channel is now `beta`, checking 10 seconds after launch and every 4 hours thereafter with exponential backoff on network errors.
- **Non-disruptive background downloads.** Updates download with live progress without interrupting active runs; apply via one-click restart or automatically on quit.
- **Pre-download Ed25519 verification.** Channel manifests are signed in CI and verified against a build-pinned Ed25519 public key, binding version, byte size, and SHA512 checksum before any installer runs. Unsigned or tampered metadata is rejected.
- **Configurable update source and behavior.** Choose channel, GitHub repository or custom HTTPS feed, auto-check, auto-download, and install-on-quit in **About**, applied immediately without restarting.
- **Downgrade protection.** Channel switches never install an older version over a newer build, even when validly signed.
- **Retroactive install-on-quit.** Toggling install-on-quit after an update has already been downloaded and verified applies immediately to the cached installer without re-downloading.

### Projects and Tasks in the Sidebar

- **Start immediately without picking a folder.** Launching without a workspace opens an isolated `projectless` directory inside the profile, keeping chats, attachments, and memory separate from code repositories.
- **Multi-project sidebar.** Switch across saved folders and their threads from one tree, restoring the last workspace on restart; removing a folder from the sidebar leaves its files and session logs untouched on disk.
- **Single-instance focus handoff.** Launching a second app instance focuses the existing window and exits before mutating the project index.
- **Explicit workspace trust.** Entering a new folder prompts for trust (`trusted` vs `untrusted`), disabling project-local executable extensions when untrusted while keeping built-in tools working.
- **Unified global desktop profile.** Providers, models, permissions, sandbox rules, and extensions now live in one profile config, migrating legacy per-project settings non-destructively while honoring explicit `FLECTEN_CONFIG` overrides.

### Unified Access and Approvals

- **Access mode selector.** Switch among `Agent`, `Confirm`, and `Full access` to coordinate permission rules and OS sandboxing while keeping custom path rules, protected paths, and mandatory human checkpoints intact.
- **Chat-scoped external folder grants.** Approving an external directory updates both tool authorization and OS sandbox writable roots for the active chat without prompting per file, re-checking revocations prior to execution.
- **Docked approval cards above the composer.** Pending approvals in both Agent and IDE modes display target actions, reasons, and decision buttons above the input, recording receipts in history and resuming execution cleanly.
- **Consolidated Access settings.** Permissions, saved rules, mandatory checkpoints, and sandbox configuration now share the **Access** tab (with legacy sandbox deep links routed automatically).

### Smoother Run Control

- **One-click Continue from the composer.** Resume stopped runs via the `Continue` button or by pressing Send on an empty input while keeping normal message send behavior when text or attachments are present.
- **Debounced run-state transitions.** Guarded transitions across `Stop`, `Force stop`, and `Continue` prevent accidental double-click races, and late responses remain bound to their originating chat and run epoch.

### Build-Once Release Pipeline

- **Parallel CI verification and packaging on `main`.** Releases promote pre-built, smoke-tested artifacts without rebuilding or re-running E2E suites at publish time.
- **Commit-bound release integrity.** Publishing verifies CI provenance, version tags, Ed25519 signatures, file sizes, and checksums; network retries resume draft uploads without overwriting published assets.

### Before Installing

**Upgrade manually once from `0.1.0` or `0.1.1` to `0.1.2`.** Earlier builds lack the pinned Ed25519 verification key and cannot accept signed auto-updates. From `0.1.2` onward, Linux AppImage and Windows builds update in-app on the **Beta** channel (explicitly selected **Stable** channels do not auto-switch). macOS installers remain unsigned and require manual installation until Apple Developer ID certificates are configured.

[Full diff from 0.1.1](https://github.com/AnnenkovLabs/flecten/compare/v0.1.1...v0.1.2)

## 0.1.1

November 14, 2026

**Shared cross-project settings, interactive Twin training, and Windows/runtime reliability fixes.**

### Configure Once Across Projects

- **Global provider and model profile.** Providers, API keys, and model selections persist across workspaces in the shared app profile while permissions, sandbox settings, MCP servers, hooks, and extension trust stay project-scoped.
- **Non-destructive config migration.** First launch imports existing provider settings and destination-bound keys without deleting legacy files; explicit `FLECTEN_CONFIG` paths continue to run isolated.

### Live Twin Training

- **Interactive phrase cards during history import.** Twin tracks, catches, and reacts to real redacted snippets from imported chats continuously across batches without resetting the WebGL scene.
- **Core-driven training progress.** Progress counters reflect verified backend ingestion (`100%` appears only on completion), supporting pause, cancel, and `prefers-reduced-motion`.
- **Ephemeral redacted previews.** Training card snippets strip known secrets before rendering and are never persisted into the Twin persona file.

### Stable Scroll, Timers, and Thread State

- **Smart streaming auto-follow.** Virtualized message loading no longer breaks bottom auto-follow, while scrolling up detaches cleanly so incoming tokens and dynamic HTML summary resizes never yank your reading position down.
- **Preserved reading anchors across long threads.** Search highlights and deferred height measurements no longer shift scroll position when switching chats.
- **Accurate elapsed and reasoning timers.** Active timers tick continuously while awaiting completions, reconstruct exact durations from event timestamps on chat reopen, and freeze once finished.
- **Reliable HTML summary updates.** Fixed stale iframe rendering when a replacement HTML document had greater or equal byte length.
- **Isolated Mermaid SVG IDs.** Multiple Mermaid diagrams in the same thread now namespace their internal SVG defs so markers and arrows never collide across messages.
- **Chat-isolated late IPC replies, single-shot modal focus restore, and atomic queue item removal** (in-flight messages can no longer be deleted mid-send).

### Startup, Recovery, and Tooling Hardening

- **Windows:** Fixed startup hang when the secrets file is absent; added bounded 1-second atomic-rename retries under transient file locks; preserved quoted paths/special characters in `cmd.exe` commands, background jobs, and hooks; framed ConPTY command completion with explicit exit codes across `cmd.exe` and PowerShell; canonicalized 8.3 short vs long paths inside sandbox checks while flushing attachments via syncable file descriptors; normalized path separators for nested `.gitignore` rules in `glob` and `grep`.
- **Studio approvals:** Bound `Allow once` confirmations to exact request IDs so brief reads and writes resume reliably.
- **Tolerant JSONL recovery:** New events append cleanly on a fresh line after a truncated tail record, preserving last-run state and interruption markers during index rebuilds.
- **Epoch-scoped sidecar stdio and lock handling:** Restarted sidecars ignore late output from superseded processes, and workspaces locked by another window surface the error once instead of crash-looping.
- **Process-tree and Git shadow cleanup:** macOS run cancellation tracks detached child processes via environment markers, and app shutdown awaits background shadow-Git indexing and checkpoint pruning before releasing workspace locks.
- **Terminal output retention and post-checkpoint cancellation:** Fixed lost leading command output after ANSI stripping or scrollback trimming, and re-checked `AbortSignal` immediately after checkpoint creation so cancelled `write`, `edit`, `apply_patch`, `delete`, and `move` calls abort before mutating files.
- **Provider rate-limit metadata, SSE line endings, and MCP redirect safety:** Surfaced HTTP status, reset timestamps, and quota headers to adapters; supported split `LF`/`CR`/`CRLF` boundaries in SSE streams; blocked cross-redirect MCP request forwarding while closing SSE streams on handler errors.

### Leaner Model Context

- **Focused system prompts.** Removed duplicated tool-schema field prose and unused prompt templates while preserving role boundaries, trust rules, and completion contracts.
- **Removed built-in `git` and `lsp` tools (18 built-in tools total).** Git runs directly via terminal tools, and legacy `lsp` config sections strip cleanly during migration.

### Releases and Packaging

- **Automated GitHub Pre-releases.** CI drafts release notes from `CHANGELOG.md`, runs verification and builds, and attaches Linux, Windows, and dual-architecture macOS (`x64` + `arm64`) installers, blockmaps, SBOMs, and checksums (leaving failed builds as unpublished drafts).

### Before Updating

Flecten remains in alpha. In-app auto-updates require Ed25519-signed channel metadata plus Apple Developer ID signing on macOS; shipping an installer alone does not imply auto-update signing is active.

[Full diff from 0.1.0](https://github.com/AnnenkovLabs/flecten/compare/v0.1.0...v0.1.1)

## 0.1.0

November 13, 2026

**First public alpha of Flecten:** a desktop coding harness pairing a Bun sidecar core, Svelte 5 UI, and Electron shell (incorporating all prior pre-release work).

### Workspace

- Unified Agent and IDE modes per task with CodeMirror editor, diff viewer, run history, interactive terminal, and dirty-buffer protection during agent edits.
- Split Talker and Worker roles over a shared event log, alongside Twin user-preference modeling, project memory, and technical term dictionary.
- Four provider protocols (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini) with catalog import, connectivity probes, auth refresh, and model failover.
- Seven UI locales, sandboxed live HTML summaries, copyable code blocks, Mermaid diagrams, and line-numbered file previews.
- Voice dictation via cloud API or offline `Vosk` / `faster-whisper`, plus image, PDF, and audio attachments.

### Long-Running Execution and Recovery

- Concurrent session pool, persistent message queue, mid-run steering, background shell jobs, and independent subagent tabs.
- Durable `events.jsonl` log, crash recovery across sidecar/window restarts, and content-addressed attachments surviving compaction, queuing, and chat forks.
- Structured Worker context pages and archives, token/cost/wall-clock budgets, and bounded tool outputs linked to full disk logs.
- Git-independent file and shell checkpoints with `/undo`, portable session exports, retention policies, and trash.
- Virtualized long threads with history search, preserved reading anchors, and streaming auto-follow.

### Extensions and Security

- Agent Skills, MCP over `stdio` and Streamable HTTP with OAuth PKCE, elicitation forms, and resource catalogs, plus hot-loadable SDK modules.
- SHA-256 content trust for extensions (invalidated automatically on package mutation) and durable replay of skill `allowed-tools` restrictions.
- Layered PermissionEngine, OS sandboxing, interactive approvals, and `failClosed` hooks; subagents can never escalate beyond parent permissions.
- Pre-log and pre-IPC secret redaction (including cross-chunk stream boundaries) plus project- and destination-bound credentials.
- Atomic writes for configs, queues, and caches, paired with redacted diagnostic bundles and opt-in counter telemetry.

### Packaging and CI

- Renamed to Flecten (`flecten.config.json`, `FLECTEN_*` env vars, `flecten-agent` binary) with legacy-name migration compatibility.
- Linux AppImage, macOS DMG/ZIP, and Windows NSIS installers with packaged smoke tests, SBOMs, and SHA checksums.
- Ed25519-signed update manifests verifying version, SHA512, and installer byte size, rejecting unsigned feeds.
- Cross-platform CI across Linux, macOS, and Windows enforcing an 85% line-coverage gate, docs-as-code checks, and visual regression at 1480x940 and 1180x640.

[0.1.0 source tree](https://github.com/AnnenkovLabs/flecten/tree/v0.1.0)
