# Installation

## 1. Create The Spreadsheet

Create or choose the Google Sheets file that the script will manage.

The script uses this spreadsheet for:

- `Settings`
- `Products`
- `ProductTypes`
- `ProductDiagnostics`
- `QuarantineRegistry`
- `QuarantineLog`
- `DashboardData`
- `Dashboard`
- `Seasonality`

The script can create missing sheets automatically.

## 2. Add The Script In Google Ads

1. Open the target Google Ads account.
2. Go to `Tools` -> `Bulk actions` -> `Scripts`.
3. Create a new script.
4. Copy all code from `script.js`.
5. Paste it into the Google Ads Scripts editor.

## 3. Set The Spreadsheet URL

At the top of `script.js`, replace:

```js
var SPREADSHEET_URL = "SPREADSHEET_URL";
```

with the full Google Sheets URL.

## 4. Enable Advanced APIs

In Google Ads Scripts, enable Advanced APIs:

- Merchant API -> Products
- Merchant API -> Accounts

The Accounts service is needed for the first GCP developer registration flow.

## 5. Run

1. Run preview first.
2. Check logs.
3. Confirm that the script created or updated the expected sheets.
4. Authorize and run normally.

