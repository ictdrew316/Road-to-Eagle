# Troop 533 & 1533 Merit Badge Tracker

A read-only, always-current view of merit badge advancement for Troop 533 (Boys)
and Troop 1533 (Girls), built from Scoutbook's own "Merit Badge In-Progress
Report" export. Anyone with the link can view it; troop leaders can publish
updates through the built-in admin portal — no coding required, no shared
password to manage.

- **`index.html`** — the tracker everyone looks at.
- **`data/tracker-data.json`** — the data the tracker reads. This is the only
  file that changes when you publish an update.
- **`admin/index.html`** — the upload tool leaders use to refresh the data.
- **`admin/parser.js`** — the CSV parsing logic (runs in the browser, no
  server involved).

## One-time setup

1. **Create the GitHub repo.** Make it either public or private — both work
   fine with GitHub Pages on a paid GitHub plan; a free personal account
   needs the repo public for Pages to work. Push all the files in this folder
   to the repo, preserving the folder structure (`index.html`, `data/`,
   `admin/`, `README.md` all at the repo root).

2. **Turn on GitHub Pages.** In the repo: Settings → Pages → Source → "Deploy
   from a branch" → pick your default branch (usually `main`) and `/ (root)`.
   GitHub will give you a URL like `https://<you>.github.io/<repo>/` — that's
   the link to share with scouts and parents.

3. **Add other admins as collaborators**, if you want more than one person
   able to publish updates. Settings → Collaborators → Add people. Anyone you
   add can generate their own token (step below) and use the admin portal —
   there's no shared password, and every update is attributed to whoever
   published it.

## Publishing an update (for any admin)

1. Open `<your-site-url>/admin/`.
2. **Generate a GitHub token** (first time only, or once it expires):
   GitHub → your profile photo → Settings → Developer settings → Personal
   access tokens → Fine-grained tokens → Generate new token.
   - **Resource owner**: your account (or the org that owns the repo)
   - **Repository access**: "Only select repositories" → pick this repo
   - **Permissions**: Repository permissions → **Contents: Read and write**
     (nothing else needed)
   - Set an expiration you're comfortable with (GitHub caps fine-grained
     tokens at 1 year; you'll need to generate a new one when it expires)
   - Copy the token — GitHub only shows it once.
3. In the admin portal, fill in the repo owner, repo name, and paste the
   token, then **Connect**. Your browser remembers these for next time
   (the token stays only in your browser's local storage — it's never sent
   anywhere but GitHub's API).
4. **Upload the CSV export(s).** In Scoutbook: Reports → Advancement →
   Merit Badge In-Progress Report, run it for each troop, and drop both
   files onto the portal.
5. Click **Parse & preview** — you'll see scout/badge counts and, if there's
   already published data, a list of what changed (new totals, newly Eagle
   Ready scouts, scouts that dropped out of the export).
6. Click **Publish to GitHub**. The site rebuilds automatically — give it a
   minute or two, then refresh the tracker.

## Known limitation

Scoutbook's "Merit Badge In-Progress Report" only lists scouts who have *at
least one* merit badge on record (in progress, completed, or awarded). A
scout with literally nothing entered yet won't appear in the export, and so
won't appear on the tracker either, until something is logged for them in
Scoutbook. This isn't a bug in the tracker — it's a gap in what the report
exports.

## No live Scoutbook connection

Scouting America has not shipped a public API for Scoutbook or Scoutbook
Plus, so there's no way to pull data automatically. This admin portal is the
practical alternative: a real update takes under a minute once you have the
CSV exports in hand.
