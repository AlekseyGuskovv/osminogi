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
| 13 | Finding Card | `feat/13-finding-card` | HEAD ветки | Сборка, линтер, строгий TypeScript, unit-тесты, Chrome | Готово к публикации | История запусков, находки и источники рекомендаций. |

Следующая задача — Task 14, сравнение запусков.
