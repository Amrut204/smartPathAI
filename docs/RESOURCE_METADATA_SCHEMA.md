# Resource Metadata Schema

## Goal

Define a single metadata model for PDFs and learning resources so the library can scale without becoming unsearchable or biased.

The guiding rule is:

- access is open to all students
- metadata is used for recommendation, ranking, filtering, deduplication, and review

## Scope

This schema applies to:

- PDF study materials
- company prep handbooks
- aptitude packs
- branch-core subject notes
- interview and communication material
- cross-branch career-switch material

## Core Entities

### 1. `assets`

Represents the physical stored file.

Recommended fields:

```ts
type Asset = {
  id: string;
  dedupe_key: string;
  storage_provider: "local" | "s3";
  storage_key: string;
  public_url: string | null;
  source_path: string;
  mime_type: string;
  size_bytes: number | null;
  page_count: number | null;
  checksum_sha1: string | null;
  checksum_sha256: string | null;
  import_source: string | null;
  created_at: string;
  updated_at: string;
};
```

Notes:

- `storage_provider` is operational storage, not content classification.
- `storage_key` should always be normalized relative path or object key.
- `checksum_*` fields are required for deduplication at scale.

### 2. `shared_resources`

Represents the catalog entry students actually browse.

Recommended fields:

```ts
type SharedResource = {
  id: string;
  dedupe_key: string;
  title: string;
  description: string;
  resource_type: "pdf";
  topic_id: string | null;
  subtopic: string | null;
  asset_id: string;
  source_pdf: string | null;
  url: string;
  thumbnail_url: string | null;
  duration_sec: number;
  language: string | null;
  difficulty: "beginner" | "intermediate" | "advanced" | null;
  source_type: "open_web" | "official_docs" | "faculty_note" | "internal_note" | "alumni_note" | "manual_upload";
  license_type: "internal" | "public_domain" | "open_license" | "redistribution_allowed" | "unknown";
  license_notes: string | null;
  source_url: string | null;
  author_name: string | null;
  publisher_name: string | null;
  published_at: string | null;
  review_status: "draft" | "pending_review" | "approved" | "rejected" | "archived";
  quality_score: number | null;
  quality_label: "A" | "B" | "C" | null;
  quality_notes: string | null;
  is_cross_branch: boolean;
  primary_branches: string[];
  career_domains: string[];
  tags: string[];
  search_text: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
```

### 3. `tenant_resources`

Maps resources into a tenant.

Recommended fields:

```ts
type TenantResource = {
  id: string;
  tenant_id: string;
  resource_id: string;
  is_active: boolean;
  featured_for_branches: string[];
  featured_for_domains: string[];
  created_at: string;
  updated_at: string;
};
```

This entity should never block access by branch. It only controls tenant visibility and featured ranking.

## Branch and Domain Taxonomy

### Branches

Standardize branch values:

- `CSE`
- `IT`
- `ECE`
- `EEE`
- `ME`
- `Civil`

### Career domains

Suggested domain tags:

- `aptitude`
- `verbal`
- `hr_interview`
- `technical_interview`
- `software`
- `data_analyst`
- `core_ece`
- `core_eee`
- `core_me`
- `core_civil`
- `cross_branch_switch`

## Quality Model

Quality score should be 0 to 100.

Suggested scoring inputs:

- topic relevance
- readability
- completeness
- scan quality / OCR quality
- placement usefulness
- duplication risk

Suggested labels:

- `A`: 80+
- `B`: 60-79
- `C`: below 60

Display policy:

- show `A/B` by default
- keep `C` searchable but deprioritized

## Deduplication Strategy

Use three levels:

1. exact file duplicate
- `checksum_sha1`
- `checksum_sha256`

2. catalog duplicate
- same normalized title
- same topic
- same asset checksum

3. near duplicate
- same topic
- high title similarity
- similar OCR text fingerprint

## Required Indexes

Recommended indexes:

```js
db.assets.createIndex({ dedupe_key: 1 }, { unique: true });
db.assets.createIndex({ checksum_sha1: 1 });
db.shared_resources.createIndex({ dedupe_key: 1 }, { unique: true });
db.shared_resources.createIndex({ review_status: 1, updated_at: -1 });
db.shared_resources.createIndex({ primary_branches: 1, career_domains: 1 });
db.shared_resources.createIndex({ topic_id: 1, difficulty: 1 });
db.shared_resources.createIndex({ quality_label: 1, quality_score: -1 });
db.tenant_resources.createIndex({ tenant_id: 1, resource_id: 1 }, { unique: true });
```

## API Output Shape

Student-facing resource payload should include recommendation metadata:

```ts
type ResourceDto = {
  id: string;
  title: string;
  description: string;
  url: string;
  resourceType: string;
  topicId: string | null;
  difficulty: string | null;
  primaryBranches: string[];
  careerDomains: string[];
  isCrossBranch: boolean;
  qualityLabel: "A" | "B" | "C" | null;
  recommendationReason: string | null;
};
```

## Product Rules

- branch metadata must never hard-block access
- branch metadata is for ranking, recommendation, and discovery
- all students can access all approved resources

## Recommended Next DB Changes

1. extend `shared_resources` with review, quality, branch, domain, and licensing fields
2. extend `assets` with file hash and page count
3. add a background metadata extraction step for new PDFs
