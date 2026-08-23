# Troubleshooting

## The Script Says `SPREADSHEET_URL` Is Missing

Replace the placeholder at the top of `script.js` with the full Google Sheets URL.

## Merchant API Returns 0 Products

Check:

- `merchant_id`
- `data_source_filter`
- `feed_label_filter`
- `language_filter`
- Merchant Center account access
- whether products are active in the selected Merchant account

## Advanced API Errors

Enable Advanced APIs in Google Ads Scripts:

- Merchant API -> Products
- Merchant API -> Accounts

## First GCP Registration Takes Time

If automatic GCP developer registration is enabled, the script may wait after registration before continuing.

Relevant settings:

- `auto_register_gcp_project`
- `developer_email`
- `wait_after_gcp_registration_seconds`

## Timeout Or Large Account Issues

This repository is for the standard Unified Merchant Product Control script.

For very large assortments, use the separate extended version repository when it is migrated.

