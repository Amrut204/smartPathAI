# Pilot Recovery Runbook

Use this for the real PM2-backed pilot deployment on a single VPS. The goal is to make the recovery path executable even at 2am without relying on memory.

## Backup destination and schedule

Primary off-machine backup destination:

- `Cloudflare R2`
- Mongo archives: `backups/mongo/`
- Material snapshots: `backups/material/`

Local backup staging:

- sibling folder outside the repo: `../pilot-backups/`
- this is a staging location only, not the final retention target

Nightly backup schedule:

```bash
0 2 * * * cd /var/www/smartpath/server && /usr/bin/node ./scripts/backup-mongo.mjs >> /var/log/smartpath-backup.log 2>&1
15 2 * * * cd /var/www/smartpath/server && /usr/bin/node ./scripts/backup-material.mjs >> /var/log/smartpath-backup.log 2>&1
```

Before go-live, confirm the R2 env is present on the VPS:

```bash
echo "$CLOUDFLARE_R2_ACCOUNT_ID"
echo "$CLOUDFLARE_R2_BUCKET"
```

## Immediate incident triage

### 1. Check application health

```bash
pm2 status
pm2 logs --lines 100
curl -fsS http://127.0.0.1:4000/api/v1/health
```

### 2. If Node is down, restart the app

```bash
pm2 restart all
pm2 status
pm2 logs --lines 100
curl -fsS http://127.0.0.1:4000/api/v1/health
```

### 3. If Mongo is the issue, verify and restart it

```bash
sudo systemctl status mongod
sudo systemctl restart mongod
sudo systemctl status mongod
```

### 4. If the VPS is unreachable

1. Open the hosting provider panel.
2. Verify the droplet/instance state.
3. Trigger a provider reboot if the machine is hung.
4. Re-run the PM2 and Mongo checks after SSH access returns.

## Restore Mongo

1. Download the latest archive and metadata from Cloudflare R2 under `backups/mongo/`.
2. Stop the app before restore:

```bash
pm2 stop all
```

3. Restore with `mongorestore`:

```bash
mongorestore --uri="mongodb://127.0.0.1:27017" --db="<your-db>" --archive="/tmp/mongo-backup-<db>-<timestamp>.archive.gz" --gzip --drop
```

4. Confirm the restore completed without collection errors.

## Restore material

1. Download the latest material snapshot files from `backups/material/material-backup-<timestamp>/`.
2. Replace the live material contents:

```bash
rm -rf /var/www/smartpath/material/*
cp -R /tmp/material-backup-<timestamp>/* /var/www/smartpath/material/
```

3. Confirm the expected top-level folders are back in place.

## Restart and verify

Restart the app:

```bash
pm2 restart all
pm2 status
curl -fsS http://127.0.0.1:4000/api/v1/health
```

Post-restore validation checklist:

1. Verify the health endpoint returns success.
2. Log in as one student.
3. Log in as one TPO.
4. Open one resource.
5. Start and submit one mock test.
6. Verify the most recent active drive application count matches the recorded checkpoint in the backup metadata file.

The backup metadata now records:

- `activeDriveApplicationCheckpoint.driveId`
- `activeDriveApplicationCheckpoint.applicationCount`

Use that count as the post-restore comparison target.

## Restore drill acceptance gate

Before go-live, run one full restore rehearsal and record:

- actual start time
- actual finish time
- total recovery duration
- most recent active drive application count before restore
- most recent active drive application count after restore

Treat the measured duration as the current working recovery expectation. Do not claim a formal RTO until one full restore drill has passed.

## Incident communication templates

### Generic maintenance notice

`SmartPath is currently under maintenance. We expect to restore service by [time]. Drive deadlines will be extended if impacted. Contact your TPO for urgent queries.`

### TPO-facing impact note

`SmartPath is currently experiencing a service interruption affecting [module/workflow]. Recovery is in progress. We will confirm restoration time shortly and extend any impacted drive windows if needed.`

### Drive deadline extension notice

`SmartPath experienced a temporary issue during the [company] drive registration window. The original deadline was [original deadline]. The new deadline is [extended deadline]. If you previously tried to apply and saw an error, please log in again and resubmit before the new cutoff. Contact your TPO immediately if the error still appears.`

## If only legal cleanup must be rolled back

1. Restore Mongo from the pre-cleanup archive.
2. Restore the matching material snapshot or targeted resource files from R2.
3. Restart the app with `pm2 restart all`.
4. Confirm deleted resources are visible again only if the rollback decision is approved.
