# SmartPathAI (MERN)

SmartPathAI is a placement-readiness platform for two personas:
- Students: dashboard, AI assistant, resources, mock tests, topic mastery, company vault, profile
- TPO/Admin: student database, drives, analytics, communication workflows

## Tech Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: MongoDB
- Auth: Cookie-based JWT session flow

## Project Structure
- `client/` - frontend app
- `server/` - backend API and seed/import scripts
- `material/` - local study PDFs/text corpus (kept out of git)

## Prerequisites
- Node.js 20+
- MongoDB (local or remote)

## Setup
1. Install dependencies

```bash
npm install
cd server && npm install
cd ../client && npm install
```

2. Configure environment

```bash
# from project root
copy .env.example .env
# then update values as needed
```

Also create `server/.env` (or keep env vars in root and pass explicitly), including at minimum:
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `APP_JWT_SECRET`
- `GEMINI_API_KEY` (optional for AI provider; fallback works locally)

## Seed Data
This project includes a realistic seed that creates:
- 2 colleges (tenants)
- 80 students in first college
- 94 students in second college
- linked data for analytics, mock tests, attempts, study logs, mastery, drives, results, resources, vault, communication

Run:

```bash
cd server
npm run seed
```

Default demo credentials after seed:
- `tpo@apex.edu / Password@123`
- `admin@apex.edu / Password@123`
- `student001@apex.edu / Password@123`
- `tpo@nova.edu / Password@123`
- `admin@nova.edu / Password@123`
- `student001@nova.edu / Password@123`

## Run in Development
From root:

```bash
npm run dev
```

This runs:
- backend on the server dev port
- frontend on Vite dev port (usually `http://localhost:5173`)

## Important Security Notes
- Never commit `.env` or real API keys.
- Keep production secrets in a secret manager or CI/CD environment variables.
- `.gitignore` is configured to exclude env files, logs, local material data, and build artifacts.

## Useful Scripts
- Root: `npm run dev`
- Server: `npm run dev`, `npm run build`, `npm run seed`
- Client: `npm run dev`, `npm run build`

## License
Add your preferred license before public release.
