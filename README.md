# AI-Powered Discord Ticket Conversation Assistant

A production-ready TypeScript monorepo implementing an **AI-powered conversational support assistant (`@hrbot/bot`)** and **Next.js administrative dashboard (`@hrbot/dashboard`)** designed to work seamlessly alongside an **existing Discord ticket-management bot** and an **existing player-data bot**.

---

## 1. Hosting Architecture (100% Free-Tier Compatible)

| Component | Hosting |
|---|---|
| **Discord AI bot (`@hrbot/bot`)** | Render Free Web Service (single Node.js process) |
| **HTTP health & readiness endpoints (`/healthz`, `/readyz`)** | Same Render Free Web Service & Node.js process |
| **External uptime monitor** | UptimeRobot Free (5-minute HTTP(s) interval) |
| **Database & Auth** | Supabase PostgreSQL Free |
| **AI provider** | Groq API |
| **Admin Dashboard (`@hrbot/dashboard`)** | Vercel Hobby (Free) |
| **Source repository** | GitHub |

---

## 2. Strict Architectural Boundary

There are **two completely separate Discord bots** in your server:

| Component | Responsibility |
|---|---|
| **Bot 1 — Existing Ticket Management Bot** | Opens tickets, creates ticket channels/threads, manages ticket permissions & categories, closes/locks/deletes tickets. |
| **Bot 2 — Our AI Conversation Assistant (This Project)** | Passively observes newly created ticket channels/threads in enabled categories, conducts natural Groq-powered intake conversations, queries an approved player-data bot, delivers neutral moderator reports to pre-existing channels/threads, and purges temporary session data upon confirmed closure. |

### Non-Negotiable Restrictions Enforced in Code & Tests
Our bot **never**:
1. Creates Discord ticket channels or threads.
2. Opens, closes, deletes, archives, or locks channels or threads.
3. Modifies channel/thread permissions or moves channels between categories.
4. Registers ticket-creation or ticket-closure commands.
5. Publishes confidential staff assessments inside player-visible ticket channels.

---

## 3. Monorepo Structure

```text
discord-ticket-ai/
├── apps/
│   ├── bot/                   # Discord.js + Groq + built-in HTTP health server (Render Free)
│   │   └── src/
│   │       ├── config/        # Zod env loader & versioned config snapshotting
│   │       ├── events/        # Read-only Gateway observers
│   │       ├── handlers/      # Ticket channel/thread detector & provider verifier
│   │       ├── integrations/  # Approved external player-data bot adapter
│   │       ├── queues/        # Per-ticket FIFO queue & global Groq concurrency semaphore
│   │       ├── server/        # Built-in node:http /healthz & /readyz server
│   │       ├── services/      # Session recovery, Groq engine, reports, closure purge, memory logger
│   │       └── index.ts       # Unified startup & graceful SIGTERM/SIGINT shutdown
│   └── dashboard/             # Next.js App Router + Tailwind + ShadCN UI (Vercel)
│       └── src/
│           ├── app/           # Protected dashboard pages & server-only API routes
│           ├── components/    # ShadCN UI & interactive editors / live previews
│           ├── hooks/         # Save banner & state hooks
│           └── lib/           # Supabase SSR auth, moderator allowlist guard, data service
├── packages/
│   └── shared/                # Shared Zod schemas, questionnaire engine, privacy redactor
├── supabase/
│   └── migrations/            # PostgreSQL schema, ON DELETE CASCADE, RLS & cleanup RPC
├── tests/                     # Static restriction & multi-ticket acceptance test suite
├── .env.example
├── Dockerfile
├── render.yaml                # Render Blueprint for single Free Web Service
├── package.json
└── pnpm-workspace.yaml
```

---

## 4. Bot Permissions & Gateway Intents

### Required Gateway Intents (Enable in Discord Developer Portal -> Bot)
- `Guilds`
- `GuildMessages`
- `MessageContent`

*(Leave `Server Members Intent` and `Presence Intent` OFF — member and presence caches are disabled to minimize memory usage on Render Free.)*

### Required Channel Permissions (Least-Privilege Only — Bitfield `274877991936`)
- `View Channel` (`1024`)
- `Send Messages` (`2048`)
- `Embed Links` (`16384`)
- `Read Message History` (`65536`)
- `Send Messages in Threads` (`274877906944`)

### Explicitly Forbidden Permissions (Do NOT Grant)
- `Manage Channels`
- `Manage Threads`
- `Create Public Threads`
- `Create Private Threads`
- `Administrator`

