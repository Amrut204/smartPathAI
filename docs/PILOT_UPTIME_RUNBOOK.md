# Pilot Uptime Runbook

Use this runbook for the live Smart Path pilot deployment.

## Monitors To Create

Create two UptimeRobot HTTP monitors:

1. `Smart Path Client`
   - URL: `https://campusdrive.me/`
   - Expected: HTTP `200`
2. `Smart Path Server Health`
   - URL: `https://smartpath-server.onrender.com/api/v1/health`
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
1. Open `https://campusdrive.me/`
2. Check browser console/network
3. Verify latest client deploy status on Render
4. If broken after redeploy, roll back to the last stable client commit

### If server monitor fails
1. Open `https://smartpath-server.onrender.com/api/v1/health`
2. Check Render server logs
3. Check Mongo connectivity and env values
4. Restart or redeploy the server
5. Re-test login, dashboard, resources, and mock test start

## Smoke Test After Any Incident

1. Login as student
2. Open dashboard
3. Open announcements
4. Open resources
5. Start one mock test
6. Login as TPO and open reports

## Notes

- Render free tier can be slow; slow is not automatically down.
- The server monitor is the source of truth for real outages.
- Keep this runbook with the latest stable server/client commit ids.
