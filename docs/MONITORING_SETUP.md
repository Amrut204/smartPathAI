# Monitoring Setup

This document is the runbook for keeping the demo environment healthy before, during, and after TPO calls.

If someone else needs to run a demo without asking for help, this file should be enough.

## UptimeRobot Setup

### Goal

Monitor the public demo health endpoint and get alerted before a TPO call starts.

### Endpoint to monitor

Use:

```text
https://yourapp.com/health/demo
```

If your deployment only exposes the versioned path, use:

```text
https://yourapp.com/api/health/demo
```

Check which one is live in your deployment and use the public one consistently.

### Step-by-step

1. Go to `https://uptimerobot.com/`
2. Create an account or log in
3. Click `Add New Monitor`
4. Set monitor type to `HTTP(s)`
5. Name it something clear, for example:
   `PlacementIQ Demo Health`
6. Paste the monitor URL:
   `https://yourapp.com/health/demo`
7. Set check interval to `5 minutes`
8. Add alert contacts:
   email
   SMS if your plan supports it
9. Save the monitor

### Recommended monitor settings

- Monitor type: `HTTP(s)`
- Interval: `5 minutes`
- Timeout: default is fine
- Alert channels: email first, SMS second
- Friendly name: include `demo` in the name so alerts are obvious

### What healthy looks like

Expected response:

- HTTP status `200`
- JSON `status: "healthy"`
- All `checks.*` fields set to `true`

### What to do when an alert fires

1. Open the health URL manually in a browser or with `curl`
2. Run `npm run pre-demo`
3. If health is failing because demo data is missing or stale, run:

```bash
npm run seed:demo:reset
```

4. Re-run:

```bash
npm run pre-demo
```

5. If health still fails, check:
   deployment status
   Mongo connection
   environment variables
6. If a live demo is within 30 minutes, switch to backup screenshots immediately

## Demo Pre-Check Routine

### When to run it

Run the pre-demo check:

- at the start of every day with scheduled demos
- 1 hour before every live TPO call
- after every deployment
- after any database reset or demo data change

### Command

```bash
npm run pre-demo
```

### How to interpret the result

If you see:

```text
DEMO READY - All checks passed
```

you can proceed.

If you see:

```text
DEMO NOT READY - Fix issues below
```

do not start the call until the listed failures are cleared or you have switched to backup material.

### Common failures and fixes

#### Demo data reset failed

Likely causes:

- MongoDB not reachable
- missing environment variables
- seed script error

Fix:

1. Check server env values
2. Confirm database access
3. Run:

```bash
npm run seed:demo:reset
```

again after fixing env or DB access.

#### Demo health check failed

Likely causes:

- tenant missing
- demo TPO account missing
- seed incomplete
- deployment routing issue

Fix:

1. Run:

```bash
npm run seed:demo:reset
```

2. Verify health manually:

```bash
curl https://yourapp.com/health/demo
```

3. Confirm the deployed app is pointing at the expected database

#### Automated tests failed

Likely causes:

- demo login route broken
- dashboard payload changed
- mock-test flow broken

Fix:

1. Run:

```bash
npm run test:demo
```

2. Read the failing test name
3. Fix the route or seed mismatch
4. Re-run `npm run pre-demo`

### Emergency contacts

Replace these with real values in your team copy of this document:

- Primary owner: `your-email@domain.com`
- Backup phone: `+91-XXXXX-XXXXX`
- Escalation contact: `team lead / cofounder / devops owner`

## Demo Day Checklist

### 1 hour before

Run the full pre-demo check:

```bash
npm run pre-demo
```

Do not skip this.

### 30 minutes before

Verify these URLs manually in a clean browser session:

- TPO demo
- Student demo
- Landing page

Expected links:

- `https://yourapp.com/demo/auto-login-tpo`
- `https://yourapp.com/demo/auto-login-student`

If your deployment uses API-prefixed demo login routes, verify those exact URLs instead.

### 15 minutes before

- clear browser cache
- close old tabs
- sign out of any stale sessions
- open the demo in the browser you will screen share

### Right before the call

- keep backup screenshots ready
- keep the health endpoint open in another tab
- keep terminal access available for `npm run seed:demo:reset` if needed

### During the demo

- do not improvise new paths
- stick to the 7-minute flow
- if the live app slows down, move to screenshots instead of waiting awkwardly

### After the demo

Log feedback immediately using the internal feedback page.

Recommended path:

- open the demo feedback form
- capture objections, feature requests, pain points, and next steps before memory fades

## Incident Response

### Demo breaks during the call

What to do:

1. Do not debug live on the call for more than 30 seconds
2. Say:
   `The live demo environment is having a temporary issue. I’ll show you the workflow using prepared screenshots while I restore it.`
3. Switch to backup screenshots immediately
4. After the call, run:

```bash
npm run seed:demo:reset
npm run pre-demo
```

### Demo data corrupted

Symptoms:

- empty dashboard
- missing drives
- no students
- login works but pages look blank

Fix:

```bash
npm run seed:demo:reset
```

Then verify:

```bash
npm run pre-demo
```

### Server down

Fallback plan:

1. Confirm deployment status
2. Check UptimeRobot alert details
3. Restart or redeploy the server
4. If the call is active, switch to:
   screenshots
   static deck
   recorded walkthrough

### Network issues

If your internet is unstable:

1. use mobile hotspot backup
2. keep screenshots exported locally
3. keep a PDF or slide deck of the TPO dashboard, student eligibility view, and mock-test flow
4. if needed, run an offline screen walkthrough using screenshots plus script

## Command Reference

### Reset demo data

```bash
npm run seed:demo:reset
```

### Run pre-demo verification

```bash
npm run pre-demo
```

### Check demo health manually

```bash
curl https://yourapp.com/health/demo
```

### Run demo tests

```bash
npm run test:demo
```

## Troubleshooting

### Demo login fails

Symptoms:

- demo login page shows error page
- auto-login does not redirect

Check:

1. demo tenant exists
2. demo TPO/student accounts exist
3. JWT secret is configured
4. cookies are being set correctly

Fix:

```bash
npm run seed:demo:reset
npm run test:demo
```

Then retry the demo URL.

### Dashboard is empty

Symptoms:

- login succeeds
- dashboard loads but has no students, drives, or mock activity

Likely cause:

- demo data missing or incomplete

Fix:

```bash
npm run seed:demo:reset
```

Then confirm:

```bash
curl https://yourapp.com/health/demo
```

### Slow loading

Symptoms:

- dashboard eventually works but takes too long for a live demo

Check:

- deployment region
- server load
- database latency
- local internet quality

Action:

1. refresh once
2. if still slow, switch to screenshots
3. after the call, inspect hosting logs and DB performance

### Health endpoint failing

If `/health/demo` returns `500`:

1. open the JSON response
2. check which `checks.*` field is false
3. fix only that layer first
4. re-run:

```bash
npm run pre-demo
```

## Minimum Safe Demo Process

If time is short, do these three things in order:

1. `npm run seed:demo:reset`
2. `npm run pre-demo`
3. open both demo URLs manually before the call

If all three work, the demo is safe enough to use live.
