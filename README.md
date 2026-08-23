# Google Ads Merchant Product Control

Unified Merchant Product Control is a Google Ads Script for ecommerce accounts that use Google Merchant Center.

The script reads Merchant Center products, builds a `product_type` control layer, reads Google Ads product statistics, calculates Funnel Builder segments, manages product quarantine, and writes the `Products` sheet that can be used as a Merchant Center supplemental feed.

## When To Use

Use this script for ecommerce clients where the goal is to focus ad spend on stronger products and reduce waste on weak, problematic, or currently blocked product groups.

Do not use this repository for the extended large-catalog version or for unrelated Merchant export/audit scripts. Those should live in separate repositories.

## Files

- `script.js` - the Google Ads Script code to copy into Google Ads Scripts.
- `docs/install.md` - installation steps.
- `docs/settings.md` - core Settings sheet reference.
- `docs/troubleshooting.md` - common setup and runtime issues.
- `archive/source-google-doc.md` - original Google Doc source used for the first migration.

## Quick Start

1. Open `script.js`.
2. Copy the full file contents.
3. Create a new script in Google Ads: `Tools` -> `Bulk actions` -> `Scripts`.
4. Paste the code.
5. Replace `SPREADSHEET_URL` with the target Google Sheets URL.
6. Enable required Advanced APIs.
7. Run preview, review logs, then authorize and run.

## Current Version

Initial GitHub migration: `v1.0.0`.

