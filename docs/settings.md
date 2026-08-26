# Лист Settings

Більшість робочих налаштувань скрипт читає з листа `Settings`.

Якщо листа немає або він порожній, скрипт створює шаблон автоматично.

## Обов'язкове налаштування

- `merchant_id` - ID Merchant Center.

## Основні перемикачі

- `enable_product_type_filter` - увімкнути ручну логіку дозволів/фільтрів у `ProductTypes`.
- `enable_funnel_builder` - увімкнути Funnel Builder сегментацію на основі статистики Google Ads.
- `enable_quarantine` - увімкнути карантин проблемних товарів.
- `enable_product_diagnostics` - записувати діагностичну таблицю товарів.
- `enable_dashboard_data` - записувати службові дані для Dashboard.
- `enable_dashboard` - створювати або підтримувати візуальний лист Dashboard.
- `enable_products_write` - записувати чистий лист `Products` для додаткового фіда.

## Фільтри

- `data_source_filter`
- `feed_label_filter`
- `language_filter`

Якщо залишити порожніми, скрипт бере всі відповідні товари з Merchant Center.

## Product type

- `max_product_type_levels` - максимальна глибина ієрархії.
- `enable_product_type_custom_label_source` - використовувати custom label як джерело product type.
- `product_type_custom_label_field` - вибране поле custom label.
- `product_type_feed_url` - опціональний зовнішній фід для збагачення product type.
- `product_type_id_prefixes_to_strip` - префікси ID, які потрібно прибрати перед match.

## Funnel і карантин

- `enable_benchmark_grouping` - рахувати пороги Funnel Builder окремо по benchmark / priority групах.
- `benchmark_label_field` - джерело benchmark / priority групи. Доступні варіанти: `custom_label_0`...`custom_label_4`, `product_type`, `product_type_l1`...`product_type_l5`, `brand`, `title`.
- `default_benchmark_group` - fallback-група для товарів без значення у вибраному джерелі.
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
