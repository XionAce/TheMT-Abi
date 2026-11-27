# MTVerse account setup

MTVerse uses Supabase Auth and PostgreSQL. Every verified account has a Planner, Focus room, and Garden. An administrator can assign one account the AbiVerse desk, with its personal greeting, pinned Home note, and migration of the original browser's study records.

## Prepare Supabase

1. In the project SQL Editor, apply the files in `supabase/migrations/` in date order. If the original study-records migration is already installed, apply only the private-desk migration. Both tables use owner-based row-level security.
2. Under Authentication, enable email and password sign-up, email confirmation, and secure email changes. Use a server-side minimum password length of 12. Configure production SMTP so verification and recovery can reach public users. Keep the project's Auth rate limits enabled.
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