---

## 5. Database Setup (Supabase PostgreSQL)

1. Create a new Supabase project on the Free tier.
2. Run the SQL migrations in order inside the Supabase SQL Editor:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_rls_and_cleanup.sql`
3. Enable **Discord OAuth2** in **Supabase Dashboard -> Authentication -> Providers -> Discord**:
   - Paste your Discord Application `Client ID` and `Client Secret`.
   - Add your Supabase callback URL to the Discord Developer Portal OAuth2 Redirects.
   - Add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` under **Supabase -> Authentication -> URL Configuration -> Redirect URLs**.
4. Bootstrap your initial server row and owner allowlist entry in the Supabase SQL Editor:
   ```sql
   INSERT INTO public.server_settings (guild_id, guild_name)
   VALUES ('YOUR_DISCORD_GUILD_ID', 'Your Server Name')
   ON CONFLICT (guild_id) DO NOTHING;

   INSERT INTO public.dashboard_admins (guild_id, discord_user_id, label, permission_level)
   VALUES ('YOUR_DISCORD_GUILD_ID', 'YOUR_DISCORD_USER_ID', 'Server Owner', 'owner');
   ```

---

## 6. Local Development & Testing

```bash
# 1. Install dependencies across workspace
pnpm install

# 2. Copy .env.example to .env and populate credentials
cp .env.example .env

# 3. Build all packages & apps
pnpm build

# 4. Run strict TypeScript verification across shared, bot, and dashboard
pnpm typecheck

# 5. Run unit, health-server, recovery, concurrency, and restriction audit tests
pnpm test

# 6. Run locally in development
pnpm dev:bot
pnpm dev:dashboard
```

---

# Deploying on Render Free

Render Free Web Services spin down after 15 minutes without inbound HTTP traffic. This project runs **both** the Discord Gateway bot and a zero-dependency built-in Node.js HTTP health server (`apps/bot/src/server/health-server.ts`) inside the **same Node.js process** and **same Render Free Web Service**, paired with external 5-minute polling from **UptimeRobot Free** (`https://uptimerobot.com/`).

### 1. GitHub Repository Preparation
1. Ensure `.env` is **not** tracked (`.gitignore` excludes `.env*`).
2. Commit and push the monorepo (including `render.yaml`, `pnpm-lock.yaml`, `packages/shared`, and `apps/bot`) to a GitHub repository on the `main` branch:
   ```bash
   git add .
   git commit -m "Configure Discord AI Ticket Assistant for Render Free Web Service"
   git push -u origin main
   ```

### 2. Render Account Setup
1. Sign up or log in at https://dashboard.render.com/ (no paid plan is required for a Free Web Service).
2. Connect your GitHub account under **Account Settings -> Git Providers**.

### 3. Creating a New Web Service
You can create the service either via **Render Blueprint** (`render.yaml`) or manually:
- **Option A (Blueprint):** Click **New + -> Blueprint**, select your repository, and Render will automatically read `render.yaml` (`discord-ticket-ai-bot`, single `free` Web Service).
- **Option B (Manual Web Service):** Click **New + -> Web Service** -> **Build and deploy from a Git repository**. *(Do **not** create a Background Worker or a second Web Service.)*

### 4. Connecting the GitHub Repository
1. Select your `discord-ticket-ai` GitHub repository.
2. Set **Branch** to `main`.
3. Leave **Root Directory** blank (monorepo root) so `pnpm` can build both `@hrbot/shared` and `@hrbot/bot`.
4. Set **Runtime** to `Node`.

### 5. Configuring the Build Command
Set **Build Command** to:
```bash
corepack enable && pnpm install --frozen-lockfile --prod=false --filter . --filter @hrbot/shared --filter @hrbot/bot && pnpm run build:bot
```
*(Why `--prod=false` and `--filter`? When `NODE_ENV=production` is set, `--prod=false` ensures root TypeScript compiler `devDependencies` are installed for compilation, while `--filter` skips installing heavy Next.js dashboard packages on the bot container.)*

