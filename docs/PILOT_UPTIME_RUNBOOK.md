# Pilot Uptime Runbook

Use this runbook for the live Smart Path pilot deployment on Render.

## Monitors To Create

Create two UptimeRobot HTTP monitors:

1. `Smart Path Client`
   - URL: `https://<your-frontend-service>.onrender.com/`
   - Expected: HTTP `200`
2. `Smart Path Server Health`
   - URL: `https://<your-backend-service>.onrender.com/api/v1/health`
   - Expected: HTTP `200` with healthy JSON

## Alert Channels

Configure all three if available:

- primary email
- backup email
- phone / SMS

Keep alerts enabled 24x7 during the pilot.

## Recommended Settings

- Interval: `5 minutes`
- Timeout: default
- Alert when down: `2 checks`
- Alert when back up: enabled

## Render Cold Start vs Real Outage

Cold start symptoms:
- first request is slow
- second request succeeds
- health endpoint recovers within about `60-90s`

Real outage symptoms:
- repeated `5xx`
- health endpoint keeps failing after `2-3` retries
- client loads but API stays broken

## Response Steps

### If client monitor fails
1. Open `https://<your-frontend-service>.onrender.com/`
2. Check browser console/network
3. Verify latest client deploy status on Render
4. If broken after redeploy, roll back to the last stable client commit

### If server monitor fails
1. Open `https://<your-backend-service>.onrender.com/api/v1/health`
2. Check Render server logs
3. Check Mongo connectivity and env values
4. Verify S3 access and one Resend send/preview path if the API is partially healthy
5. Restart or redeploy the server
6. Re-test login, dashboard, resources, and mock test start

## Smoke Test After Any Incident

1. Login as student
2. Open dashboard
3. Open announcements
4. Save profile
5. Open resources
6. Start one mock test
7. Login as TPO and open reports
8. Open TPO communication preview
9. Release one test drive result if the incident affected result workflows

## Rollback Rules

### Client rollback
1. Open the Render client service.
2. Select the last healthy deploy.
3. Trigger rollback/redeploy.
4. Re-test `/`, login, dashboard, and one proxied `/api` call.

### Server rollback
1. Open the Render server service.
2. Select the last healthy deploy.
3. Trigger rollback/redeploy.
4. Re-test `/api/v1/health`, student login, TPO login, one S3-backed resource, and one Resend-backed communication flow.

## If a drive window is impacted

1. Confirm whether the failure affected:
   - login only
   - backend only
   - drive apply flow specifically
2. If students were blocked during a live registration window, prepare and send the extension notice immediately.
3. Use this template:

`SmartPath had a temporary issue during the [company] drive window. The original deadline was [original deadline]. The new deadline is [extended deadline]. If you saw an error while applying, please log in again and re-submit before the new cutoff. Contact your TPO immediately if the issue continues.`

## Notes

- Render free tier can be slow; slow is not automatically down.
- The server monitor is the source of truth for real outages.
- Keep this runbook with the latest stable server/client commit ids.
- Atlas, S3, and Resend are external dependencies; an app redeploy alone will not fix upstream service issues.
