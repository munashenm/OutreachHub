# OutreachHub

OutreachHub receives business enquiries and turns them into quotations. Each customer organisation is a separate workspace.

It connects Gmail, reads the enquiry, extracts the products, specifications, and quantities, and searches Urban Focus through its API. Products that are not on Urban Focus are researched online. A match is compared with the request, priced from the verified cost Urban Focus returns, and can become a branded PDF quotation. The reply stays in the customer thread. Follow-ups and quotation status stay on the quotation record.

OutreachHub does not keep a second product catalogue, and it does not manage supplier feeds or push stock back to the website. The Urban Focus API is the product source. A sent quotation keeps the specification and images that were current when it was sent.

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

This service is OutreachHub for the Urban Focus store. Set `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `CRON_SECRET`, `OAUTH_ENCRYPTION_KEY`, and the Google OAuth client values. `railway.toml` builds with `npm run build`, applies migrations with `npx prisma migrate deploy`, and starts with `npm start`. Leave the start command as `npm start`. Do not run `npm run db:seed` on this database.

After the first deploy, open `/register` and create the staff account. The workspace name is Urban Focus. Registration closes after that account exists. Then connect `sales@urbanfocus.co.za` under Settings → Mailboxes, and save the Urban Focus API under Settings.

Keep the web service start command as `npm start` with no cron schedule. One extra Railway service uses `railway.gmail-sync.toml` to run `node scripts/gmail-sync.mjs` every 15 minutes. That run reads Gmail, prepares quotations, and checks follow-ups. Campaign sending, catalogue copying, and supplier stock sync are retired; those routes return without sending mail or writing products. `AUTO_RFQ_REPLIES_ENABLED` stays false until automatic customer email is approved. A password reset is emailed from the connected mailbox. Product search calls the Urban Focus catalogue endpoint with `q`, `sku`, or `mpn` and uses the selling price Urban Focus returns.
