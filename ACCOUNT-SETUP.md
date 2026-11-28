# MTVerse account setup

MTVerse uses Supabase Auth and PostgreSQL. Every verified account has a Planner, Focus room, and Garden. An administrator can assign one account the AbiVerse desk, with its personal greeting, pinned Home note, and migration of the original browser's study records.

## Testing with the built-in sender

During development, use the existing Vercel preview and Supabase's built-in sender. For email verification or recovery, use an address already on the Supabase project team and open the emailed link in the same browser that requested it. A verified account can sign in with its password between email tests. The sender has a low shared rate limit. If you reach it, wait before requesting another message.

Public email delivery and a custom domain can wait until launch. Google buttons appear when the Supabase Google provider is enabled. [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp)

## Prepare Supabase

1. In the project SQL Editor, apply the files in `supabase/migrations/` in date order. If the original study-records migration is already installed, apply only the private-desk migration. Both tables use owner-based row-level security.
2. Under Authentication, enable email and password sign-up, email confirmation, and secure email changes. Use a server-side minimum password length of 12. Before public launch, configure production SMTP so verification and recovery can reach public users. Keep the project's Auth rate limits enabled.
3. Set the Auth Site URL to the production origin. Add the exact callback URL `https://mt-abi.vercel.app/login.html` to the redirect allowlist. For a branch preview, add its exact HTTPS login URL separately.
4. In Google Cloud, configure the OAuth consent screen and a Web application OAuth client. Add `https://jwbuvusjftowihjimfpr.supabase.co/auth/v1/callback` as an authorized redirect URI. For public use, configure the consent screen for external users and publish it. In Supabase, enable the Google provider and enter the Google client ID and secret there.
5. Enable manual identity linking in Supabase Auth for **My account → Connect Google**. The account's confirmed primary email receives password resets. **Change sign-in and recovery email** lets a user change that address through confirmation. PKCE email links should be opened in the browser where the request started.

The frontend uses the project's existing publishable key. No new Vercel secrets are needed. Keep database passwords, service-role keys and the Google client secret in the provider dashboards.

## Assign Abi's desk

Have Abi create and verify her account. In Supabase Authentication → Users, verify her email and copy her user UUID. Run the following once as the project administrator, substituting that UUID:

```sql
insert into public.mtverse_private_desks (owner_id)
select id from auth.users
where id = 'REPLACE_WITH_VERIFIED_USER_UUID'::uuid
  and email_confirmed_at is not null;
```

Confirm one row was inserted. Abi can reload, open **My account**, and pin her first note. On her original browser and production domain, **Copy my original device work** merges legacy items without overwriting existing records. A preview deployment has a separate browser-storage origin. If she previously used Spotify, she reconnects it once under her signed-in account.

## Before switching the live site

Use a regular test account and Abi's verified account on the configured preview. Check verification email delivery, Google sign-in and linking, password reset, sign-out, the regular workspace, and Abi's private note. Deploy the branch through the existing Vercel project once these checks pass. Auth callbacks and email delivery require the provider configuration above.

## Review on the accounts preview (Phase 1a)

Apply `supabase/migrations/202611270002_review.sql` once in the Supabase SQL Editor. The owner-only table is additive. Existing Planner, Garden, and Focus records use their original table. Review can save to this browser while the new table is awaiting setup. Open **Home → Your spaces → Review** or visit `/#review`. There are no new environment variables or API keys.

Use Node 24 or later. Run `npm ci`, `npm test`, and `npm run build`. Serve the resulting `public/` directory on localhost or deploy the preview over HTTPS. For example, `python -m http.server 8000 --directory public`. The build bundles ts-fsrs 6.0.1 (MIT) for scheduling and includes its dependency srs-kit 1.0.1 (BSD-3-Clause). Both license notices ship in `public/vendor/`.

### What is saved

Each account has a separate IndexedDB library with decks, basic cards, image attachments, the adjustable new-card limit, and rating/undo events. Quick-add accepts two-column HTML tables, tab-separated text, and `Term :: Definition` lines. Incomplete and duplicate rows stay in the preview for correction. Approved rows save together in one local transaction. Paste a picture into the selected side or use **Choose image**. The client resizes the longest edge to at most 1600 pixels, converts to JPEG, and reduces dimensions further as necessary to stay below about 330 KiB per image. Animations use a still frame. Remote image links require copying or choosing the actual image.

Each local write also marks the row for upload. The verified account syncs the outbox to Supabase and checks for changes from other devices. **Review history is append-only.** Undo appends a reference to the last active rating. Replaying the ordered history with the pinned FSRS version reconstructs the schedule. Retrying an upload reuses its record ID. **Card edits use last-edit-wins**, ordered by the device's edit timestamp with a UUID tie-breaker. Deletions leave tombstones so an older offline edit cannot resurrect a card. Device clock accuracy affects this ordering.

The 15-new-card default is shared across decks. The study date rolls over at **4 am local time**. Each rating records its local study date at entry. Due repeats are still offered once the new-card allowance is used. Two disconnected devices can each use the same remaining allowance until they sync.

Under **Study settings**, enable offline reopening on a personal device while online. The app installs its offline files and requests persistent storage. The browser decides whether to grant it. A trusted offline launch opens Review only. A reconnect verifies the account before uploading. Disabling offline reopening or signing out revokes the local shortcut. The account's local database remains on the device for its next sign-in, including pending changes. Browser data clearing or storage eviction can erase unsynced work. iOS/iPadOS browser users see the Home Screen tip once per browser storage profile.

**My account → Study backups** exports version 3 with Review records, card images, history, settings and locally saved AI draft text. Versions 1 and 2 still import. Restore merges missing IDs, preserves existing IDs and deletions, and queues newly restored approved Review records for sync. Full-workspace backups require a connection to read the other study spaces.

