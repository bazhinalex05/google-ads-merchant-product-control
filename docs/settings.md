# Settings Sheet

The script reads most runtime configuration from the `Settings` sheet.

If the sheet does not exist or is empty, the script creates a template automatically.

## Required

- `merchant_id` - Merchant Center ID.

## Main Switches

- `enable_product_type_filter` - enable ProductTypes manual allowance/filter logic.
- `enable_funnel_builder` - enable Google Ads stats-based Funnel Builder segmentation.
- `enable_quarantine` - enable quarantine rules for problematic products.
- `enable_product_diagnostics` - write the diagnostic product table.
- `enable_dashboard_data` - write dashboard source data.
- `enable_dashboard` - create or maintain the visual Dashboard sheet.
- `enable_products_write` - write the clean `Products` supplemental-feed sheet.

## Filters

- `data_source_filter`
- `feed_label_filter`
- `language_filter`

Leave empty to include all matching Merchant products.

## Product Type

- `max_product_type_levels` - maximum hierarchy depth.
- `enable_product_type_custom_label_source` - use a custom label as a product type source.
- `product_type_custom_label_field` - selected custom label field.
- `product_type_feed_url` - optional external feed URL for product type enrichment.
- `product_type_id_prefixes_to_strip` - ID prefixes to remove before matching.

## Funnel And Quarantine

- `funnel_days_ago`
- `exclude_last_days`
- `problem_threshold`
- `enable_no_sales_rule`
- `clicks_threshold`
- `no_sales_lookback_days`
- `no_sales_quarantine_days`
- `enable_spend_rule`
- `spend_lookback_days`
- `spend_to_price_threshold`
- `spend_quarantine_days`
- `enable_expensive_click_rule`
- `expensive_click_threshold`
- `expensive_click_quarantine_days`

## Merchant API

- `merchant_api_page_size`
- `merchant_api_retry_count`
- `merchant_api_retry_sleep_seconds`
- `include_legacy_local_products`
- `auto_register_gcp_project`
- `developer_email`
- `wait_after_gcp_registration_seconds`

