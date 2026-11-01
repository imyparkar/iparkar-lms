# Backups and restore

The **Nightly encrypted backup** GitHub Action (`.github/workflows/nightly-backup.yml`) runs every
day at 01:17 Kuwait time. It dumps the whole `iparkar` (Mumbai) Supabase database — LMS tables,
question bank and the shared login accounts — encrypts it with your `BACKUP_PASSPHRASE`
(AES-256) and keeps it as a downloadable file for **30 days**. The same run also pings the
project so the Free plan never pauses it for inactivity.

The repository is public: backups are only safe because they are encrypted. Never upload an
unencrypted dump anywhere in this repository, and keep the passphrase in a password manager —
without it the backups cannot be opened.

## Check that backups are running

GitHub → **Actions** → **Nightly encrypted backup**. Each green run has a file
`iparkar-db-YYYYMMDD` under **Artifacts**. GitHub emails you if a run fails.

GitHub pauses scheduled workflows in a repository with no activity for 60 days and emails you
first. If that happens, open the workflow in **Actions** and click **Enable workflow**.

Run a backup at any time: **Actions → Nightly encrypted backup → Run workflow**.

## Open a backup

1. Download the artifact zip from the run page and unzip it to get `iparkar-db-YYYYMMDD.tar.gz.gpg`.
2. Decrypt and unpack (macOS: `brew install gnupg`; Windows: Gpg4win):

   ```sh
   gpg -d iparkar-db-YYYYMMDD.tar.gz.gpg | tar xz
   ```

   You get a folder `iparkar-backup/` with `schema.sql`, `data.sql`, `roles.sql`,
   `grants.sql`, `ROW_COUNTS.txt` and `CREATED_AT.txt`.

## Restore into a new, empty Supabase project

1. Create the project and enable the `pg_cron` extension (Database → Extensions).
2. Restore schema and data (session pooler connection string of the **new** project):

   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file iparkar-backup/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file iparkar-backup/data.sql \
     --dbname "postgresql://postgres.NEWREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
   ```

   `roles.sql` is not needed — the project has no custom roles.
3. Run `iparkar-backup/grants.sql` against the new project. It re-applies the exact table and
   function permissions (a new Supabase project grants broad defaults), the sign-up trigger on
   `auth.users` and the exam-expiry cron job. Then compare row counts with `ROW_COUNTS.txt`.
4. Copy the Auth settings (URL configuration, email templates, SMTP, CAPTCHA) and point the LMS
   and quiz Workers at the new project, as in `docs/DEPLOYMENT.md`.
