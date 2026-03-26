# Cloud Resource Upload (Deduplicated)

This project supports uploading staged PDFs from `material/upload_staging` to cloud storage and updating `assets` records so all tenants use shared cloud files.

## 1) Prepare staging files

```bash
cd server
npm run prepare:upload:staging
```

This creates:
- `material/upload_staging/<topic>/<normalized_file>.pdf`
- `material/upload_staging/manifest.json`
- `material/upload_staging/manifest.csv`

## 2) Configure `.env`

Set:
- `CLOUD_UPLOAD_PROVIDER=s3` or `azure_blob` or `gcs`
- `CLOUD_UPLOAD_PREFIX=smartpathai/resources`
- provider-specific credentials (`AWS_*` or `AZURE_*` or `GCS_BUCKET` + `GOOGLE_APPLICATION_CREDENTIALS`)

Optional public URL bases:
- `STORAGE_S3_PUBLIC_BASE_URL`
- `STORAGE_AZURE_PUBLIC_BASE_URL`
- `STORAGE_GCS_PUBLIC_BASE_URL`

## 3) Dry run

```bash
cd server
npm run upload:cloud:dry
```

## 4) Upload and sync DB

```bash
cd server
npm run upload:cloud
```

What it does:
- Reads `upload_staging/manifest.json`
- Uploads unique files by content hash
- Updates matching `assets` rows:
  - `storage_provider`
  - `storage_key`
  - `public_url`
  - `bucket`
  - migration metadata fields

## 5) Verify in app

Resource URLs are resolved from `assets` in shared-resource path. After upload, PDFs should open from cloud URL/base URL without tenant duplication.

