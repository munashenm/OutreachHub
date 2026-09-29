# OutreachHub

Sales outreach, lead management, and CRM. Each customer organisation is a separate workspace.

Phase 1 includes authentication, prospects, companies, a compliance suppression list, a pipeline, campaign setup, and an audit trail. It does not send email, call an AI provider, or bill customers.

## Local setup

1. Create a PostgreSQL database and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, `SESSION_SECRET` (at least 32 characters), and `APP_URL`.
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

Set `DATABASE_URL`, `SESSION_SECRET`, and `APP_URL`. Build with `npm run build`, start with `npm start`, and run `npx prisma migrate deploy` as the release command.
