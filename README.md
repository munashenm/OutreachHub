# OutreachHub

Sales outreach, lead management, and CRM. Each customer organisation is a separate workspace.

The app includes authentication, prospects, companies, a product catalogue, supplier price files, numbered quotations, a compliance suppression list, a pipeline, campaign setup, Gmail sending, and an audit trail. A supplier row is saved only when its SKU already exists. A quotation keeps the prices staff entered, then receives a number and a validity date when it is sent.

## Local setup

1. Create a PostgreSQL database and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `SESSION_SECRET` (at least 32 characters), and `APP_URL`. For Gmail set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. For Microsoft 365 set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`. Optional `MICROSOFT_TENANT_ID` limits consent to one tenant; leave it empty for any work or school account. Also set `CRON_SECRET` and `OAUTH_ENCRYPTION_KEY` (32 bytes, or base64 for 32 bytes). Gmail scopes are `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly`. The Google redirect URI is `${APP_URL}/api/google/callback`. Schedule `POST /api/cron/gmail-sync` with `Authorization: Bearer $CRON_SECRET`. For template drafts set `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. Redirect URIs are `${APP_URL}/api/google/callback` and `${APP_URL}/api/microsoft/callback`.
3. Install and migrate:

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000 and create a workspace. Optional demo data:

```bash
npm run db:seed
```

The demo login is `demo@outreachhub.example` / `Demo-password-123`. The workspace is named Demo Workspace and flagged as demo data.

`docker-compose.yml` starts PostgreSQL if Docker is available.

## Railway

This service is the Urban Focus store. Set `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `CRON_SECRET`, `OAUTH_ENCRYPTION_KEY`, and the Google OAuth client values. `railway.toml` builds with `npm run build`, applies migrations with `npx prisma migrate deploy`, and starts with `npm start`. Leave the start command as `npm start`. Do not run `npm run db:seed` on this database.

After the first deploy, open `/register` and create the staff account. The workspace name is Urban Focus. Registration closes after that account exists. Then connect `sales@urbanfocus.co.za` under Settings → Mailboxes.

Schedule `POST /api/cron/gmail-sync` and `POST /api/cron/send` with `Authorization: Bearer $CRON_SECRET`.
