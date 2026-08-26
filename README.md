# Google Ads Merchant Product Control

Unified Merchant Product Control - це Google Ads Script для ecommerce-акаунтів, які працюють із Google Merchant Center.

Скрипт читає товари з Merchant Center, будує контрольний шар `product_type`, читає товарну статистику з Google Ads, рахує сегменти Funnel Builder, веде карантин проблемних товарів і записує лист `Products`, який можна використовувати як додатковий фід Merchant Center.

## Коли використовувати

Використовувати для ecommerce-клієнтів, де потрібно сфокусувати рекламний бюджет на сильніших товарах і зменшити витрати на слабкі, проблемні або тимчасово заблоковані групи товарів.

Не використовувати цей репозиторій для extended-версії під великі асортименти або для окремих Merchant export/audit скриптів. Такі самостійні скрипти мають жити в окремих репозиторіях.

## Файли

- `script.js` - код Google Ads Script, який копіюється в Google Ads Scripts.
- `docs/install.md` - інструкція встановлення.
- `docs/settings.md` - довідник основних налаштувань листа `Settings`.
- `docs/troubleshooting.md` - типові проблеми запуску й налаштування.
- `docs/workflow.md` - правила версій, доопрацювань і безпечної роботи.
- `archive/source-google-doc.md` - старий Google Doc, з якого зроблено першу міграцію.

## Швидкий старт

1. Відкрити `script.js`.
2. Скопіювати весь вміст файлу.
3. У Google Ads створити новий скрипт: `Tools` -> `Bulk actions` -> `Scripts`.
4. Вставити код.
5. Замінити `SPREADSHEET_URL` на URL робочої Google Sheets таблиці.
6. Увімкнути потрібні Advanced APIs.
7. Спочатку запустити preview, перевірити logs, потім авторизувати й запускати робочий run.

## Поточна версія

Поточна стабільна документаційна версія: `v1.0.2`.

Перша GitHub-міграція коду: `v1.0.0`.

## Benchmark / priority

`benchmark_label_field` у листі `Settings` визначає джерело групи порівняння для Funnel Builder. Доступні варіанти: `custom_label_0`...`custom_label_4`, `product_type`, `product_type_l1`...`product_type_l5`, `brand`, `title`.

## Джерело правди

GitHub є джерелом правди для цього скрипта. Google Docs-копії залишаються тільки історичними посиланнями й не мають редагуватися як активний код.
