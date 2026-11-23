begin;

create table public.abiverse_records (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('event', 'doodle', 'focus')),
  record_key text not null check (char_length(record_key) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision uuid not null default gen_random_uuid(),
  primary key (owner_id, kind, record_key)
);

alter table public.abiverse_records enable row level security;
revoke all on public.abiverse_records from public, anon, authenticated;
grant select, insert, update, delete on public.abiverse_records to authenticated;

create policy "Manage own AbiVerse records"
on public.abiverse_records for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

commit;
