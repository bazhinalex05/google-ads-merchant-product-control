# Workflow

This repository stores one standalone Google Ads Script: Unified Merchant Product Control.

## Source Of Truth

GitHub is the source of truth.

Google Docs copies are archive/reference material only. Do not continue editing the active script in Google Docs after the GitHub migration.

## What To Link In Notion

Use Notion as navigation and operating instructions, not as the code storage.

Recommended links:

- Repository: https://github.com/kUspehu/google-ads-merchant-product-control
- Current script file: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/script.js
- Raw script for copying: https://raw.githubusercontent.com/kUspehu/google-ads-merchant-product-control/main/script.js
- Installation guide: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/install.md
- Settings reference: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/settings.md
- Troubleshooting: https://github.com/kUspehu/google-ads-merchant-product-control/blob/main/docs/troubleshooting.md

## How To Use A Stable Version

Use GitHub Releases for stable versions.

- `main` is the current working version.
- A release/tag like `v1.0.0` is a stable saved version.
- Notion should link to the current stable release when a client needs a proven version.
- Use the `main` file only when intentionally taking the newest working code.

## How To Change The Script

1. Start from the latest GitHub version.
2. Make the change locally or through Codex.
3. Review the diff before publishing.
4. Commit the change with a clear message.
5. Push to GitHub.
6. If the version is confirmed working, create/update a release tag.
7. Update Notion with the new stable version and short change summary.

## Safety Rules

- Do not overwrite `script.js` from an old Google Doc without comparing against GitHub first.
- Do not treat Google Docs as the active source after migration.
- Do not delete historical Google Docs until the GitHub version has been checked and linked in Notion.
- Do not mix unrelated scripts in this repository.
- Keep the extended large-catalog version and other standalone scripts in separate repositories.
- Before edits, check current Git status and latest GitHub state.
- Every meaningful change must have a commit.
- Every client-installed stable version should be identifiable by commit or release tag.

## Recovery

If a new version breaks, use GitHub history to return to the previous working commit or release.

For client installations, record which version was installed:

- repository
- release tag or commit SHA
- installation date
- client/account
- notes about custom settings

