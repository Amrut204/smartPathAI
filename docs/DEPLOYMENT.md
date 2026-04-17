# Deployment Guide

The primary deployment path for this project is now:

- Render for hosting
- MongoDB Atlas for database
- AWS S3 for resource files
- Resend for email
- AI off at launch

Detailed Render launch and pilot operations guidance:

- [`PILOT_UPTIME_RUNBOOK.md`](./PILOT_UPTIME_RUNBOOK.md)

DigitalOcean remains a supported alternate path:

- [`DEPLOYMENT_DIGITALOCEAN.md`](./DEPLOYMENT_DIGITALOCEAN.md)

## Production Shape

### Backend
- runtime: Node/Express in Docker
- root directory: `server`
- listens on `PORT`

### Frontend
- runtime: Nginx in Docker
- root directory: `client`
- proxies `/api/*` to the backend using `API_UPSTREAM`

## Required Backend Environment Variables

- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `APP_JWT_SECRET`
- `APP_URL`
- `PORT`
- `NODE_ENV=production`
- `TRUST_PROXY=true`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `COMM_UNSUB_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_REGION`
- `STORAGE_MODE=s3`
- `STORAGE_S3_PUBLIC_BASE_URL`

Recommended:

- `RESOURCE_S3_BUDGET_ENABLED=true`
- `MONGO_STORAGE_GUARD_ENABLED=true`
- `MONGO_STORAGE_LIMIT_GB`
- `MONGO_STORAGE_WARNING_PCT`
- `MONGO_STORAGE_CHECK_TTL_MS`
- `RESOURCE_S3_READ_LIMIT_MONTHLY`
- `RESOURCE_S3_TRANSFER_LIMIT_GB_MONTHLY`

## Required Frontend Environment Variables

- `API_UPSTREAM=https://<backend-service>.onrender.com`

Optional frontend env values:

- `VITE_GOOGLE_FEEDBACK_URL`
- `VITE_WHATSAPP_SUPPORT_URL`
- `VITE_SUPPORT_EMAIL`

## Render Service Setup

### Backend

- Service Type: Web Service
- Environment: Docker
- Root Directory: `server`
- Health Check: `/api/v1/health`
- Required envs: use the backend contract above
- `APP_URL` must be the frontend public URL, not the backend URL

### Frontend

- Service Type: Web Service
- Environment: Docker
- Root Directory: `client`
- Environment Variable:
  - `API_UPSTREAM=https://<backend-service>.onrender.com`

## Pre-Deploy Checklist

1. Backend build passes:

```bash
cd server
npm run build
```

2. Frontend build passes:

```bash
cd client
npm run build
```

3. Confirm backend env values are set in Render.
4. Confirm frontend `API_UPSTREAM` points to the backend Render URL.
5. Confirm backend `APP_URL` matches the frontend Render URL.
6. Confirm `TRUST_PROXY=true` on the backend.
7. Confirm AI is intentionally off for launch by leaving `GROQ_API_KEY` unset.
8. Confirm S3 bucket permissions are correct.
9. Confirm the Resend sender is valid for the environment.
10. Confirm MongoDB Atlas network access allows Render.

## Post-Deploy Smoke Checks

1. `/api/v1/health` returns healthy.
2. Frontend `/` loads over Render without proxy errors.
2. TPO login works.
3. Student login works.
4. Profile save works.
5. Resume upload works.
6. Drive apply works.
7. Drive withdraw rules behave correctly.
8. A resource opens from S3.
9. Mock test open, submit, and results work.
10. Announcements load for a student.
11. A TPO communication preview works.
12. A real email send works through Resend.
13. Result release publishes the student-facing result announcement.

## Notes

- Redis is not required.
- SendGrid is not used.
- Gemini and OpenRouter are not used by the deployed app runtime.
- Groq-powered AI is intentionally excluded from first-launch signoff.
- Local scrape/import/audit folders are not required for Render deployment.
