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

**My account → Study backups** exports version 2 with Review records, images, history, and settings. Existing version 1 imports still work. Restore merges missing IDs, preserves existing IDs and deletions, and queues newly restored Review records for sync. Full-workspace backups require a connection to read the other study spaces.

### Manual acceptance check

1. Open the preview on a phone and desktop. Create a deck. Paste a two-column table and a few lines with blanks, duplicates, or a missing answer. Fix a row, unselect another, and save. Search, edit, and delete a card. Repeat using only the keyboard in both themes.
2. On a real iPad, copy a picture from Photos or Safari and paste into the front or back text field. Try the file picker too. Check the thumbnail, reveal the answer, and read diagram labels after compression.
3. Set the new-card limit to 1. Reveal, rate, and undo. Verify the available count returns and the rating's progress disappears. Try a different deck and confirm it shares the limit.
4. Enable offline reopening, wait for the installation message, and add the site to the Home Screen. In airplane mode close and reopen the installed app, study and edit, then reconnect. Wait for **Synced**. Check the second device after opening Review.
5. Download a version 2 backup and restore it into an empty test account. Check its images, due cards, and limit. Restore a version 1 backup too. Verify Planner events, Garden memories, and Focus history.
