# Admin Resource Upload And Review System

## Goal

Design an admin/TPO workflow for safe, high-volume resource collection and publishing.

This system exists to prevent:

- random PDF dumping
- duplicate-heavy imports
- low-quality content
- licensing mistakes
- broken metadata

## Core Principle

Collection should be easy.

Publishing should be controlled.

## User Roles

### 1. Admin

Can:

- configure the workflow
- review all staged resources
- approve/reject/publish resources
- manage taxonomy and quality rules

### 2. TPO

Can:

- upload resources
- tag suggested branch/domain
- see review queue
- publish if given permission

### 3. Faculty/Contributor

Can:

- upload files
- add source notes
- suggest metadata
- cannot publish directly by default

## Proposed Screens

### Screen 1: Upload Center

Purpose:

- receive new PDFs from admin/TPO/faculty

Fields:

- file upload
- source type
- source URL
- license type
- branch suggestions
- topic suggestion
- contributor notes

Actions:

- upload
- save draft
- bulk upload

### Screen 2: Staging Queue

Purpose:

- show all unreviewed PDFs

Columns:

- title guess
- uploader
- source type
- branch guess
- topic guess
- duplicate risk
- quality estimate
- review status
- uploaded time

Filters:

- source type
- branch guess
- topic guess
- duplicate risk
- review status

### Screen 3: Resource Review Detail

Purpose:

- review one staged resource in depth

Panels:

- PDF preview
- extracted metadata
- OCR text preview
- duplicate candidates
- branch/domain suggestions
- quality score breakdown
- source/license details

Reviewer actions:

- approve
- reject
- edit metadata
- change quality label
- mark cross-branch
- move to later review

### Screen 4: Coverage Dashboard

Purpose:

- show which branch/topic/domain areas are missing

Widgets:

- branch coverage heatmap
- topic coverage totals
- high-demand missing topics
- low-quality overloaded categories

### Screen 5: Published Library Admin

Purpose:

- manage approved resources

Actions:

- archive
- edit metadata
- change ranking
- feature by branch
- feature for cross-branch exploration

## Workflow States

Recommended state machine:

```text
draft -> pending_review -> approved -> published
draft -> pending_review -> rejected
published -> archived
approved -> rejected
```

## Database Support

Recommended new collection:

### `resource_ingestion_jobs`

```ts
type ResourceIngestionJob = {
  id: string;
  uploader_id: string;
  uploader_role: string;
  tenant_id: string | null;
  file_name: string;
  staged_path: string;
  checksum_sha1: string | null;
  checksum_sha256: string | null;
  source_type: string | null;
  source_url: string | null;
  license_type: string | null;
  metadata_guess: Record<string, unknown>;
  duplicate_candidates: string[];
  quality_estimate: number | null;
  review_status: "draft" | "pending_review" | "approved" | "rejected";
  review_notes: string | null;
  approved_resource_id: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
```

## Review Rules

### Auto-reject candidates

- broken file
- unreadable file
- no PDF mime type
- obvious exact duplicate
- copyright-risk source

### Manual-review candidates

- unclear title/topic
- near duplicates
- mixed branch relevance
- low OCR confidence
- unclear license

## Bulk Upload Policy

Bulk upload is necessary, but it must go through:

1. file staging
2. duplicate analysis
3. metadata suggestion
4. review queue
5. batch approve/publish

Do not publish bulk uploads directly into the student library.

## Quality Controls

Reviewer should score:

- usefulness for placements
- readability
- completeness
- branch/domain fit
- cross-branch usefulness
- file quality

## Recommended APIs

### Upload

- `POST /api/v1/admin/resources/upload`
- `POST /api/v1/admin/resources/upload/bulk`

### Review queue

- `GET /api/v1/admin/resources/review-queue`
- `GET /api/v1/admin/resources/review-queue/:jobId`
- `PATCH /api/v1/admin/resources/review-queue/:jobId`

### Publish

- `POST /api/v1/admin/resources/review-queue/:jobId/approve`
- `POST /api/v1/admin/resources/review-queue/:jobId/reject`

### Coverage

- `GET /api/v1/admin/resources/coverage`

### Published library

- `GET /api/v1/admin/resources/library`
- `PATCH /api/v1/admin/resources/library/:resourceId`
- `POST /api/v1/admin/resources/library/:resourceId/archive`

## MVP Build Order

1. upload center
2. staging queue
3. review detail page
4. approve/reject flow
5. coverage dashboard

## Immediate Recommendation

Before importing thousands more PDFs:

1. build the staging queue
2. build duplicate detection report
3. build coverage dashboard
4. only then scale collection