### 6. Configuring the Start Command
Set **Start Command** to:
```bash
pnpm --filter @hrbot/bot start
```
*(This runs `@hrbot/bot`'s production `"start": "node dist/index.js"` script in a single process.)*

### 7. Configuring Environment Variables
In **Render Dashboard -> Your Service -> Environment**, add the following variables (never hardcode secrets in `render.yaml` or Git):

| Key | Value | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Your Bot 2 Discord Token | Required secret |
| `DISCORD_CLIENT_ID` | Your Bot 2 Application Snowflake ID | Required (`15-22` digits) |
| `DISCORD_GUILD_ID` | Your Discord Server Snowflake ID | Required (`15-22` digits) |
| `GROQ_API_KEY` | `gsk_...` | Required secret |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Or `openai/gpt-oss-120b` / `llama-3.3-70b-versatile` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Required |
| `SUPABASE_SECRET_KEY` | Your Supabase server secret / `service_role` key | Required secret (`SUPABASE_SERVICE_ROLE_KEY` also supported) |
| `NODE_ENV` | `production` | Required |
| `LOG_LEVEL` | `info` | Recommended (`debug`, `info`, `warn`, `error`) |

*(Leave `PORT` unset in Render's UI unless required — Render automatically injects `PORT` at runtime, and the health server binds to `0.0.0.0:${PORT}`.)*

### 8. Setting the Free Instance Plan
Under **Instance Type**, select **Free** (`$0 / month`, single instance — never enable autoscaling or multiple instances for a single Discord Gateway token).

### 9. Setting Health Check Path to `/healthz`
Under **Advanced -> Health Check Path**, enter:
```text
/healthz
```

### 10. Deploying the Bot
Click **Create Web Service** (or **Deploy**). Watch the Render build logs compile `@hrbot/shared` and `@hrbot/bot`, start the HTTP health server, and connect to the Discord Gateway.

### 11. Obtaining the Render Public URL
Once the deploy status turns **Live**, copy your public `onrender.com` URL from the top-left of the Render service header:
```text
https://YOUR-RENDER-SERVICE.onrender.com
```

### 12. Testing `/healthz` (Process Liveness)
Run from your terminal or browser:
```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/healthz
```
Expected response (`HTTP/1.1 200 OK`, `Cache-Control: no-store`):
```json
{"status":"ok"}
```
- `/healthz` responds immediately without calling Groq, Supabase, or Discord, exposes zero secrets, and stays `200` even during temporary Discord Gateway reconnects.

### 13. Testing `/readyz` (Discord Operational Readiness)
Run:
```bash
curl -i https://YOUR-RENDER-SERVICE.onrender.com/readyz
```
Expected response when connected (`HTTP/1.1 200 OK`):
```json
{"status":"ready","discordConnected":true}
```
*(Returns `HTTP 503` with `{"status":"not_ready","discordConnected":false}` while the Discord client is still connecting or temporarily disconnected.)*

### 14. Creating a Free UptimeRobot Account
Go to the official UptimeRobot website and create a free account:
- https://uptimerobot.com/

### 15. Creating an HTTP(s) Monitor
In your UptimeRobot dashboard, click **+ Add New Monitor** and configure:

| Setting | Value |
|---|---|
| **Monitor Type** | `HTTP(s)` |
| **Friendly Name** | `Discord AI Bot Keep Alive` |
| **URL (or IP)** | `https://YOUR-RENDER-SERVICE.onrender.com/healthz` |
| **Monitoring Interval** | `5 minutes` |
| **Expected Status** | `HTTP 200` |

### 16. Setting Its Interval to Five Minutes
Verify the **Monitoring Interval** slider/dropdown is set to **5 minutes** (the minimum interval included on UptimeRobot Free, well inside Render's 15-minute idle spin-down window) and click **Create Monitor**.

### 17. Testing Whether Render Remains Active Beyond 15 Minutes Without Other Traffic
1. Close any open browser tabs pointing to your Render URL and send no manual HTTP requests for **20–30 minutes**.
2. Check **Render -> Logs** and **UptimeRobot -> Monitor Logs**:
   - Confirm UptimeRobot records `200 OK` every 5 minutes with low response latency (no multi-second cold-start spin-up banner in Render logs).
   - Confirm the bot remains online in your Discord server member list and responds immediately inside an eligible test ticket.

### 18. Verifying Discord Gateway Connection
1. Open **Render -> Logs** and verify the structured startup entry:
   ```json
   {"level":"info","component":"ticket-ai-bot","msg":"Connected to Discord Gateway as ticket conversation assistant"}
   ```
2. Open your Vercel Dashboard (`/overview`) and verify the **Bot Worker Online** heartbeat indicator is green.

### 19. Troubleshooting Sleep, Crashes & Memory Usage
- **Service still spins down after 15 minutes:**
  - Verify UptimeRobot is polling the exact `https://YOUR-RENDER-SERVICE.onrender.com/healthz` HTTPS URL (not `http://` if redirects are blocked, and not `/readyz`).
  - Check whether your Render Free monthly instance-hour quota (750 free hours/month across all Free Web Services in your Render account) has been exhausted.
- **Deploy fails with Port Scan Timeout:**
  - Ensure you did **not** hardcode an unexposed `PORT` in Render's Environment Variables tab. Let Render inject `PORT` automatically (`server.listen(PORT, "0.0.0.0")`).
- **Bot restarts or hits Out-Of-Memory (OOM):**
  - Inspect structured `memoryMb` (`rssMb`, `heapUsedMb`) entries in Render logs (`LOG_LEVEL=debug` for periodic memory snapshots).
  - If running on a tightly constrained 256 MB–512 MB Free container, switch `Start Command` to `node apps/bot/dist/index.js` to avoid keeping the parent `pnpm` CLI wrapper in RAM (~35 MB savings).
  - Lower `globalConcurrencyLimit` (e.g., `2`) in **Dashboard -> AI Settings**.
- **Active ticket interrupted by a Render container restart:**
  - On `SIGTERM`, the bot stops accepting new tasks, gives in-flight turns up to `SHUTDOWN_TIMEOUT_MS` (default `8000` ms) to complete, closes Discord & HTTP cleanly, and **preserves** all active session & questionnaire rows in Supabase. When the replacement container boots, `recoverActiveSessions()` restores active sessions automatically without sending duplicate welcome messages.

### Render Free & UptimeRobot Limitations
Please keep these operational realities in mind when running on free-tier infrastructure:
- **Free services may restart:** Render regularly restarts or relocates Free containers for maintenance, deployments, and platform load balancing.
- **No uptime SLA:** Render Free, UptimeRobot Free, Supabase Free, Groq Free, and Vercel Hobby carry **no** commercial uptime SLA.
- **Ephemeral filesystem:** Any files written inside the Render container are lost on restart. Never store state on local disk; all active ticket state is persisted in Supabase PostgreSQL.
- **External monitoring dependency:** Preventing 15-minute idle spin-down relies on UptimeRobot's external polling availability.
- **Keep-alive requests do NOT guarantee uninterrupted service:** Platform maintenance, network partitions, Discord Gateway shard resets, or monthly free-hour limits can still cause brief interruptions.
- **Free-plan resource & usage limits apply:** Constrained CPU/RAM on Render Free, monthly free Web Service hours, Supabase Free inactivity rules, and Groq API rate/token quotas apply.

---

## 7. Next.js Dashboard Deployment on Vercel

1. Import the GitHub repository into Vercel and set the **Root Directory** to `apps/dashboard`.
2. Vercel automatically uses `apps/dashboard/vercel.json` (`pnpm --filter @hrbot/shared build && pnpm --filter @hrbot/dashboard build`).
3. Configure environment variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` *(or `SUPABASE_SERVICE_ROLE_KEY` — server-only, never prefix with `NEXT_PUBLIC_`)*
   - `GROQ_API_KEY` *(Server-only)*
   - `GROQ_MODEL`
   - `DEFAULT_GUILD_ID`
   - `DASHBOARD_DISCORD_BOT_TOKEN` *(Optional, server-only — used if matching allowlisted Discord Guild Role IDs)*
4. **Never** deploy the persistent Discord Gateway bot as a Vercel Serverless Function.

---

## 8. Ticket Closure Detection & Privacy Disclosures

- **Closure Detection:** Supports `ChannelDelete`/`ThreadDelete` events, `ThreadUpdate` (`locked_only` default), periodic channel reconciliation (`CLOSURE_RECONCILE_INTERVAL_MS`), and optional HMAC-SHA256 signed webhooks (`POST /webhooks/ticket` on the same HTTP server when `TICKET_WEBHOOK_SECRET` is set).
- **Active-Session-Only Storage & Redaction:** Messages outside active enabled tickets are never stored. Passwords, recovery codes, API keys, tokens, and card numbers are redacted before Supabase persistence or Groq inference, and logs never record message content or player PII.
- **Automatic Closure Purge:** Confirmed ticket closure executes an idempotent cascade deletion removing `ticket_messages`, `ticket_answers`, `player_lookups`, `staff_reports`, and `ticket_sessions` while preserving server/category settings.
