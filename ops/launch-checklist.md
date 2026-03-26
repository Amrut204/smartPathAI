# PlacementIQ Pilot Launch Checklist

## Before starting the server
- Confirm `.env` has `MONGODB_URI`, `MONGODB_DB_NAME`, and `APP_JWT_SECRET`
- Confirm `EMAIL_MODE=resend` for pilot unless you are intentionally using `mock`
- If `EMAIL_MODE=resend`, confirm `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
- Confirm the college sender/domain is verified in Resend
- Confirm client feedback env is set:
  - `VITE_GOOGLE_FEEDBACK_URL`
  - `VITE_WHATSAPP_SUPPORT_URL`
  - `VITE_SUPPORT_EMAIL`

## Startup checks
- Start the server and confirm there are no startup env validation errors
- Open `/api/v1/health` and confirm status is healthy
- Add the public health URL to UptimeRobot and verify alerts reach your email/phone
- Confirm the latest Mongo and material backups both completed successfully

## Email checks
- Send one credential email through `ops/student-onboarding`
- Send one TPO communication email from the college sender identity
- Release one demo drive result and confirm the result email lands in inbox, not just spam

## Onboarding checks
- Run `onboarding:preview` on the target batch file
- Review duplicate/error output before apply
- Run `onboarding:apply`
- Run `onboarding:verify`
- Do not run `onboarding:send` until verification passes

## Pilot data sanity
- Confirm seeded students can log in
- Confirm TPO can see only their own tenant data
- Confirm one student cannot access another student's data
- Confirm one drive application succeeds and a second apply is blocked cleanly
- Confirm a past-dated drive rejects new applications
- Confirm high-risk resources have been removed from the student catalog
- Confirm low-depth mock tests are not visible to students

## Pilot-visible surface
- Before changing pilot-visible UI, check `docs/pilot-mvp/FEATURE_FLAGS.md` for the current feature-flag map.
- Student: dashboard, announcements, drives, resources, mock tests, profile
- TPO: dashboard, students, drives/results/release, reports, communication
- Hidden for pilot: study guides, TPO analytics hub, TPO upload flow, sales/internal routes
- Keep `studentExpandedResources` off
- Keep `studentExpandedMockCatalog` off

## Pilot verification
- Complete one full student mock-test flow:
  - open a test
  - refresh during the attempt
  - submit
  - reopen the results page
- Verify one resource from each type on the deployed environment:
  - PDF
  - text/markdown
  - notebook
  - external link
  - missing-file error path
- Verify the feedback strip appears on:
  - dashboard
  - resources
  - mock tests
