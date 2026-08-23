# Встановлення

## 1. Створити або вибрати Google Sheets таблицю

Створити або вибрати Google Sheets файл, з яким працюватиме скрипт.

Скрипт використовує цю таблицю для листів:

- `Settings`
- `Products`
- `ProductTypes`
- `ProductDiagnostics`
- `QuarantineRegistry`
- `QuarantineLog`
- `DashboardData`
- `Dashboard`
- `Seasonality`

Якщо потрібних листів немає, скрипт може створити їх автоматично.

## 2. Додати скрипт у Google Ads

1. Відкрити потрібний Google Ads акаунт.
2. Перейти в `Tools` -> `Bulk actions` -> `Scripts`.
3. Створити новий скрипт.
4. Скопіювати весь код із `script.js`.
5. Вставити код у редактор Google Ads Scripts.

## 3. Вказати URL таблиці

У верхній частині `script.js` замінити:

```js
var SPREADSHEET_URL = "SPREADSHEET_URL";
```

на повний URL Google Sheets таблиці.

## 4. Увімкнути Advanced APIs

У Google Ads Scripts увімкнути Advanced APIs:

- Merchant API -> Products
- Merchant API -> Accounts

Сервіс Accounts потрібен для першої реєстрації GCP developer project.

## 5. Запустити

1. Спочатку запустити preview.
2. Перевірити logs.
3. Переконатися, що скрипт створив або оновив очікувані листи.
4. Авторизувати й запускати робочий run.
