# Non-PDF Resource Support Plan

Date: `2026-03-08`

## Goal

Support non-PDF educational resources in the app without breaking the current PDF-first student resource flow.

Current pending non-PDF backlog:

- `179` downloaded repo-harvested non-PDF resources

Examples:

- `markdown` guides
- `ipynb` notebooks
- `txt` technical notes
- `docx` documents

## Recommended Product Model

Keep a single shared resource collection, but extend `resource_type`.

Current:

- `pdf`

Add:

- `markdown`
- `notebook`
- `text`
- `document`
- `external_link`

## Backend Changes

### 1. Extend import model

Importer should map file extensions:

- `.md`, `.markdown` -> `markdown`
- `.ipynb` -> `notebook`
- `.txt`, `.rst` -> `text`
- `.doc`, `.docx` -> `document`

### 2. Add normalized preview fields

For non-PDF resources store:

- `preview_text`
- `raw_extension`
- `content_format`
- `word_count`
- `repo_source`
- `origin_url`

### 3. Add parser pipeline

- `markdown/text`: extract plain text directly
- `ipynb`: extract markdown cells and code cell headings
- `docx`: extract plain text with a doc parser

### 4. Search support

Include non-PDF preview text in topic search.

## Frontend Changes

### 1. Resource cards

Show:

- `PDF`
- `Notebook`
- `Guide`
- `Document`

### 2. Viewer behavior

- `pdf`: current file route
- `markdown/text`: render in-app preview page
- `ipynb`: render extracted markdown summary or download/open
- `docx`: offer download plus extracted preview if available

### 3. Filters

Add resource-type filters:

- all
- pdf
- notebook
- guide
- document

## Implementation Order

1. Add backend resource_type support
2. Build importer for non-PDF repo-harvested files
3. Add preview extraction for markdown/text first
4. Add student UI badges and filters
5. Add in-app viewer for markdown/text
6. Add notebook/docx support

## Safe First Scope

First import only:

- `markdown`
- `text`
- `ipynb`

Delay `docx` until preview extraction is in place.

## Recommended Next Command

Implement a new script:

- `server/scripts/import-repo-harvested-nonpdf-resources.mjs`

Then extend:

- `client/src/hooks/use-resources.ts`
- `client/src/pages/student/ResourcesPage.tsx`

to show resource type badges and non-PDF handling.
