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

This repository is prepared for containerized deployment. The current recommended path is:

- DigitalOcean droplet for hosting
- MongoDB Atlas for database
- AWS S3 for resource files
- Resend for email

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

Current production-oriented integrations also require:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_REGION`
- `STORAGE_MODE=s3`
- `STORAGE_S3_PUBLIC_BASE_URL`
- `GROQ_API_KEY`

Common optional runtime settings:

- `COMM_UNSUB_SECRET`
- `GROQ_MODEL`
- `GROQ_BUDGET_ENABLED`
- `GROQ_REQUEST_LIMIT_MONTHLY`
- `GROQ_TOKEN_LIMIT_MONTHLY`
- `GROQ_COST_LIMIT_USD_MONTHLY`
- `GROQ_WARNING_PCT`
- `RESOURCE_S3_BUDGET_ENABLED`
- `RESOURCE_S3_READ_LIMIT_MONTHLY`
- `RESOURCE_S3_TRANSFER_LIMIT_GB_MONTHLY`

## DigitalOcean Deployment

The recommended deployment path is a single Ubuntu droplet running:

1. `server` container
2. `client` container
3. host Nginx for domain + HTTPS

Use:

- compose file: [`docker-compose.digitalocean.yml`](./docker-compose.digitalocean.yml)
- backend env template: [`ops/digitalocean/server.env.example`](./ops/digitalocean/server.env.example)
- Nginx vhost template: [`ops/digitalocean/nginx/smartpath.conf.example`](./ops/digitalocean/nginx/smartpath.conf.example)
- full guide: [`docs/DEPLOYMENT_DIGITALOCEAN.md`](./docs/DEPLOYMENT_DIGITALOCEAN.md)

### Why this is the recommended path

- Atlas is already the live database
- S3 is already the live resource storage path
- Resend is already the live email path
- the droplet only needs to host the app containers

## Render Deployment

Render support is still documented, but it is now the secondary path.

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

#### Frontend service

- Root Directory: `client`
- Environment: `Docker`
- Start from [`client/Dockerfile`](./client/Dockerfile)
- Env var:
  - `API_UPSTREAM=https://<your-backend>.onrender.com`

### Important Render Notes

- set `APP_URL` on the backend to your frontend Render URL
- do not commit `.env` files
- use Render environment variables for all secrets
- use MongoDB Atlas for production
- use your production S3 bucket, not local files

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

## License

Add your preferred license before making the repository public.
