# Прогресс фронтенда Cyber Garden

Для каждой задачи точный хеш коммита доступен через
`git log -1 --format=%h <ветка>`. Собственный хеш нельзя записать в содержимое того же коммита.

| Task | Название | Ветка | Коммит | Проверки | Статус | Примечания |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | Workflow Editor | `feat/4-workflow-editor` | `e9a2c0d` | Сборка, линтер, строгий TypeScript, Chrome | Опубликовано | MSW, перетаскивание, сохранение, запуск и сохранение черновика при ошибке. |
| 5 | Add Node | `feat/5-add-node` | `7a47f8f` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Уникальные ID и независимые настройки. |
| 6 | Connect Nodes | `feat/6-connect-nodes` | `c0dc011` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Независимые ветки и защита от циклов. |
| 7 | Remove Node | `feat/7-remove-node` | `e7f7cab` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Удаление блока и всех его связей. |
| 8 | Node Settings | `feat/8-node-settings` | `ca229dc` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Формы расписания, условия и канала. |
| 9 | Workflow Saving | `feat/9-workflow-save` | `4b3f474` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Создание, конфликт ревизии и восстановление после перезагрузки. |
| 10 | Start Run | `feat/10-start-run` | `9bd3a52` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | POST запуска, отображение queued и защита от повторной отправки. |
| 11 | SSE Subscription | `feat/11-run-events` | `ccaf837` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | EventSource, дедупликация, финальный GET и закрытие потока. |
| 12 | Apply Run Events | `feat/12-apply-run-events` | `6160861` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Состояния блоков, вход и выход из SSE. |
| 13 | Finding Card | `feat/13-finding-card` | `bd0b328` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | История запусков, находки и источники рекомендаций. |
| 14 | Comparison Page | `feat/14-comparison-page` | `5fb759c` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Сравнение с базой PR или прошлым запуском и три категории находок. |
| 15 | CI Highlight | `feat/15-ci-highlight` | `2f4da95` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Подсветка анализатора, условия и выбранной ветки. |
| 16 | Threshold Preview | `feat/16-threshold-preview` | `f79fc85` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Предпросмотр без изменения графа или истории. |
| 17 | Fix Dialog | `feat/17-fix-dialog` | `8e355e5` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Маскированный diff, подтверждение, новый снимок и повторный запуск. |
| 18 | Finding History | `feat/18-finding-history` | `85aecc7` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Состояния found, resolved, returned со ссылками. |
| 19 | Templates | `feat/19-templates-page` | `5de215d` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Каталог, публикация и копия без частных настроек. |
| 20 | AI Workflow Draft | `feat/20-ai-draft` | `b86cd2d` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Текст, редактируемый граф и отдельное сохранение. |
| 21 | Snapshot Import API | `feat/21-snapshot-import-api` | `0599d14` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Multipart, 201/413/422, снимки доступны в GET. |
| 22 | Snapshot Picker | `feat/22-snapshot-picker` | `7c44352` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Импорт ZIP, новый выбор и сохранение прежнего значения при ошибке. |
| 23 | Telegram Connections | `feat/23-telegram-connections` | `f8727b2` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Метаданные подключений, поле пароля и channelId в графе. |
| 24 | Template Copy | `feat/24-template-copy` | `7277f8a` | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Опубликовано | Явный выбор своего снимка и канала для копии. |
| 25 | CI Reason | `feat/25-ci-reason` | HEAD ветки | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Готово к публикации | Красный CI объяснён и для находки из категории «Уже было». |

Следующая задача — Task 26, предупреждения AI-черновика.
