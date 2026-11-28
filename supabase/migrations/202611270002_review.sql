begin;

create table public.mtverse_review (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text collate "C" not null check (length(id) between 1 and 64),
  kind text not null check (kind in ('card','deck','settings','rating','undo')),
  stamp text collate "C" not null check (length(stamp) = 61),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1000000),
  primary key (owner_id,id)
);
alter table public.mtverse_review enable row level security;
revoke all on public.mtverse_review from public, anon, authenticated;
grant select, insert on public.mtverse_review to authenticated;
grant update (owner_id,id,kind,stamp,data) on public.mtverse_review to authenticated;
create policy "Read own review records" on public.mtverse_review for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Create own review records" on public.mtverse_review for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Edit own cards and preferences" on public.mtverse_review for update to authenticated
  using (owner_id = (select auth.uid()) and kind in ('card','deck','settings'))
  with check (owner_id = (select auth.uid()) and kind in ('card','deck','settings'));

-- Compare the edit time plus device-generated operation UUID atomically.
-- A deletion is a card tombstone. Rating and undo rows are append-only.
create function public.mtverse_review_edit() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.owner_id,new.id,new.kind) is distinct from (old.owner_id,old.id,old.kind) then
    raise exception 'Review record identity cannot change';
  end if;
  if new.stamp <= old.stamp then return old; end if;
  return new;
end;
$$;
create trigger mtverse_review_edit before update on public.mtverse_review
  for each row execute function public.mtverse_review_edit();
commit;
