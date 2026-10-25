# Deploying with Dockhand

The stack is `docker-compose.yml`: the app (built from this repo's `Dockerfile`) and MySQL 8.4 with its data in the `mysql-data` named volume. Each start runs `drizzle-kit migrate` before the server, so a Dockhand git sync that rebuilds the app also applies any new schema migrations.

The app listens on host port **38417**. Session cookies are `Secure`, so put it behind HTTPS (reverse proxy) and set `APP_URL` to that public URL. Over plain `http://<ip>:38417` the browser drops the cookie and sign-in will not stick.

## Environment variables

| Variable | Example | Notes |
|---|---|---|
| `APP_URL` | `https://bills.example.com` | Public URL; used for links in emails. |
| `NUXT_SESSION_PASSWORD` | `openssl rand -hex 32` | 32+ characters. Changing it signs everyone out. |
| `MYSQL_PASSWORD` | `openssl rand -hex 24` | App user password. Hex only: it is embedded in the database URL. |
| `MYSQL_ROOT_PASSWORD` | `openssl rand -hex 24` | Used for the cutover import. |
| `MAIL_URL` | `smtp://user:pass@smtp.example.com:587` | Use `smtps://...:465` for implicit TLS. URL-encode special characters in the user and password. |
| `MAIL_FROM` | `Ledford Bills <bills@example.com>` | Must be a sender your SMTP provider allows. |
| `MAIL_TRANSPORT` | *(empty)* | Leave empty in production. `log` prints mail to the container log instead of sending. |

`TZ` is fixed to `America/New_York` in the compose file. Scheduled jobs run on that clock: recurring bills at 00:05 daily, the unpaid-bills reminder at 08:00 on the 3rd and 6th.

## Cutover from the old Laravel database

Run these on the Docker host. `<stack>` is the compose project name Dockhand shows (containers are `<stack>-db-1` and `<stack>-app-1`).

1. **Stop the old app** so nothing changes during the copy.
2. **Dump the old database:**

   ```sh
   mysqldump -h <old-host> -u <user> -p --single-transaction --no-tablespaces --set-gtid-purged=OFF <old_db> > legacy.sql
   ```

3. **Load it into the new MySQL as a separate database:**

   ```sh
   docker exec -i <stack>-db-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE ledford_bills_flux"'
   docker exec -i <stack>-db-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ledford_bills_flux' < legacy.sql
   ```

   The `-i` is required: without it the file never reaches MySQL and the import silently does nothing. Check the tables arrived:

   ```sh
   docker exec <stack>-db-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW TABLES" ledford_bills_flux'
   ```

   If that is empty, the dump probably has its own `USE <old_db>` line (made with `--databases`); `grep -m3 -E "^(CREATE DATABASE|USE )" legacy.sql` shows the name to use in the next step instead.

4. **Dry run, then copy into the new schema.** The app has already created the new tables on start. The target must have no users yet, and no emails are sent during the copy.

   ```sh
   docker exec <stack>-app-1 sh -c 'LEGACY_DATABASE_URL=mysql://root:ROOT_PASSWORD@db:3306/ledford_bills_flux npm run migrate:legacy -- --dry-run'
   docker exec <stack>-app-1 sh -c 'LEGACY_DATABASE_URL=mysql://root:ROOT_PASSWORD@db:3306/ledford_bills_flux npm run migrate:legacy -- --card-owner=2'
   ```

   Replace `ROOT_PASSWORD` with your `MYSQL_ROOT_PASSWORD`.

   `--card-owner` is the legacy user id that receives "Card Ready to Pay" emails (the old app hard-coded user 2). It can be changed later in Settings.

5. **Sign in.** Old passwords keep working. The first sign-in on each device emails a 6-digit code, which confirms SMTP works.
6. **Optional cleanup** once satisfied:

   ```sh
   docker exec -i <stack>-db-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE ledford_bills_flux"'
   ```

## Notifications carried over from the old app

| Email | Sent to | When |
|---|---|---|
| New Bill Added | Each person on the bill | A bill is created, including bills generated from recurring templates |
| Card Ready to Pay | Card owner (Settings) | The last person pays their share |
| Reimbursement Submitted | Creator | A reimbursement is created (manually or from a recurring template) |
| New Reimbursement | The person who owes | Same as above |
| Transfer Complete | Creator | The other person marks the transfer sent |
| Unpaid Bills Reminder | Everyone | 08:00 on the 3rd and 6th, if last month has unpaid shares or card payments |

Sign-in codes, password resets, and email-change confirmations are new in this app.
