# Render Pilot Recovery Runbook

Use this runbook for the pilot-safe Render deployment.

## Source Of Truth URLs

- Frontend: `https://<your-frontend-service>.onrender.com/`
- Backend health: `https://<your-backend-service>.onrender.com/api/v1/health`

## First Triage

1. Open the frontend root URL.
2. Open the backend health URL.
3. Check whether the problem is:
   - client-only
   - backend-only
   - external dependency related (`Atlas`, `S3`, `Resend`)

## If The Frontend Is Broken

1. Open the Render client service.
2. Check the latest deploy logs and health status.
3. Redeploy the current commit if the failure is clearly transient.
4. If that does not recover the site, roll back to the last healthy deploy.
5. Re-test:
   - `/`
   - login page
   - one authenticated page after login

## If The Backend Is Broken

1. Open the Render server service.
2. Check logs for:
   - env/config errors
   - Atlas connectivity issues
   - S3 access failures
   - Resend failures
3. If the build is healthy but runtime is degraded, redeploy the current backend service once.
4. If the issue continues, roll back to the last healthy backend deploy.
5. Re-test:
   - `/api/v1/health`
   - student login
   - TPO login
   - one drive apply flow
   - one resource open

## Dependency Checks

### Atlas

- Confirm the Atlas cluster is reachable and the IP/network rules still allow Render.
- If health is degraded because of database connectivity, treat Atlas as the blocker rather than repeatedly redeploying the app.

### S3

- Confirm the bucket is reachable with the configured credentials.
- Verify one student resource opens from the deployed environment.

### Resend

- Confirm the sender domain is still verified.
- Run one communication preview and one real send if email behavior is the suspected issue.

## If A Drive Window Is Impacted

1. Decide whether students were blocked from login, drive view, or drive apply.
2. If any active registration window was affected, extend the drive deadline.
3. Use this notice:

`SmartPath had a temporary issue during the [company] drive window. The original deadline was [original deadline]. The new deadline is [extended deadline]. If you saw an error while applying, please log in again and re-submit before the new cutoff. Contact your TPO immediately if the issue continues.`

## Post-Incident Smoke Check

1. Backend `/api/v1/health`
2. Frontend root `/`
3. Student login
4. TPO login
5. Profile save
6. Resume upload
7. Drive apply
8. Resource open from S3
9. Mock test open and submit
10. TPO communication preview
11. Result release and result announcement path if the incident touched drive workflows

## Notes

- AI is intentionally out of launch scope and is not part of recovery signoff.
- Atlas, S3, and Resend are external managed dependencies; application rollback does not fix upstream outages.
- Keep the last known healthy client commit and server commit recorded after each successful deployment.
