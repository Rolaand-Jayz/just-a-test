# Rescue 1 Movers — public website technology baseline

**Source:** https://www.rescue1movers.com/  
**Purpose:** Preserve the *publicly delivered* technology and content of the existing website before proposing changes. This is not a redesign or a replacement for the Squarespace account.

## Observed live stack (2026-10-18)
- **Website builder/hosting:** Squarespace (identified by the site's own "Made with Squarespace" footer and Squarespace-hosted images).
- **Quote/estimate workflow:** Embedded SmartMoving form hosted by `portal.smartmoving.com`.
- **Public pages independently observed:** `/` and `/contact`.
- **Image hosting:** `images.squarespace-cdn.com`.
- **Original Squarespace templates, private CMS/database, account settings, and SmartMoving backend:** Not publicly retrievable and **not** included.

## Capturing the real site, as served

This repository contains a one-time GitHub Actions capture workflow at `.github/workflows/capture.yml`, plus `scripts/capture.py`.

The capture saves:
- Exact HTML response bodies under `snapshot/pages/` (no hand-written rewrite).
- HTTP metadata, discovered page URLs and externally hosted integration references.
- Downloadable public CSS, JavaScript, fonts and image files under `snapshot/assets/`, when accessible and within size limits.
- File checksums and URLs in `snapshot/manifest.json`.

The original page HTML is intentionally preserved *unmodified*. CSS and JavaScript may depend on Squarespace-hosted APIs, so a public-facing snapshot is **not** a deployable copy of the whole Squarespace application. The SmartMoving quote form remains external.

The workflow runs once when its configuration is first pushed, and can be re-run manually from **Actions → Capture public website baseline → Run workflow**. The task does not publish or modify the live website. Subsequent snapshots replace the previous captured baseline; use Git history to compare versions.

## Limitations and stewardship

This is a technical baseline, not evidence of ownership of website assets or an export of proprietary Squarespace source. Confirm with the business that you may reproduce its text, logos and photographs in this **public** GitHub repository. Consider making the repository private if permission to redistribute assets is uncertain.

If a complete, editable migration is required, obtain authorized access to the Squarespace site and domain/asset records and rebuild or migrate separately. Do not treat the public capture as a Squarespace project export.