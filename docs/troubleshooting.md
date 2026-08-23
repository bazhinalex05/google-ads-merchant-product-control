# Troubleshooting

## Скрипт пише, що `SPREADSHEET_URL` не заповнений

Замінити placeholder у верхній частині `script.js` на повний URL Google Sheets таблиці.

## Merchant API повертає 0 товарів

Перевірити:

- `merchant_id`
- `data_source_filter`
- `feed_label_filter`
- `language_filter`
- доступ до Merchant Center
- чи є активні товари у вибраному Merchant account

## Помилки Advanced API

Увімкнути Advanced APIs у Google Ads Scripts:

- Merchant API -> Products
- Merchant API -> Accounts

## Перша GCP-реєстрація займає час

Якщо автоматична GCP developer registration увімкнена, скрипт може чекати після реєстрації перед продовженням роботи.

Пов'язані налаштування:

- `auto_register_gcp_project`
- `developer_email`
- `wait_after_gcp_registration_seconds`

## Timeout або проблеми на великих акаунтах

Цей репозиторій призначений для стандартного Unified Merchant Product Control.

Для дуже великих асортиментів треба використовувати окрему extended-версію після її міграції в окремий репозиторій.
