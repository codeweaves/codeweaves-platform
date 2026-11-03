# Environment setup (staging and prod)

How to build a remote environment from nothing: every account, every form, every answer, and where each value goes. Written for **staging** (client security testing, ADR-0017) and reused for **prod** (ADR-0002). Each step says what is different for prod.

Follow it top to bottom. Every screen in every tool is listed with the answer to give. If a screen asks something this guide does not answer, stop and add the answer here before you continue, so the next run has it.

---

## The two environments at a glance

|                         | Staging                                     | Prod                                                          |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Git branch              | `staging` (exists, created 2026-11-03)      | `main`                                                        |
| Purpose                 | Client security tests. **Fake data only.**  | Customers                                                     |
| API host                | Render, **new account**, Singapore, free    | Google Cloud Run, Mumbai (`asia-south1`), see section 6P      |
| Database + file storage | Supabase, new project, Mumbai, **Free**     | Supabase, new project, Mumbai, **Pro**                        |
| Login                   | Clerk, new application, production instance | Clerk, new application, production instance                   |
| Errors                  | Sentry, new account                         | Sentry `codeweaves` org (develop's), environment `production` |
| Dashboard + widget      | Vercel, 2 new projects, branch `staging`    | Vercel, 2 new projects, branch `main`                         |
| Email                   | Resend, same account, new key               | Resend, same account, new key                                 |
| AI keys                 | New, capped                                 | New, prod limits                                              |
| Dashboard host          | `staging.getklivo.com`                      | `app.getklivo.com`                                            |
| API host name           | `api-staging.getklivo.com`                  | `api.getklivo.com`                                            |
| Widget host             | `widget-staging.getklivo.com`               | `widget.getklivo.com`                                         |

Today `app.getklivo.com` and `api.getklivo.com` point at **develop**. Before prod goes live, move develop to other names (for example `dev.getklivo.com`, `api-dev.getklivo.com`).

Never put a staging host under `app.getklivo.com`: a cookie for `app.getklivo.com` is also sent to its subdomains, and testers deliberately try XSS on staging.

Code moves `develop` → `staging` → `main` by pull request. Each branch deploys only its own environment.

---

## 0. Before you start

1. Open a private note **outside the repo** (a password manager is best). You will collect about 25 values. Values marked **SECRET** go only into that note and then into Render, Vercel, Cloud Run or GitHub. Never into the repo, chat, email or Slack.
2. Generate two random values. Run this twice in any terminal:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   - First output → `AGENT_SECRET_KEY` (**SECRET**). Encrypts agent secrets and WhatsApp tokens. **Prod:** also keep a copy outside Cloud Run (password manager). If it is lost, every encrypted value in the prod database is unreadable.
   - Second output → `INTERNAL_API_SECRET` (**SECRET**). The cron jobs send it to the API.

   New values for every environment. Never copy them from develop.

3. Have these open in browser tabs: the **develop** Render service, the **develop** Clerk app, and the **develop** Vercel project. Several steps say "copy this from develop".

---

## 1. Supabase

### 1.1 New project form

supabase.com → your organization → **New project**.

| Field                                                 | Staging                                                                          | Prod                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| Organization                                          | your existing one                                                                | your existing one (must be on **Pro**) |
| Project name                                          | `klivo-staging`                                                                  | `klivo-prod`                           |
| Database password                                     | **Generate a password** → copy to your note (**SECRET**). It is not shown again. | same                                   |
| Region                                                | **South Asia (Mumbai)**                                                          | **South Asia (Mumbai)**                |
| Compute size (if shown)                               | Nano (the only free option)                                                      | Micro (included in Pro)                |
| **Security options**: "Enable Data API"               | **Uncheck**                                                                      | **Uncheck**                            |
| "Automatically expose new tables" (if shown)          | **Uncheck**                                                                      | **Uncheck**                            |
| "Enable automatic RLS" / RLS on new tables (if shown) | Leave **on**                                                                     | Leave **on**                           |
| Advanced: Postgres type (if shown)                    | **Postgres** (not OrioleDB)                                                      | **Postgres**                           |

Why: the app reaches Postgres only through Prisma on the API server. The Data API is a second door into the database that we never use. RLS on new tables does not affect the app, because Prisma connects as the table owner, which RLS does not restrict.

Click **Create new project**. Wait until it shows **Healthy** (1 to 2 minutes).

### 1.2 Connection strings

**Connect** (button at the top of the project page) → **Connection String** tab. It offers three. Use two:

| Option                                                  | Port | Goes to                                                                                                              |
| ------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| **Transaction pooler**                                  | 6543 | `DATABASE_URL` (**SECRET**). Replace `[YOUR-PASSWORD]`. Add `?pgbouncer=true` at the end.                            |
| **Session pooler** (host ends in `pooler.supabase.com`) | 5432 | `DIRECT_URL` (**SECRET**) and GitHub secret `STAGING_DATABASE_URL` / `PROD_DATABASE_URL`. Replace `[YOUR-PASSWORD]`. |
| Direct connection                                       | 5432 | **Do not use.** IPv6 only; Render and GitHub Actions cannot reach it.                                                |

Compare with the develop Render service → **Environment**: develop uses the same pattern.

### 1.3 Project URL and service key

1. **Project Settings** (gear icon, bottom left) → **Data API** → copy **Project URL** → `SUPABASE_URL` (API) and `NEXT_PUBLIC_SUPABASE_URL` (dashboard).
2. **Project Settings** → **API Keys**. Use the **same key type as develop** (look at develop's `SUPABASE_SERVICE_ROLE_KEY` on Render):
   - starts with `eyJ` → **Legacy API keys** tab → **service_role** → **Reveal** → copy.
   - starts with `sb_secret_` → **Secret keys** section → reveal or create → copy.
   - → `SUPABASE_SERVICE_ROLE_KEY` (**SECRET**). It bypasses every database rule. API only. Never in Vercel.
3. On the same page, copy the **publishable** (or legacy **anon**) key into your note. You need it only for the check in 1.4. It goes nowhere else.

### 1.4 Prove the Data API is closed

If you unchecked it in 1.1, check it anyway. On develop the toggle once showed OFF while the API still answered.

```sh
curl -s -o /dev/null -w "%{http_code}\n" "<SUPABASE_URL>/rest/v1/agents?select=id" -H "apikey: <publishable or anon key>"
```

- Expected: **not 200** (503 or 404 = closed). Before the first deploy there is no `agents` table yet, so run it again after section 10.
- If it returns 200: **Integrations** → **Data API** (or Project Settings → Data API) → turn **Enable Data API** on, save, turn it off, save. Then run the check again.

### 1.5 Storage bucket

**Storage** → **New bucket**:

| Field                                  | Value                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Name                                   | `agent_assets` (exact, with the underscore)                                                             |
| Public bucket                          | **ON** (logos and avatars use public links today; making it private is a prod code fix, see section 12) |
| Restrict file upload size / MIME types | leave off (the API checks uploads)                                                                      |

### 1.6 Extensions for cron

**Database** → **Extensions** → search and enable `pg_cron` and `pg_net`. If it asks for a schema, accept the default. Vault (`supabase_vault`) is already on by default; check it shows as enabled.

The cron jobs themselves come in section 11, after the API runs.

---

## 2. Clerk

Staging is our **first Clerk production instance**: develop runs on a Clerk _development_ instance (`nice-midge-98.clerk.accounts.dev`, key `pk_test_...`). Prod repeats exactly these steps.

### 2.1 Create the application

dashboard.clerk.com → application switcher (top left) → **Create application**.

| Field                             | Staging                                                                                     | Prod    |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| Application name                  | `Klivo Staging`                                                                             | `Klivo` |
| Sign-in options (grid of toggles) | **Email** ON. Everything else OFF (Phone, Username, Google, GitHub, every social provider). | same    |

Click **Create application**. Clerk opens a quickstart page that asks for your framework and shows code. **Ignore it.** The app already has Clerk installed.

Why no Google login: a production instance needs our own Google OAuth credentials for it, and the app uses email + password with invitations only.

### 2.2 Make the development instance match develop

You are now in the new app's **Development** instance. Open the develop Clerk app in another tab and compare page by page. These are the settings the code depends on:

| Page (left sidebar, under Configure)                       | Setting                                                      | Value                          | Why                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ | ----------------------------------------------- |
| **User & authentication** → Email                          | Sign up with email, Require email address, Verify at sign-up | ON, same as develop            | Invitations are by email                        |
| **User & authentication** → Password                       | Sign up with password / sign in with password                | **ON**                         | Our sign-in page uses email + password          |
| **User & authentication** → Phone, Username                |                                                              | OFF                            | Not used                                        |
| **Access mode** (may also be called Restrictions)          | Mode                                                         | **Invite-only** (`restricted`) | Sign-up works only through an invitation link   |
| **Protections**                                            | **Device Trust**                                             | **ON** (Clerk's default)       | See below                                       |
| **Sessions** → Customize session token → **Claims** editor | paste the JSON below, **Save**                               |                                | The API reads `email` from the token (ADR-0008) |
| **Multi-factor**                                           |                                                              | OFF, same as develop           | Our sign-in page cannot do a second step yet    |

Session token claims, exactly:

```json
{
  "email": "{{user.primary_email_address}}"
}
```

**Device Trust stays ON (decided 2026-11-03).** Clerk turns it on by default for apps created after 14 Nov 2025. It asks for an email code the first time someone signs in with a password on a new device. Our custom sign-in page originally handled only a finished sign-in (`apps/web/app/(auth)/sign-in/page.tsx`), which shows "Could not complete sign-in (status: needs_client_trust)". **The sign-in code must handle Device Trust (and MFA) before anyone can sign in to this environment.** That work is on its own branch; check it is deployed before the smoke test (section 13).

### 2.3 Create the production instance

1. Top of the dashboard: click **Development** (the instance switcher) → **Create production instance**.
2. The popup asks how to start. Choose **Clone development instance settings**, so 2.2 carries over.
3. The **Create production instance** screen:

   | Field                                                                          | Staging                      | Prod                    |
   | ------------------------------------------------------------------------------ | ---------------------------- | ----------------------- |
   | Application domain (after `https://`)                                          | `staging.getklivo.com`       | `app.getklivo.com`      |
   | "Is this the primary application for getklivo.com or a secondary application?" | **Secondary application**    | **Primary application** |
   | Clerk API (Frontend API) host that results                                     | `clerk.staging.getklivo.com` | `clerk.getklivo.com`    |
   | Verification emails sent from                                                  | `@staging.getklivo.com`      | `@getklivo.com`         |

   Then **Create Instance**.

   Staging must be **Secondary**. Primary takes `clerk.getklivo.com` and `@getklivo.com`, which belong to prod. If staging took them, prod could not have them without deleting staging's instance. Check the result on the **Domains** page: staging's Frontend API must be `clerk.staging.getklivo.com`.

4. Clerk does **not** clone **Paths**, **Integrations** or SSO connections. Open develop's **Paths** page and copy it into the production instance. At minimum: sign-in page = on the application domain, `/sign-in`; sign-up page = `/sign-up`.
5. In the production instance, open the 2.2 pages again and check each value. Especially **Access mode = Invite-only**, **Device Trust = ON** and the **session token claim**.

### 2.4 DNS for Clerk

**Configure** → **Domains** lists about 5 records (CNAMEs for `clerk.`, `accounts.`, `clkmail.`, and two `clk._domainkey` / `clk2._domainkey` records). Add each one at your DNS provider **exactly as shown** (section 9). If the provider offers a proxy (orange cloud), set it to **DNS only**.

Wait until every record shows **Verified**. Then the dashboard home shows **Deploy certificates**. Click it. This takes minutes to a few hours (DNS can take up to 48 hours).

### 2.5 Keys (production instance)

Check the switcher at the top says **Production**.

**Configure** → **API keys** (left sidebar):

| Value                                             | Looks like                           | Goes to                                                             |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| Publishable key                                   | `pk_live_...`                        | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Vercel web)                    |
| Secret key                                        | `sk_live_...`                        | `CLERK_SECRET_KEY` (**SECRET**), on **both** the API and Vercel web |
| Frontend API URL (may be under **Show API URLs**) | `https://clerk.staging.getklivo.com` | `CLERK_ISSUER` (API)                                                |

If a key starts with `pk_test_` or `sk_test_`, you are in the Development instance. Switch to Production.

### 2.6 Your own user (first super admin)

Sign-up is invite-only, and only a super admin can invite. So the first account is made by hand:

1. Production instance → **Users** → **Create user** → your email + a strong password.
2. Open the user → copy **User ID** (`user_...`) → GitHub secret `STAGING_SUPER_ADMIN_CLERK_ID` (prod: `PROD_SUPER_ADMIN_CLERK_ID`). Your email → `STAGING_SUPER_ADMIN_EMAIL`.

The deploy pipeline seeds the database with a super admin linked to this Clerk user.

### 2.7 Check: two Clerk instances on one root domain

After everything runs (section 13): sign in to staging and to prod (or develop) **in the same browser**. Both must stay signed in. If signing in to one signs you out of the other, tell Claude. Current Clerk SDKs name their cookies per instance to prevent this, but we have not run two production instances on `getklivo.com` before.

---

## 3. Sentry

### 3.1 Staging: new account

sentry.io → **Get started** / **Sign up**. Screens in order:

| Screen                                               | Answer                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Name, email, password                                | yours                                                                                                         |
| **Organization name**                                | `Klivo Staging`. The **slug** it creates (shown under the name, editable) → `SENTRY_ORG`.                     |
| **Data storage location**                            | **European Union (Germany)**. Same as develop's org (`ingest.de.sentry.io`). It cannot change later.          |
| **What do you want to track?**                       | ✅ **Error monitoring**, ✅ **Tracing**. ⬜ Logging, ⬜ Profiling, ⬜ Application Metrics, ⬜ Session Replay. |
| Choose your platform                                 | **NestJS** (search "Nest") for the first project                                                              |
| Set your alert frequency                             | **Alert me on high priority issues**                                                                          |
| Project name / Team                                  | `klivo-api`, default team                                                                                     |
| Configure SDK page (shows install commands and code) | **Ignore it.** The app already has Sentry. Click **Take me to Issues** (or Skip).                             |

Why those boxes: the code sends errors from both apps and 10% of dashboard page loads as traces (`tracesSampleRate: 0.1` in `apps/web/instrumentation-client.ts`). API tracing follows `SENTRY_TRACES_SAMPLE_RATE`. The code never turns on profiling, Sentry logs, metrics or replay (replay is set to 0, and replays would record screens with customer data). Profiling is billed by usage after the 14-day trial. The boxes only change the sample code Sentry shows; what is sent is decided by our code.

Then the second project: **Projects** → **Create Project**:

| Field                                  | Answer                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| Platform                               | **Next.js**                                                         |
| Alert frequency                        | **Alert me on high priority issues**                                |
| Project name                           | `klivo-web` → `SENTRY_PROJECT`                                      |
| Products (if asked again)              | Error monitoring + Tracing only. Session Replay **off**.            |
| Wizard (`npx @sentry/wizard`) and code | **Ignore it.** Do not run the wizard: it rewrites our Sentry files. |

### 3.2 Collect the values

| Value      | Where                                                                                                                                          | Goes to                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| API DSN    | **Settings** → **Projects** → `klivo-api` → **Client Keys (DSN)** → DSN                                                                        | `SENTRY_DSN` (API)                           |
| Web DSN    | same, project `klivo-web`                                                                                                                      | `NEXT_PUBLIC_SENTRY_DSN` (Vercel web)        |
| Org slug   | **Settings** → **General Settings** → Organization Slug (or the URL `https://<slug>.sentry.io`)                                                | `SENTRY_ORG` (Vercel web)                    |
| Auth token | **Settings** → **Developer Settings** → **Organization Tokens** → **Create New Token**, name `vercel-sourcemaps`. Copy it **now**: shown once. | `SENTRY_AUTH_TOKEN` (**SECRET**, Vercel web) |

The DSN _sends_ errors (browsers see it, not a secret). The token _uploads source maps_ during the Vercel build (secret).

### 3.3 Settings worth one minute

- **Settings** → **Projects** → each project → **Spike Protection**: ON. Scanners create bursts of errors; this stops one burst from using the month's quota.
- **Alerts** → **Create Alert** → **Issues**: `klivo-api`: "A new issue is created" → email. Prod also: "issue seen more than 10 times in 5 minutes" → email. `klivo-web`: only "new issue" → email.
- Free plan facts: **1 user only** (a co-founder cannot log in), 5,000 errors and 5M spans a month, 30-day retention.

### 3.4 Prod

No new account. Prod uses develop's org **`codeweaves`** (EU), the same `klivo-api` and `klivo-web` projects, and is separated by environment: `SENTRY_ENVIRONMENT=production`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`. The free quota is shared with develop, so consider the paid plan at launch. Add the alert rules in 3.3.

---

## 4. Resend

Same account for every environment. The free plan allows one sending domain, so all use `mail.getklivo.com`.

**API Keys** → **Create API Key**:

| Field      | Staging                                 | Prod                |
| ---------- | --------------------------------------- | ------------------- |
| Name       | `staging`                               | `production`        |
| Permission | **Sending access** (not Full access)    | **Sending access**  |
| Domain     | `mail.getklivo.com` (not "All domains") | `mail.getklivo.com` |

Copy it now (shown once) → `RESEND_API_KEY` (**SECRET**).

`EMAIL_FROM`: staging `Klivo Staging <noreply@mail.getklivo.com>`, prod `Klivo <noreply@mail.getklivo.com>`.

The free plan's **100 emails a day** is shared by all environments. Testers sending many invitations can stop develop email for the day: ask the bank to invite only their testers. **Prod:** check the volume; the paid plan lifts the limit.

---

## 5. AI provider keys

### OpenAI (required: the default model is OpenAI)

1. platform.openai.com → project picker (top left) → **Create project** → `klivo-staging` (prod: `klivo-prod`).
2. In that project → **Settings** (gear) → **Limits**:
   - **Budget**: staging $10 a month (prod: your real figure). Read the label: if it says the budget only sends alerts, the hard cap is your account's prepaid credit with auto-recharge off.
   - Model rate limits: leave default.
3. **API keys** → **Create new secret key**:
   - Owned by: **Service account** (not tied to your login), name `klivo-api`.
   - Project: `klivo-staging`.
   - Permissions: **All** (the API calls chat completions; restricting it can break features silently).
   - Copy now (shown once) → `OPENAI_API_KEY` (**SECRET**).

### Gemini (only if an agent uses a `gemini:` model)

aistudio.google.com/apikey → **Create API key** → **Create API key in new project** → name it `klivo-staging`.

- **Staging:** do not link billing. The free tier caps usage by rate limits. Google may use free-tier requests to improve its models; staging has fake data, so that is acceptable.
- **Prod:** link a billing account (paid tier), so customer conversations are **not** used for training. Never use a free-tier key in prod.

→ `GOOGLE_API_KEY` (**SECRET**).

### Sarvam (only if voice or a `sarvam:` model is in scope)

dashboard.sarvam.ai → **API Keys** → create → `SARVAM_API_KEY` (**SECRET**). Prepaid, so the credit balance is the cap.

### Leave empty unless the test scope includes them

`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

---

## 6. API host

### 6S. Staging: Render (new account)

**Sign-up screens**

| Screen                            | Answer                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Sign up with                      | GitHub or email (a **new** account, so staging gets its own workspace and its own 750 free hours a month) |
| Workspace name                    | `klivo-staging`                                                                                           |
| "How will you use Render?" survey | anything; it changes nothing                                                                              |

**Connect GitHub:** Render asks to install its GitHub app. Choose the **codeweaves** organization → **Only select repositories** → the platform repo → Install. If you are not an owner of the org, an owner must approve the request on GitHub.

**New** → **Web Service** → **Git Provider** → pick the repo. Form, top to bottom:

| Field                         | Value                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Name                          | `klivo-api-staging`                                                                                                  |
| Project                       | leave empty                                                                                                          |
| Language                      | **Node** (same as develop)                                                                                           |
| Branch                        | **`staging`**                                                                                                        |
| Region                        | **Singapore (Southeast Asia)**                                                                                       |
| Root Directory                | **copy from develop** (develop service → Settings)                                                                   |
| Build Command                 | **copy from develop**                                                                                                |
| Start Command                 | `node apps/api/dist/main` (same as develop; not `dist/src/main`)                                                     |
| Instance Type                 | **Free**                                                                                                             |
| Environment Variables         | **Add from .env** → paste section 7.1 filled in. Also copy any `NODE_VERSION` / `BUN_VERSION` variables develop has. |
| Advanced → Secret Files       | none                                                                                                                 |
| Advanced → Health Check Path  | `/health`                                                                                                            |
| Advanced → Pre-Deploy Command | leave empty (paid feature; CI migrates instead)                                                                      |
| Advanced → **Auto-Deploy**    | **Off** (options are On Commit / After CI Checks Pass / Off). CI deploys after it migrates.                          |
| Advanced → Build Filters      | leave empty                                                                                                          |

**Create Web Service.** The first build runs once by itself. `/health/ready` will fail until CI has migrated the database (section 10). Expected.

Then:

1. **Settings** → **Deploy Hook** → copy → GitHub secret `RENDER_STAGING_DEPLOY_HOOK_URL` (**SECRET**: anyone with it can deploy).
2. **Settings** → **Custom Domains** → **Add Custom Domain** → `api-staging.getklivo.com`. Render shows a CNAME target (`klivo-api-staging.onrender.com`). Add it in DNS (section 9). Render issues the certificate once DNS resolves.

`RENDER_GIT_COMMIT` is set by Render automatically. Do not add it.

### 6P. Prod: Google Cloud Run (when prod is built)

The prod deploy pipeline is not built yet. These answers are already decided; the full step list is written when the pipeline is built (ADR-0002):

| Setting             | Value                                                                                                    | Why                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Region              | `asia-south1` (Mumbai)                                                                                   | next to the database                                                                                                                            |
| Build               | **Dockerfile**, source `/Dockerfile` (repo root). **Not** buildpacks.                                    | SBOM and VAPT answers say Debian distroless + Node 24                                                                                           |
| How it deploys      | GitHub Actions: migrate → `gcloud run deploy` → check `/health`. **No Cloud Build trigger on the repo.** | A trigger would deploy before migrations run (ADR-0001)                                                                                         |
| Billing             | **Instance-based** (CPU always allocated)                                                                | The API keeps working after it replies: fire-and-forget logs and cron jobs that reply first. Request-based billing would stall them (ADR-0017). |
| Min / max instances | 1 / 3                                                                                                    | no cold start for chat                                                                                                                          |
| CPU / memory        | 1 vCPU / 1 GiB                                                                                           | ~$47 a month; raise only when metrics say so                                                                                                    |
| Request timeout     | 3600 s                                                                                                   | streaming replies and WebSockets                                                                                                                |
| Authentication      | Allow public access                                                                                      | the API does its own auth                                                                                                                       |
| Secrets             | Secret Manager, mounted as env vars                                                                      | not plain env vars                                                                                                                              |
| Start command       | from the image (`CMD`)                                                                                   | the Render start command does not apply                                                                                                         |

Also needed for prod (from the BCP commitments): the service creation as a script in the repo (`gcloud run deploy`), not console clicks.

---

## 7. Environment variables

### 7.1 API (Render for staging, Cloud Run for prod)

| Variable                    | Staging                                                  | Prod                                          |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `NODE_ENV`                  | `production`                                             | `production`                                  |
| `APP_ENV`                   | `staging`                                                | `production`                                  |
| `DATABASE_URL`              | transaction pooler, 6543, `?pgbouncer=true` (**SECRET**) | same, prod project                            |
| `DIRECT_URL`                | session pooler, 5432 (**SECRET**)                        | same, prod project                            |
| `SUPABASE_URL`              | Project URL                                              | prod Project URL                              |
| `SUPABASE_SERVICE_ROLE_KEY` | (**SECRET**)                                             | (**SECRET**)                                  |
| `CLERK_ISSUER`              | `https://clerk.staging.getklivo.com`                     | `https://clerk.getklivo.com`                  |
| `CLERK_SECRET_KEY`          | `sk_live_...` (**SECRET**)                               | `sk_live_...` (**SECRET**)                    |
| `DASHBOARD_URL`             | `https://staging.getklivo.com`                           | `https://app.getklivo.com`                    |
| `CORS_ORIGIN`               | `https://staging.getklivo.com`                           | `https://app.getklivo.com`                    |
| `AGENT_SECRET_KEY`          | new (**SECRET**)                                         | new (**SECRET**), copy kept outside Cloud Run |
| `INTERNAL_API_SECRET`       | new (**SECRET**)                                         | new (**SECRET**)                              |
| `RESEND_API_KEY`            | staging key (**SECRET**)                                 | prod key (**SECRET**)                         |
| `EMAIL_FROM`                | `Klivo Staging <noreply@mail.getklivo.com>`              | `Klivo <noreply@mail.getklivo.com>`           |
| `OPENAI_API_KEY`            | staging key (**SECRET**)                                 | prod key (**SECRET**)                         |
| `GOOGLE_API_KEY`            | only if used, free tier (**SECRET**)                     | only if used, **paid tier** (**SECRET**)      |
| `SARVAM_API_KEY`            | only if used (**SECRET**)                                | only if used (**SECRET**)                     |
| `DEFAULT_AI_MODEL`          | `openai:gpt-4.1-mini`                                    | your choice                                   |
| `DATA_EXTRACT_POLL_ENABLED` | `false` (cron drives it)                                 | `false`                                       |
| `SOCKET_IO_REDIS`           | `false`                                                  | `false` while there is one instance           |
| `REDIS_URL`                 | unset (rate limits run in-process)                       | Upstash, nearest Indian region                |
| `SENTRY_DSN`                | staging `klivo-api` DSN                                  | `codeweaves` `klivo-api` DSN                  |
| `SENTRY_ENVIRONMENT`        | `staging`                                                | `production`                                  |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1`                                                    | `0.1`                                         |
| `EVENT_LOG_RETENTION_DAYS`  | `30`                                                     | `0` (keep, decided)                           |
| `CHAT_TRACE_RETENTION_DAYS` | `30`                                                     | `90`                                          |
| `SLACK_ALERTS_WEBHOOK_URL`  | unset                                                    | `#klivo-alerts` webhook (**SECRET**)          |
| `HEARTBEAT_URL_*`           | unset                                                    | Better Stack heartbeats (**SECRET**)          |
| `ENABLE_DEV_ROUTES`         | **unset. Never `true`.**                                 | **unset. Never `true`.**                      |

`CORS_ORIGIN` is easy to miss: it is not in `apps/api/.env.example`, and without it the browser blocks every dashboard call.

Not on the API host: `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_CLERK_ID`, `DEVELOP_*`. Those go to GitHub (section 10).

### 7.2 Dashboard (Vercel web project)

| Variable                            | Staging                               | Prod                          | Vercel type   |
| ----------------------------------- | ------------------------------------- | ----------------------------- | ------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (staging)               | `pk_live_...` (prod)          | plain         |
| `CLERK_SECRET_KEY`                  | `sk_live_...`                         | `sk_live_...`                 | **Sensitive** |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | `/sign-in`                            | `/sign-in`                    | plain         |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     | `/sign-up`                            | `/sign-up`                    | plain         |
| `NEXT_PUBLIC_API_URL`               | `https://api-staging.getklivo.com`    | `https://api.getklivo.com`    | plain         |
| `NEXT_PUBLIC_SUPABASE_URL`          | staging Project URL                   | prod Project URL              | plain         |
| `NEXT_PUBLIC_WIDGET_URL`            | `https://widget-staging.getklivo.com` | `https://widget.getklivo.com` | plain         |
| `NEXT_PUBLIC_SENTRY_DSN`            | staging `klivo-web` DSN               | `codeweaves` `klivo-web` DSN  | plain         |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`    | `staging`                             | `production`                  | plain         |
| `SENTRY_ORG`                        | staging org slug                      | `codeweaves`                  | plain         |
| `SENTRY_PROJECT`                    | `klivo-web`                           | `klivo-web`                   | plain         |
| `SENTRY_AUTH_TOKEN`                 | staging org token                     | `codeweaves` org token        | **Sensitive** |

Do not set `NEXT_PUBLIC_SENTRY_RELEASE` (the build sets it per commit) or `VERCEL_*` (Vercel sets them).

### 7.3 Widget (Vercel widget project)

| Variable            | Staging                            | Prod                       |
| ------------------- | ---------------------------------- | -------------------------- |
| `VITE_API_BASE_URL` | `https://api-staging.getklivo.com` | `https://api.getklivo.com` |

`NEXT_PUBLIC_*` and `VITE_*` values are built into the JavaScript at build time. After changing one, **Redeploy**, or the old value stays.

---

## 8. Vercel (same account, two new projects per environment)

Do this twice: web, then widget.

1. Develop's Vercel project → **Settings** → **Build and Deployment**: note Root Directory, Install Command, Build Command, Node.js Version.
2. **Add New…** → **Project** → **Import** the same GitHub repo. The **Configure Project** screen:

   | Field                     | Web                                         | Widget                                              |
   | ------------------------- | ------------------------------------------- | --------------------------------------------------- |
   | Vercel Team               | your team                                   | your team                                           |
   | Project Name              | `klivo-web-staging` (prod `klivo-web-prod`) | `klivo-widget-staging` (prod `klivo-widget-prod`)   |
   | Framework Preset          | **Next.js**                                 | **Other** (`apps/widget/vercel.json` sets the rest) |
   | Root Directory → **Edit** | `apps/web`                                  | `apps/widget`                                       |
   | Build and Output Settings | same as develop's project                   | same as develop's widget project                    |
   | Environment Variables     | section 7.2                                 | section 7.3                                         |

   **Deploy.** This first deploy uses the default branch (`develop`). Fine; the next steps fix it.

3. **Settings** → **Environments** → **Production** → **Branch Tracking** → `staging` (prod: `main`) → Save.
4. **Settings** → **Environment Variables**: check every variable is ticked for **Production** (that is where the `staging` branch now deploys). Mark `CLERK_SECRET_KEY` and `SENTRY_AUTH_TOKEN` as **Sensitive**.
5. **Settings** → **Build and Deployment** → **Ignored Build Step** → **Only build production**. Without this, every push to every branch builds a preview in these projects. (Skipped builds still count toward Vercel's daily deployment limit, but use no build minutes.)
6. **Settings** → **Domains** → **Add Domain** → `staging.getklivo.com` (widget: `widget-staging.getklivo.com`; prod: `app.` / `widget.`). Connect it to **Production**. Vercel shows the exact DNS record. Use that value, not one from memory.
7. **Deployments** → latest → **⋯** → **Redeploy**, so the build uses the right branch and variables.

---

## 9. DNS records (at your provider for `getklivo.com`)

| Name                                                                                                        | Type  | Value                                       | From          |
| ----------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------- | ------------- |
| `staging`                                                                                                   | CNAME | as shown by Vercel                          | Vercel web    |
| `widget-staging`                                                                                            | CNAME | as shown by Vercel                          | Vercel widget |
| `api-staging`                                                                                               | CNAME | `klivo-api-staging.onrender.com` (as shown) | Render        |
| `clerk.staging`, `accounts.staging`, `clkmail.staging`, `clk._domainkey.staging`, `clk2._domainkey.staging` | CNAME | as shown on Clerk → Domains                 | Clerk         |

Prod: the same set without `-staging` / `.staging`, with Cloud Run's custom-domain records for `api` instead of Render.

### 9.1 Add a record at GoDaddy

DNS for `getklivo.com` is at **GoDaddy** (nameservers `ns65.domaincontrol.com`, `ns66.domaincontrol.com`). There is no "start verification" button anywhere: you add the record at GoDaddy, and Clerk, Vercel and Render detect it on their own.

1. godaddy.com → sign in → **My Products** → next to `getklivo.com` click **DNS** (or **Manage DNS**).
2. **DNS Records** tab → **Add New Record**.
3. **Type:** CNAME. **Name:** only the part before `.getklivo.com` (`clerk.staging`, not `clerk.staging.getklivo.com`; GoDaddy adds the domain itself, and the full name would become `clerk.staging.getklivo.com.getklivo.com`). **Value:** copy exactly from the tool. **TTL:** default (1 hour).
4. **Save.** Repeat for every record.

### 9.2 Check a record is live

```powershell
nslookup -type=CNAME clerk.staging.getklivo.com
```

Live when the output has a `canonical name = <the value you entered>` line. Usually 5 to 30 minutes at GoDaddy; tools allow up to 48 hours.

### 9.3 Let each tool verify

| Tool   | Where                                                           | Done when                                                             |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Clerk  | Configure → **Domains** (refresh, or the check button on a row) | every row shows **Verified**; then **Home** → **Deploy certificates** |
| Vercel | project → Settings → **Domains** (Refresh)                      | **Valid Configuration**                                               |
| Render | service → Settings → **Custom Domains** → **Verify**            | **Verified** + certificate issued                                     |

If `nslookup` shows the right value but a tool still says unverified, wait 10 minutes and refresh. If `nslookup` shows nothing, check the Name field at GoDaddy for a doubled `.getklivo.com`.

---

## 10. GitHub

1. The `staging` branch already exists (from `develop` at 71e3c0a on 2026-11-03).
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

   | Secret                          | Staging                          | Prod                                |
   | ------------------------------- | -------------------------------- | ----------------------------------- |
   | Database (session pooler, 5432) | `STAGING_DATABASE_URL`           | `PROD_DATABASE_URL`                 |
   | Deploy trigger                  | `RENDER_STAGING_DEPLOY_HOOK_URL` | (Cloud Run credentials, when built) |
   | First admin email               | `STAGING_SUPER_ADMIN_EMAIL`      | `PROD_SUPER_ADMIN_EMAIL`            |
   | First admin Clerk ID            | `STAGING_SUPER_ADMIN_CLERK_ID`   | `PROD_SUPER_ADMIN_CLERK_ID`         |

3. **Settings** → **Rules** → **Rulesets** → **New branch ruleset**: target `staging` (prod: `main`), **Require a pull request before merging**, **Require status checks to pass** (the CI jobs), **Block force pushes**.
4. **Merge `feature/staging-environment` into `develop` first.** GitHub runs `workflow_run` workflows only from the default branch, so `deploy-staging.yml` does nothing until it is on `develop`.
5. Trigger the first deploy: **Actions** → **Deploy staging** → **Run workflow** (or merge a PR into `staging`). It runs: migrate → seed super admin → Render deploy hook → wait for the new commit on `/health` → check `/health/ready`.

---

## 11. Cron jobs (after the first deploy works)

Staging Supabase → **SQL Editor** → run once. Paste `INTERNAL_API_SECRET` in the first statement only. Do not save the query with the secret in it.

```sql
-- 1. Secret in Supabase Vault (encrypted at rest).
select vault.create_secret('<PASTE INTERNAL_API_SECRET>', 'internal_api_secret');

-- 2. One helper, so the URL and the secret live in one place.
create or replace function public.call_internal(path text)
returns bigint language sql as $$
  select net.http_post(
    url := 'https://api-staging.getklivo.com/api/klivo/v1/internal/' || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'internal_api_secret')
    ),
    timeout_milliseconds := 5000
  );
$$;

-- 3. Jobs. Same schedules as develop.
select cron.schedule('data-extraction-run', '* * * * *',   $$select public.call_internal('data-extraction/run')$$);
select cron.schedule('handover-sweep',      '*/5 * * * *', $$select public.call_internal('handover/sweep')$$);
select cron.schedule('classifier-run',      '30 19 * * *', $$select public.call_internal('classifier/run')$$);
select cron.schedule('fx-run',              '30 17 * * *', $$select public.call_internal('fx/run')$$);
select cron.schedule('retention-run',       '0 21 * * *',  $$select public.call_internal('retention/run')$$);
```

**Prod:** change the URL to `https://api.getklivo.com/...` and also add `select cron.schedule('alerts-run', '*/15 * * * *', $$select public.call_internal('alerts/run')$$);`.

Check after 5 minutes:

```sql
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;
```

The every-minute job also keeps the free Render service awake, so staging never sleeps.

---

## 12. Prod only: do before go-live

Not needed for staging. Listed here so prod setup has one checklist. Code items are fixes in the repo, not console steps.

- [ ] Supabase **Pro**, daily backups on; run one **restore test**.
- [ ] Clerk sign-in handles **Device Trust and MFA** (code). Needed for staging too, so it ships before the staging test.
- [ ] Storage bucket **private** with signed links (code: `supabase-storage.service.ts` uses public links).
- [ ] Widget **allowed domains default-deny** (code: `widget-cors.middleware.ts` allows every site when the list is empty).
- [ ] Nightly copy of uploaded files (Supabase backups do not include Storage).
- [ ] Better Stack monitors and heartbeats for prod URLs (free plan: 10 heartbeats in total; develop uses 5).
- [ ] Sentry alert rules (3.3), `SENTRY_ENVIRONMENT=production`.
- [ ] Slack `#klivo-alerts` webhook + `alerts-run` cron.
- [ ] Move develop off `app.` / `api.getklivo.com`.
- [ ] Gemini key on the **paid** tier (no training on customer data).
- [ ] Cloud Run service creation as a script in the repo.

---

## 13. Smoke test

| Check                                                        | Expected                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `https://api-staging.getklivo.com/health`                    | `"status":"ok"` and `"commit"` = the commit you deployed                         |
| `https://api-staging.getklivo.com/health/ready`              | `"ok"`, or `"degraded"` (= no Redis, expected on staging)                        |
| Section 1.4 Data API check                                   | **not** 200                                                                      |
| `https://staging.getklivo.com` → sign in with your user      | Dashboard loads. Browser console: no CORS errors.                                |
| Create an org, invite a second email you own                 | Invitation email from `Klivo Staging` arrives; signing up through the link works |
| Sign in as the invited user on a **different browser**       | Asked for an emailed code once (Device Trust), then signed in                    |
| Create an agent → widget preview → send a message            | Reply streams; OpenAI `klivo-staging` usage shows the call                       |
| Upload an agent logo                                         | Image shows                                                                      |
| Sentry → `klivo-api` → Issues → filter environment `staging` | Only real errors                                                                 |
| Same browser: sign in to develop and staging                 | Both stay signed in (2.7)                                                        |
| `/dashboard/admin/status` after 10 minutes                   | Data extraction and handover sweep show recent runs                              |

---

## 14. After a client test

- Revoke or rotate: OpenAI, Gemini and Resend keys, the Sentry token, the Render deploy hook.
- Free Supabase projects pause after a week without activity. Resume from the dashboard before the next test.
- Keep the Clerk app, the Render service and the Vercel projects. The next client test reuses them.
