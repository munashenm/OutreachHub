# OutreachHub

Sales outreach, lead management, and CRM. Each customer organisation is a separate workspace.

The app includes authentication, prospects, companies, a product catalogue, supplier stock feeds, numbered quotations, a compliance suppression list, a pipeline, campaign setup, Gmail sending, and an audit trail. A supplier feed can be JSON, XML, a CSV address, or a manual CSV. Each feed is stored as a supplier offer. The catalogue price follows a fresh offer that has stock for one unit, then cost, preference, and lead time. Website stock follows that same selected offer and is not a total of every supplier. A missing cost is not used, a price below the workspace minimum margin is not written, and a sell-price move of 15% or more waits for approval. Those quantities can be published to the Urban Focus store through its API. A daily run reads the supplier feed, then sends stock — and a price that still meets the minimum margin — in batches of 40 until the queue is empty or the run has to stop. Products that already exist on the website keep the website name, description, images, and publication state. Supplier products that are not on the website stay stored in OutreachHub and are not created on the website unless they were explicitly marked ready to publish. The existing website catalogue is read first and stored as the baseline. That read does not change the website. A later send updates a product that already exists and does not create a second product for the same SKU, part number, or barcode. Website orders are imported on the same stock sync and linked when the billing email already exists. Pending, processing, and on-hold lines that match a catalogue SKU reduce the quantity left and the quantity sent to the website. Products with a supplier record, or with stock already held, appear as short when nothing is left. A draft quotation warns when its lines ask for more than that. A draft follows the current catalogue specification and image addresses. Sending the quotation stores that copy on each line, so a later catalogue edit does not change the sent email or the printable quotation.

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

The demo login is `sales@cyberdevelopers.co.za` / `23846423`. The workspace is named Demo Workspace and flagged as demo data.

`docker-compose.yml` starts PostgreSQL if Docker is available.

## Railway

This service is the Urban Focus store. Set `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `CRON_SECRET`, `OAUTH_ENCRYPTION_KEY`, and the Google OAuth client values. `railway.toml` builds with `npm run build`, applies migrations with `npx prisma migrate deploy`, and starts with `npm start`. Leave the start command as `npm start`. Do not run `npm run db:seed` on this database.

After the first deploy, open `/register` and create the staff account. The workspace name is Urban Focus. Registration closes after that account exists. Then connect `sales@urbanfocus.co.za` under Settings → Mailboxes.

Keep the web service start command as `npm start` with no cron schedule. Add four more Railway services, each with the same `APP_URL` and `CRON_SECRET` as the web service. `railway.gmail-sync.toml` runs `node scripts/gmail-sync.mjs` every 15 minutes. `railway.send.toml` runs `node scripts/send.mjs` every 15 minutes. `railway.stock-sync.toml` runs `node scripts/stock-sync.mjs` once a day at 21:00 South African time. `railway.catalogue-read.toml` runs `node scripts/catalogue-read.mjs` once an hour and continues the website catalogue read for up to 45 seconds. Each command posts to its `/api/cron/` route with `Authorization: Bearer $CRON_SECRET` and exits. Inbound mail and RFQs come from the Google mailbox. A password reset is emailed from that mailbox.
