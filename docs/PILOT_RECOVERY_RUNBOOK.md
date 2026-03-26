# Pilot Recovery Runbook

Use this runbook for the real pilot deployment, not the demo-only reset flow.

## Backup inputs

Expected backup jobs:

- Mongo archive backup from `server/scripts/backup-mongo.mjs`
- Material snapshot backup from `server/scripts/backup-material.mjs`

Default backup root:

- sibling folder outside the repo: `../pilot-backups/`

## Restore Mongo

1. Stop the API process.
2. Locate the latest Mongo archive file:
   - `mongo-backup-<db>-<timestamp>.archive.gz`
3. Restore with `mongorestore`:

```bash
mongorestore --uri="<your-uri>" --db="<your-db>" --archive="<path-to-archive>" --gzip --drop
```

4. Verify the restore completed without collection errors.

## Restore material

1. Locate the latest material snapshot folder:
   - `material-backup-<timestamp>/`
2. Replace the live `material/` directory contents with the snapshot contents.
3. Confirm the expected top-level folders exist again.

## Restart and verify

After both restores:

1. Start the server and client.
2. Verify `/api/v1/health`.
3. Log in as one student and one TPO.
4. Open one resource.
5. Start and submit one mock test.
6. Confirm results load after submission.

## If only legal cleanup must be rolled back

1. Restore Mongo from the pre-cleanup archive.
2. Restore the matching material snapshot or the targeted resource files.
3. Restart the app.
4. Confirm deleted resources are visible again only if the rollback decision is approved.
