# Facebook Page Manager

A small multi-page system for setting up, maintaining, and keeping an eye on
Facebook Pages: one dashboard to connect pages, configure their Messenger
FAQ bot, push that setup to Facebook, and schedule/publish posts.

It's the multi-page evolution of the original single-page `../messenger-bot`
project -- same idea (greeting + keyword-matched FAQ answers over Messenger),
but data-driven per page instead of hardcoded, plus a web UI and post
scheduling on top.

## What it does

- **Set up**: connect any number of Pages by pasting a Page Access Token.
  Configure each page's greeting and FAQ topics (keywords -> answer), then
  push that as the page's live Messenger greeting, Get Started button, ice
  breakers, and persistent menu with one click.
- **Maintain**: the FAQ bot runs continuously against Facebook's webhook,
  answering messages per page based on whatever config you've saved. Turn on
  **AI booking** for a page and messages are instead handled by a Claude
  agent that answers using that page's FAQ topics and can check availability
  and reserve a slot against the services/hours you configure for it.
- **Oversee**: a dashboard listing every connected page (bot on/off, whether
  setup has been pushed) and every post across all pages (draft, scheduled,
  published, or failed), with a way to check a scheduled post's status or
  cancel it before it goes live.

## One-time setup

1. **Facebook App** (one app covers every page you'll manage):
   - In [Meta for Developers](https://developers.facebook.com/apps), create/use
     an app with the **Messenger** product added.
   - Note the App Secret (Settings -> Basic) -> `APP_SECRET`.
   - Under Messenger -> Settings -> Webhooks, subscribe a webhook to
     `https://<your-host>/webhook`, with a Verify Token you invent ->
     `VERIFY_TOKEN`, subscribed to the `messages`, `messaging_postbacks`
     fields.
   - You'll need a public HTTPS URL for local testing -- `ngrok http 3100`
     works well.

2. **Per page**: generate a Page Access Token (Business Suite -> System
   Users -> Add Assets -> your page -> generate token with
   `pages_messaging`, `pages_manage_posts`, `pages_read_engagement`), and
   subscribe that page to your app's webhook. You'll paste this token into
   the dashboard, not into `.env` -- `.env` only holds app-wide secrets.

3. **Install & configure**:
   ```bash
   npm install
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # run twice, for SESSION_SECRET and ENCRYPTION_KEY
   ```
   Fill in `.env`: `VERIFY_TOKEN`, `APP_SECRET`, `ADMIN_PASSWORD` (your own
   choice -- this locks the whole dashboard, since it holds every page's
   token), `SESSION_SECRET`, `ENCRYPTION_KEY`. Add `ANTHROPIC_API_KEY` (from
   console.anthropic.com) too if you want the AI booking assistant available
   -- pages work fine without it, they just can't turn booking on.

4. **Run it**:
   ```bash
   npm start
   ```
   Open `http://localhost:3100`, log in with `ADMIN_PASSWORD`, and connect
   your first page.

### Bringing the existing Mina bot in

If `../messenger-bot` still has its token and FAQ content, import it as this
system's first page instead of retyping everything:

```bash
npm run import-mina
```

This reads `../messenger-bot/.env` and `.env` (this project's), verifies the
token with Facebook, and seeds a page here with the same greeting and FAQ
topics. Nothing is changed in `../messenger-bot` -- it can keep running
until you're ready to point the old bot's webhook subscription at this
system instead and retire it.

## Notes on scope

- Posts support text and a single image (by URL, not upload). Scheduling
  uses Facebook's own `scheduled_publish_time`, so Facebook publishes it
  even if this server is offline at the time -- this app just submits the
  request and tracks status.
- Data lives in `data/db.json` (page configs + post history + bookings).
  Access tokens are encrypted at rest with `ENCRYPTION_KEY`; back up that
  file and the key together, or neither is useful on its own.
- Booking times are business-local, computed against the server's own
  clock -- fine if the server and the business are in the same timezone,
  which covers the common case of running this on a VPS you pick yourself.
  If you're managing pages across different timezones from one server, that
  needs real per-page timezone handling this doesn't have yet.
- The AI booking assistant's conversation memory is in-process (resets on
  restart) and it only acts on the services/hours/FAQ you've configured for
  that page -- it won't invent prices or availability.
- There's no built-in HTTPS/reverse proxy -- put this behind one (nginx,
  Caddy, a platform's own TLS) before using it with real client pages
  outside local testing.

## Onboarding another business (reselling this)

Each connected Page is already its own tenant with its own token, FAQ, and
booking config -- there's nothing else per-client to duplicate. To onboard a
new business: get a Page Access Token from their Meta Business Suite,
connect it under **+ Connect a page**, fill in their FAQ and (optionally)
their services/hours, push setup, and point their page's webhook
subscription at this same server. All clients share one `ANTHROPIC_API_KEY`
and one hosting bill, which is what makes this cheaper to run per-client
than a Zapier/n8n-per-client setup would be.
