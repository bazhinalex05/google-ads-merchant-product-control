# Робочий процес

Цей репозиторій зберігає один самостійний Google Ads Script: Unified Merchant Product Control.

## Мова документації

Усі інструкції в Notion, README, CHANGELOG, workflow-документи, робочі нотатки й коментарі до Google Ads скриптів для цієї системи пишемо українською.

Англійську використовувати тільки там, де це назви інтерфейсу, API, змінних, файлів, помилок або прямі технічні терміни, які не треба перекладати.

## Джерело правди

GitHub є джерелом правди.

Google Docs-копії є тільки архівом або історичним референсом. Після міграції не продовжувати редагувати активний код у Google Docs.

## Що лінкувати в Notion

Notion використовуємо як навігацію й робочу інструкцію, а не як місце зберігання коду.

Рекомендовані посилання:

- Репозиторій: https://github.com/kUspehu/google-ads-merchant-product-control
- Поточний файл скрипта: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/script.js
- Raw-версія для копіювання: https://raw.githubusercontent.com/kUspehu/google-ads-merchant-product-control/main/script.js
- Стабільний тег v1.0.2: https://github.com/kUspehu/google-ads-merchant-product-control/tree/v1.0.2
- Інструкція встановлення: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/install.md
- Довідник налаштувань: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/settings.md
- Troubleshooting: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/troubleshooting.md

## Як використовувати стабільну версію

Для стабільних версій використовувати GitHub tags або GitHub Releases.

- `main` - поточна робоча версія.
- Тег на кшталт `v1.0.2` - стабільна збережена версія.
- GitHub Release можна створити з тега, якщо потрібна зручніша сторінка для скачування.
- У Notion для клієнтської установки краще давати посилання на стабільний tag/release.
- Файл із `main` використовувати тоді, коли свідомо береться найсвіжіший робочий код.

## Як змінювати скрипт

1. Почати з останньої GitHub-версії.
2. Внести зміну локально або через Codex.
3. Перед публікацією переглянути diff.
4. Зробити commit із зрозумілим повідомленням.
5. Зробити push у GitHub.
6. Якщо версія підтверджена як робоча, створити або оновити tag/release.
7. Оновити Notion: стабільна версія, короткий опис зміни, важливі нюанси.

## Предохранители

- Не перезаписувати `script.js` зі старого Google Doc без порівняння з GitHub.
- Не вважати Google Docs активним джерелом після міграції.
- Не видаляти історичні Google Docs, доки GitHub-версія не перевірена й не прив'язана в Notion.
- Не змішувати в цьому репозиторії unrelated scripts.
- Extended-версія для великих асортиментів і інші самостійні скрипти мають жити в окремих репозиторіях.
- Перед правками перевіряти поточний Git status і актуальний стан GitHub.
- Кожна змістовна зміна має мати commit.
- Кожна стабільна клієнтська версія має бути ідентифікована через commit або tag/release.

## Відновлення

Якщо нова версія ламається, використовувати GitHub history, щоб повернутися до попереднього робочого commit або tag/release.

Для клієнтських установок фіксувати:

- репозиторій
- tag/release або commit SHA
- дату встановлення
- клієнта/account
- нотатки про індивідуальні налаштування
