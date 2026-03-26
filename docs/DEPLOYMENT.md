# Deployment Guide

The primary deployment path for this project is now:

- DigitalOcean droplet for hosting
- MongoDB Atlas for database
- AWS S3 for resource files
- Resend for email

Detailed droplet instructions:

- [`DEPLOYMENT_DIGITALOCEAN.md`](./DEPLOYMENT_DIGITALOCEAN.md)

Render remains a supported secondary path.

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
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_REGION`
- `STORAGE_MODE=s3`
- `STORAGE_S3_PUBLIC_BASE_URL`
- `GROQ_API_KEY`

Recommended:

- `COMM_UNSUB_SECRET`
- `GROQ_MODEL`
- `GROQ_BUDGET_ENABLED=true`
- `RESOURCE_S3_BUDGET_ENABLED=true`

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
4. Confirm `APP_URL` matches the frontend Render URL.
5. Confirm S3 bucket permissions are correct.
6. Confirm the Resend sender is valid for the environment.
7. Confirm MongoDB Atlas network access allows Render.

## Post-Deploy Smoke Checks

1. `/api/v1/health` returns healthy.
2. TPO login works.
3. Student login works.
4. A resource opens from S3.
5. A TPO communication preview works.
6. A real email send works through Resend.

## Notes

- Redis is not required.
- SendGrid is not used.
- Gemini and OpenRouter are not used by the deployed app runtime.
- Local scrape/import/audit folders are not required for Render deployment.
