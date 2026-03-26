# Resource Ingestion Workflow

## Goal

Create a repeatable workflow for collecting as many useful resources as possible without polluting the library.

The correct objective is not maximum file count. It is:

- maximum topic and branch coverage
- minimum duplicates
- clean metadata
- legally safe sources

## Folder Structure

Use this local structure:

```text
material/
  upload_staging/
    raw/
    faculty/
    alumni/
    public_open/
  curated/
    aptitude/
    hr_interview/
    software/
    data_analyst/
    cse/
    it/
    ece/
    eee/
    me/
    civil/
  rejected/
    duplicate/
    low_quality/
    copyright_risk/
    broken/
  analysis/
    import_reports/
    coverage_reports/
    duplicate_reports/
```

### Meaning

- `upload_staging/raw`: unreviewed incoming files
- `upload_staging/faculty`: faculty-uploaded raw material
- `upload_staging/alumni`: alumni-uploaded raw material
- `upload_staging/public_open`: public/open-license sources waiting review
- `curated/*`: approved production-ready files
- `rejected/*`: rejected or quarantined files
- `analysis/*`: machine-generated reports

## Standard Intake Pipeline

Every new PDF should follow the same path:

1. collect
2. stage
3. normalize filename
4. hash file
5. extract metadata
6. detect duplicates
7. suggest topic/branch/domain
8. review
9. publish
10. monitor usage

## Phase Details

### 1. Collect

Allowed channels:

- internal faculty notes
- internal TPO notes
- alumni contributions
- open/public educational sources
- official documentation with allowed redistribution

Do not ingest:

- copyrighted commercial PDFs without rights
- unclear license sources
- random scraped files with no provenance

### 2. Stage

Incoming files are copied to `material/upload_staging/...`.

Naming rules:

- lowercase
- underscore separators
- no spaces
- stable names

Example:

```text
ece_digital_electronics_basics_unit1.pdf
me_thermodynamics_formula_sheet_v2.pdf
aptitude_percentages_shortcuts_pack.pdf
```

### 3. Normalize Filename

Normalize:

- extension
- branch/topic tokens
- version suffix
- invalid characters

This makes topic inference and dedupe more reliable.

### 4. Hash File

Compute:

- `sha1`
- `sha256`

Store them in `assets`.

Why:

- exact duplicate detection
- migration verification later
- safer storage transitions

### 5. Extract Metadata

Extract:

- page count
- estimated read time
- OCR text if possible
- first-page title guess
- probable topic
- probable branch relevance
- probable domain tags

Suggested extraction outputs:

```json
{
  "title_guess": "Digital Electronics Basics",
  "topic_guess": "Digital Electronics",
  "primary_branches_guess": ["ECE"],
  "career_domains_guess": ["core_ece"],
  "page_count": 42,
  "ocr_confidence": 0.88
}
```

### 6. Detect Duplicates

Duplicate policy:

- exact duplicate by hash: reject or merge
- same file under different names: keep one
- same topic and same title with slight filename variation: review manually

Output duplicate report into:

```text
material/analysis/duplicate_reports/
```

### 7. Suggest Classification

The importer should suggest:

- `topic`
- `subtopic`
- `primary_branches`
- `career_domains`
- `difficulty`
- `is_cross_branch`

Examples:

- aptitude PDF
  - all branches
  - `is_cross_branch=true`

- thermodynamics note
  - `primary_branches=["ME"]`
  - still open to all students

### 8. Review

Reviewer decides:

- approve
- reject
- request metadata correction
- downgrade quality
- mark as cross-branch useful

No file should move to `curated/` without review if it came from bulk collection.

### 9. Publish

On approval:

- move file to `material/curated/...`
- create/update `assets`
- create/update `shared_resources`
- create tenant mappings
- mark `review_status=approved`

### 10. Monitor Usage

Track:

- opens
- failed opens
- search hits
- search misses
- low-engagement PDFs

This drives the next collection cycle.

## Coverage Matrix

Build a matrix by:

- branch
- topic family
- career domain
- difficulty

Example:

```text
Branch | Core | Aptitude | Interview | Cross-branch software | Cross-branch analyst
CSE    | high | medium   | medium    | high                  | medium
ECE    | low  | medium   | low       | low                   | low
ME     | low  | medium   | low       | low                   | low
```

Collect according to gaps, not random availability.

## Recommended Tooling

### Existing scripts to extend

- `import-material-metadata.mjs`
- `import-scrapedpdfs-resources.mjs`
- `migrate-resources-to-shared-assets.mjs`

### New scripts recommended

- `analyze-resource-coverage.mjs`
- `detect-resource-duplicates.mjs`
- `classify-staged-resources.mjs`
- `publish-approved-resources.mjs`

## Success Metrics

Track:

- total approved PDFs
- branch coverage score
- domain coverage score
- duplicate rejection rate
- broken file rate
- search success rate

## Immediate Implementation Order

1. finalize metadata schema
2. organize folder structure
3. add duplicate + coverage analysis scripts
4. add review queue before large-scale bulk import
