# Pending Resource Status

Date: `2026-03-08`

## Current Imported Counts

- Total active shared PDF resources in app: `440`
- Imported from `open_resource_master_v1`: `57`
- Imported from `repo_resource_harvest_v1`: `18`
- Imported from `question_source_harvest_v1`: `0`

## Pipeline Status

### Open Resource Scraper

- Unique fetched resource records: `115`
- Local PDF records: `57`
- Metadata-only records: `58`
- Imported into app: `57`
- Pending importable PDFs: `0`
- Pending metadata-only records: `58`

### Question Source Scraper

- Unique fetched question-source records: `26`
- Local PDF records: `15`
- Metadata-only records: `11`
- Imported into app: `0`
- Pending importable PDFs: `15`
- Pending metadata-only records: `11`

### Repo Resource Harvester

- Harvested repo metadata records: `10`
- Repo file metadata records: `431`
- Outbound non-image links: `765`
- Approved second-pass candidates: `404`
- Download attempts in second pass: `200`
- Successful second-pass downloads: `197`
- Import-ready PDFs: `18`
- Imported into app: `18`
- Pending importable PDFs: `0`
- Pending downloaded non-PDF resources: `179`

## Pending Backlog Summary

- Pending importable PDFs: `15`
- Pending metadata-only records: `69`
- Pending downloaded non-PDF resources: `179`

## Recommended Next Steps

1. Import the `15` question-source PDFs into the app as a separate `question_source_harvest_v1` bucket.
2. Add a non-PDF content model for `markdown`, `ipynb`, and `docx` resources.
3. Keep metadata-only records in a review queue until a compliant downloader/importer is added for those sources.