### Manual acceptance check

1. Open the preview on a phone and desktop. Create a deck. Paste a two-column table and a few lines with blanks, duplicates, or a missing answer. Fix a row, unselect another, and save. Search, edit, and delete a card. Repeat using only the keyboard in both themes.
2. On a real iPad, copy a picture from Photos or Safari and paste into the front or back text field. Try the file picker too. Check the thumbnail, reveal the answer, and read diagram labels after compression.
3. Set the new-card limit to 1. Reveal, rate, and undo. Verify the available count returns and the rating's progress disappears. Try a different deck and confirm it shares the limit.
4. Enable offline reopening, wait for the installation message, and add the site to the Home Screen. In airplane mode close and reopen the installed app, study and edit, then reconnect. Wait for **Synced**. Check the second device after opening Review.
5. Restore a version 3 backup into an empty test account. Check card images, citations, unapproved draft text, due cards, and limit. Import older version 1 and 2 backups and verify Planner events, Garden memories, and Focus history.

## AI cards from PDFs and images

1. Apply `supabase/migrations/202611280001_ai_drafts.sql` in the same project as the accounts preview.
2. In Vercel project settings, add the following **server environment variables** for the Preview environment and redeploy the accounts branch. For local end-to-end testing use `vercel dev` with the same environment. A static server supports offline Review and has no drafting endpoint.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | The Supabase project URL already used by the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | A server-side secret/service-role key for that project |
| `GEMINI_API_KEY` | Key for a paid Gemini project when using Gemini |
| `AI_PROVIDER` | Defaults to `gemini`. Accepts `gemini`, `claude`, or `openai` |
| `AI_MODEL` | Optional model ID. Gemini defaults to `gemini-3.5-flash` |
| `AI_DAILY_PAGE_LIMIT` | Optional positive integer, defaults to 250 per account, resets at 00:00 UTC |

Claude uses `ANTHROPIC_API_KEY` and defaults to `claude-sonnet-4-6`. OpenAI uses `OPENAI_API_KEY` and defaults to `gpt-5.4-mini`. Set only the deployed provider's key in Vercel. Keep secrets outside the public directory and omit public build-variable prefixes.

### Files, evidence and retries

Review → Create from files accepts multiple PDFs and images. Each PDF defaults to all pages. Set an optional inclusive range before adding the files. Each file gets its own deck upon first approval. The browser keeps sources and editable drafts in the signed-in account's IndexedDB. Clear drafts removes this device's queued originals and drafts. The source filename, original page number and quote stay with approved cards.

The screen names the configured provider before generation. Each request sends rendered pages or a resized image through an authenticated Vercel function. Image-only PDFs and diagrams go through the same visual model. Readable PDF text is used locally to check the quote when a text layer exists. Use **View page** or **View source image** to check table associations, figures and handwriting before approval. Generation requires a connection. Saved drafts can be reviewed and approved offline on a trusted device. Backups contain unfinished draft text, excluding original files. Re-select the same named file to view its pages after restoring a backup elsewhere.

A request accepts up to five pages, 3,000,000 binary bytes, 24,000 counted input tokens and 4,800 output tokens. Files are capped at 50 pages and 25 MiB per PDF, or 10 MiB per image. Supabase reserves a section atomically per account. Concurrent duplicate requests share a reservation. A completed result is encrypted with a key derived from the server secret and can be replayed for 24 hours. Expired entries are pruned on later reservations. Each unique section consumes its pages once per UTC day, with up to three model attempts that day. An interrupted reservation unlocks within four minutes. A provider call that finished before the server could record its result may incur another charge on retry. Provider retention is governed by the configured provider account.

PDF.js (`pdfjs-dist`, Apache-2.0) renders source pages and reads their text layer. `pdf-lib` (MIT) packages selected page images as a PDF and validates page counts on the server. The build ships their notices. Provider adapters use native fetch.

### Evaluate quality and cost

Run `npm run eval:cards` for a local dry run using the two synthetic PDFs and one image in `tests/fixtures/flashcards/`. To compare models, set the selected providers' keys in the local environment and run `npm run eval:cards -- --send`. For your own files, put copies in the gitignored `private-eval/` folder and run:

```sh
npm run eval:cards -- --folder private-eval
npm run eval:cards -- --folder private-eval --providers gemini,claude,openai --send
```

Only `--send` makes provider requests. Each selected provider receives the same sections. Results stay in gitignored `evaluation-results/`, outside Vercel's public directory. Review `cards.json` for cards and raw token usage, `costs.csv` for per-section estimates in USD, and `quality.csv` for scoring answers against the original files. The synthetic answer key includes a blank page and easily confused table rows. Check both unsupported answers and missed source facts.

Use `EVAL_GEMINI_MODEL`, `EVAL_CLAUDE_MODEL`, or `EVAL_OPENAI_MODEL` to change individual candidates. For a custom model, set the corresponding `EVAL_*_RATES` to comma-separated input,output USD per million tokens. Unknown prices or unavailable token counts leave cost blank. Estimates use standard uncached rates and include reported thinking/output tokens. Compare actual billing if discounts, cached tokens, or provider fees apply.

The default rates are from the providers' standard pricing tables. [Gemini](https://ai.google.dev/gemini-api/docs/pricing) · [Claude](https://platform.claude.com/docs/en/about-claude/pricing) · [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

On a real iPad, try Files and Photos multi-selection, check small labels against the original, edit an unapproved draft, close and reopen the Home Screen app, then approve offline. HEIC/HEIF photos need a browser that can decode them, or a JPEG copy. After reconnecting, verify the deck and citation on a second signed-in device.
