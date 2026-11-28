begin;

-- A single desk is assigned by an administrator to a verified Auth user.
create table public.mtverse_private_desks (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  single_desk boolean not null default true unique check (single_desk),
  note text not null default '' check (char_length(note) <= 240)
);
alter table public.mtverse_private_desks enable row level security;
revoke all on public.mtverse_private_desks from public, anon, authenticated;
grant select, update (note) on public.mtverse_private_desks to authenticated;
create policy "Read assigned desk" on public.mtverse_private_desks for select to authenticated
using (owner_id = (select auth.uid()));
create policy "Edit own desk note" on public.mtverse_private_desks for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

commit;
