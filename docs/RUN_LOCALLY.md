# Run the repository on Windows

Install Node **24.x**, Git and **Docker Desktop**. Open Docker Desktop and wait for it to start. These commands use a dedicated, persistent local Postgres volume. They do not use or overwrite your hosted Supabase database.

From PowerShell in your repository:

```powershell
git pull origin main
npm ci
npm run local
```

On first run the runner downloads Postgres, creates a random database password in ignored `data/local-runtime.json`, applies schema migrations, and starts both HTTP server and wallet worker. Database port binds only to loopback. It never prints the database password or overwrites your `.env`.

In a **second terminal**, create or reset your staff owner:

```powershell
npm run local:staff -- owner owner
```

Enter your chosen password when prompted; input is hidden. Open `http://localhost:3000/business/login.html` and sign in with username `owner`. The customer enrollment page is `http://localhost:3000/join.html`.

Keep the first terminal open. Ctrl+C stops app/worker but leaves Postgres running. `npm run local:stop` stops Postgres without deleting its volume. `npm run local` restarts it later with the same memberships and balances. Preserve both the Docker volume and `data/local-runtime.json`; neither belongs in Git. Losing the credential file does not justify deleting the database. The runner refuses to replace an existing volume whose credential file is missing.

The local runner deliberately uses its own database and clears the hosted HTTPS origin, so real wallet saving remains disabled in this mode. To use your real Supabase and Google credentials, follow [connected deployment setup](AUTOMATIC_SETUP.md); use `npm start` plus `npm run worker` with a securely configured environment, or the Vercel deployment. Your original local runner members and hosted members do not synchronize automatically.

If port 3000 is busy, stop the old Node app first, or choose another port before running:

```powershell
$env:PORT=3001
npm run local
```

For checks:

```powershell
npm run build
npm run typecheck
npm test
npm run test:hosted
```

Docker must be running for the test database. Browser tests additionally need `npx playwright install chromium`, then `npm run test:browser`. OpenSSL and Python 3 are needed for the synthetic Apple signing test. A missing tool is a local prerequisite, not evidence that a wallet integration works or fails.
