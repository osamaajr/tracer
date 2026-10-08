# Production deployment plan

## Architecture

- The existing Vercel project serves `apps/web` at `www.tracercart.com`.
- A second Vercel project, linked to the same GitHub repository with Root Directory `apps/api`, serves the Fastify API at `api.tracercart.com`.
- Neon Postgres, provisioned from the Vercel Marketplace, holds protected-purchase state. Each update locks one JSONB state row in a transaction, preserving the existing repository behavior across concurrent functions. The existing normalized schema is reserved for a later scale-up migration.
- Vercel Cron invokes a secret-protected monitoring route daily at 06:00 UTC. The extension can also request an immediate price check for a protected purchase. Vercel Hobby does not permit the local server's 12-hour cron interval.
- Saved watchlist items and their price checks remain in Chrome storage. The API is used for protected purchases.
- The extension generates a random 256-bit installation token, stores it in trusted extension storage, and sends it over HTTPS. The API derives a SHA-256 user key. There is no account sign-in or cross-device sync.

## Release sequence

1. Review and merge the API, extension, lockfile, and `apps/api/vercel.json` changes to `main`.
2. In the existing Vercel account, import `osamaajr/tracer` as a **new** project for the API. Set its Root Directory to `apps/api`, Framework Preset to **Fastify**, Production Branch to `main`, and Node version to **24.x**. `apps/api/vercel.json` pins the install command to `npm install --include=dev`. Keep the existing website project and its settings.
3. In the Vercel Marketplace, provision a Neon Postgres database in a European region close to the API function, connect it to the API project, and confirm the project has a `DATABASE_URL` environment variable. Do not connect a production deployment to a temporary preview database.
4. Generate a random `CRON_SECRET` of at least 32 bytes and set it as a Production environment variable on the API project. Vercel sends it as a Bearer token when the daily cron runs. Redeploy after the database and secret are connected.
5. Confirm the deployment's `/health` route returns `{"ok":true,"service":"tracer-api"}`. A failed database connection prevents startup or returns an error on health checks.
6. Add `api.tracercart.com` to the API project. In IONOS DNS, add the `api` CNAME target Vercel shows. Wait for Vercel to verify DNS and issue TLS.
7. Build the customer extension from the repository root:

   ```bash
   VITE_TRACER_API_BASE_URL=https://api.tracercart.com \
   VITE_TRACER_DASHBOARD_BASE_URL=https://www.tracercart.com \
   npm run build:release -w @tracer/extension
   ```

8. Package only `apps/extension/release` (manifest version `0.1.4`) and upload the ZIP to the existing Chrome Web Store draft. The release build keeps the local `apps/extension/dist` demo untouched. Complete the listing, privacy declarations, and required screenshots before submitting it for review.
9. On an installed extension, verify a saved-item check, a protected purchase, `/api/dashboard`, an immediate protected-purchase price check, and the next daily cron invocation. Check that an older localhost override is ignored after the customer build is installed.

## Configuration and operations

The API project uses the repository's npm workspace install. Its build typechecks the source and bundles the API with its shared workspace packages into `dist/server.cjs`; the root `index.js` is Vercel's Fastify entry point. `apps/api/vercel.json` sets the function region to London and the daily cron. The in-process scheduler is disabled on Vercel. Local development continues to use the 12-hour scheduler and `.tracer-data/dev-store.json` when no database URL is set.

The database holds purchase details and price history. Monitor database usage and API logs after deploys, and export a backup before changing storage formats. The single JSONB state row suits an initial small beta; migrate to the existing normalized tables before the data or request volume grows substantially. The in-memory request limiter is only a per-function-instance guard; configure Vercel Firewall rules if public traffic grows.

The installation token is an anonymous bearer credential. Losing Chrome extension storage loses access to that installation's protected purchases. It does not provide account recovery, cross-device sync, or protection against someone who gains access to the browser profile.

The local pretend saved-item drop is a development override. `build:release` rejects non-empty price-drop overrides so the customer package can only show detected prices.

## Rollback

If the API deploy fails, restore the previous Vercel API deployment and leave the website project in place. If the extension update fails, restore the prior Chrome Web Store package while keeping the API running for already protected purchases. Do not delete the Neon database during rollback.
