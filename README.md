# SmartPath

SmartPath is a campus placement platform for colleges, TPO teams, and students.

It combines:
- student dashboards
- placement drives and eligibility workflows
- mock tests and study resources
- TPO communication and reporting
- S3-backed resource delivery
- Resend-based email communication
- Groq-powered AI features with app-side budget guardrails

## Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Database: MongoDB
- Storage: AWS S3
- Email: Resend
- AI: Groq

## Repo Structure

- [`client/`](./client) frontend app
- [`server/`](./server) backend API, services, scripts, tests
- [`docs/`](./docs) deployment and project notes

This repository is prepared for containerized deployment. The current recommended launch path is:

- Render for hosting
- MongoDB Atlas for database
- AWS S3 for resource files
- Resend for email
- AI off for the first pilot rollout

Local-only folders like scraped data, backups, reports, and material archives are ignored.

## Core Product Areas

### Student
- dashboard and profile
- drives and eligibility status
- resources and PDF viewer
- mock tests
- announcements
- study guides

### TPO / Admin
- student management
- drive creation and result workflows
- bulk communication
- reports and analytics
- storage visibility

## Runtime Architecture

- The backend connects to one MongoDB database selected through environment variables.
- Student resource files are intended to be served from S3.
- Emails are sent through Resend.
- AI runtime is Groq-only in the deployed app.
- Communication queue is inline-only. Redis is not required.

## Local Development

### Prerequisites

- Node.js 20+
- MongoDB

### Install

```bash
npm install
cd server && npm install
cd ../client && npm install
```

### Start

From the repo root:

```bash
npm run dev
```

- backend: `http://localhost:5000`
- frontend: `http://localhost:5173`

## Required Server Environment Variables

At minimum:

- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `APP_JWT_SECRET`
- `APP_URL`
- `NODE_ENV`
- `PORT`

Current production-oriented integrations required for the Render pilot launch:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `COMM_UNSUB_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_REGION`
- `STORAGE_MODE=s3`
- `STORAGE_S3_PUBLIC_BASE_URL`
- `TRUST_PROXY=true`

Common optional runtime settings:

- `GROQ_MODEL`
- `GROQ_BUDGET_ENABLED`
- `GROQ_REQUEST_LIMIT_MONTHLY`
- `GROQ_TOKEN_LIMIT_MONTHLY`
- `GROQ_COST_LIMIT_USD_MONTHLY`
- `GROQ_WARNING_PCT`
- `RESOURCE_S3_BUDGET_ENABLED`
- `RESOURCE_S3_READ_LIMIT_MONTHLY`
- `RESOURCE_S3_TRANSFER_LIMIT_GB_MONTHLY`
- `DEMO_AUTO_LOGIN_ENABLED` (set `true` to enable `/api/v1/demo/auto-login-*` routes in production)

Client optional runtime settings:

- `VITE_ENABLE_DEMO_AUTO_LOGIN` (set `true` to show demo auto-login links in the login page on production builds)

## Render Deployment

Render is the primary launch path for the pilot-safe production rollout.

This repo is set up for a two-service Render deployment:

1. `server` as a Web Service
2. `client` as a Web Service served by Nginx

### Why the client is a web service instead of a static site

The frontend uses relative `/api/...` calls. The client Nginx layer proxies `/api/` to the backend service, which keeps cookies, CSRF, and routing simple.

### Client proxy configuration

The client Docker image expects:

- `API_UPSTREAM`

Example:

```text
https://your-backend-service.onrender.com
```

The client Nginx config injects this at container start and proxies `/api/*` to the backend.

### Suggested Render Setup

#### Backend service

- Root Directory: `server`
- Environment: `Docker`
- Start from [`server/Dockerfile`](./server/Dockerfile)
- Health check: `/api/v1/health`
- Set `APP_URL` to the public frontend Render URL
- Set `TRUST_PROXY=true`

#### Frontend service

- Root Directory: `client`
- Environment: `Docker`
- Start from [`client/Dockerfile`](./client/Dockerfile)
- Env var:
  - `API_UPSTREAM=https://<your-backend>.onrender.com`
- Health check: `/`

### Important Render Notes

- set `APP_URL` on the backend to your frontend Render URL
- do not commit `.env` files
- use Render environment variables for all secrets
- use MongoDB Atlas for production
- use your production S3 bucket, not local files
- keep AI off for the first launch by leaving `GROQ_API_KEY` unset
- treat AI flows as non-blocking until after the pilot launch is stable

## DigitalOcean Deployment

DigitalOcean remains an alternate deployment path, not the primary launch recommendation for this tranche.

Use:

- compose file: [`docker-compose.digitalocean.yml`](./docker-compose.digitalocean.yml)
- backend env template: [`ops/digitalocean/server.env.example`](./ops/digitalocean/server.env.example)
- Nginx vhost template: [`ops/digitalocean/nginx/smartpath.conf.example`](./ops/digitalocean/nginx/smartpath.conf.example)
- full guide: [`docs/DEPLOYMENT_DIGITALOCEAN.md`](./docs/DEPLOYMENT_DIGITALOCEAN.md)

## Build Commands

Root:

```bash
npm run build
```

Server only:

```bash
cd server
npm run build
```

Client only:

```bash
cd client
npm run build
```

## Student PRN Backfill Utility

Use the PRN backfill utility to populate `profile_data.prn` for legacy student rows that still have empty PRN values.

Dry-run from repo root (recommended first):

```bash
npm run students:prn:backfill:dry
```

Apply updates from repo root:

```bash
npm run students:prn:backfill
```

Scoped or capped runs (from `server/`):

```bash
npx tsx scripts/backfill-student-prn.ts --tenant-id=<tenant_id> --max-updates=500
npx tsx scripts/backfill-student-prn.ts --apply --tenant-id=<tenant_id> --max-updates=500
```

Each run writes a JSON report to `server/storage_reports/student-prn-backfill-<timestamp>.json` with:

- total scan counts
- duplicate PRN detection summary
- backfill candidates and conflict samples
- update outcomes (dry-run or apply mode)

## Demo Credentials

Seeded demo users vary by database/seed script. Keep demo credentials out of public production documentation if this repository becomes public.

## Security Notes

- Never commit real secrets.
- Rotate any secret that has ever been pasted into chat, screenshots, or committed history.
- Keep S3 access limited to required actions only.
- Use verified Resend sender domains for production mail.
- Review resource licensing before public or commercial rollout.

## Current Deployment Assumptions

- emails use Resend
- sender fallback uses the configured `RESEND_FROM_EMAIL`
- tenant branding changes the visible sender name
- resources are expected to be S3-backed in production
- local scripts for scraping/import/auditing are not required for Render runtime
- AI is off for the first pilot rollout unless deliberately enabled later

## License

Add your preferred license before making the repository public.
