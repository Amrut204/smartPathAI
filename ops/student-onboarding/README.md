# Student Onboarding Ops

This folder contains a separate operational onboarding workflow for seeding student accounts against a deployed environment without restarting the live site.

## Commands

```powershell
node ops/student-onboarding/preview.mjs --tenant <slug> --file <path>
node ops/student-onboarding/apply.mjs --tenant <slug> --file <path>
node ops/student-onboarding/verify.mjs --tenant <slug> --batch <batchId>
node ops/student-onboarding/send-credentials.mjs --tenant <slug> --batch <batchId>
node ops/student-onboarding/run.mjs --tenant <slug> --file <path>
```

Root `package.json` also exposes matching `npm run onboarding:*` shortcuts.

## Required environment

The scripts read config from `server/.env`, root `.env`, and the current process environment.

Required:

- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `STUDENT_ONBOARDING_SECRET` or `APP_JWT_SECRET`

Email sending:

- `EMAIL_MODE=mock` writes mock delivery files into `ops/student-onboarding/output/<batchId>/`
- `EMAIL_MODE=sendgrid` requires `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `APP_URL`

## Input columns

Required:

- `fullName`
- `email`
- `rollNumber`
- `branch`
- `batch`

Optional seeded fields:

- `prn`
- `degree`
- `currentSemester`
- `cgpa`
- `backlogs`
- `totalHistoricalBacklogs`
- `attendancePct`

A starter file is included at [student-import-template.csv](/c:/vscode/smartPathAI-mern/ops/student-onboarding/templates/student-import-template.csv).

## Output artifacts

Each batch writes to `ops/student-onboarding/output/<batchId>/`:

- `summary.json`
- `errors.csv`
- `credentials.enc.json`
- mock email files when `EMAIL_MODE=mock`

The encrypted manifest contains plaintext temporary passwords and must stay local to the operator machine.
