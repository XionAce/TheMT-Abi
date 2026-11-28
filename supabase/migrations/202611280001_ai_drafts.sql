begin;

-- These tables and RPCs are accessible only to the verified server endpoint.
create table public.mtverse_ai_days (
  owner_id uuid references auth.users on delete cascade, day date not null,
  used integer not null default 0, primary key(owner_id,day)
);
create table public.mtverse_ai_sections (
  owner_id uuid references auth.users on delete cascade, digest text not null,
  lease uuid not null, expires_at timestamptz not null, reply text,
  reserved_day date not null, attempts integer not null,
  primary key(owner_id,digest)
);
create index mtverse_ai_expiry on public.mtverse_ai_sections(expires_at);
alter table public.mtverse_ai_days enable row level security;
alter table public.mtverse_ai_sections enable row level security;
revoke all on public.mtverse_ai_days, public.mtverse_ai_sections from public, anon, authenticated;

create function public.mtverse_ai_reserve(p_owner uuid,p_digest text,p_pages int,p_limit int,p_lease uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
  used_pages int;
  cached public.mtverse_ai_sections;
  state text;
begin
  if p_pages not between 1 and 5 or p_limit not between 1 and 100000 or length(p_digest) <> 64 then
    raise exception 'Invalid reservation';
  end if;
  -- The owner/day lock serializes the budget even across concurrent Vercel instances.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
  delete from public.mtverse_ai_sections where expires_at <= now() and reserved_day < today;
  delete from public.mtverse_ai_days where day < today - 2;
  insert into public.mtverse_ai_days(owner_id,day) values(p_owner,today) on conflict do nothing;
  select used into used_pages from public.mtverse_ai_days where owner_id=p_owner and day=today for update;
  select * into cached from public.mtverse_ai_sections where owner_id=p_owner and digest=p_digest;
  if cached.expires_at > now() then
    state := case when cached.reply is null then 'busy' else 'cached' end;
  elsif cached.reserved_day=today and cached.attempts>=3 then state := 'retry_limit';
  elsif cached.reserved_day is distinct from today and used_pages + p_pages > p_limit then state := 'limit';
  else
    state := 'reserved';
    insert into public.mtverse_ai_sections values(p_owner,p_digest,p_lease,now()+interval '4 minutes',null,today,1)
      on conflict(owner_id,digest) do update set lease=p_lease,expires_at=excluded.expires_at,reply=null,
        reserved_day=today,attempts=case when cached.reserved_day=today then cached.attempts+1 else 1 end;
    if cached.reserved_day is distinct from today then used_pages := used_pages + p_pages; end if;
    update public.mtverse_ai_days set used=used_pages where owner_id=p_owner and day=today;
  end if;
  return jsonb_build_object('state',state,'reply',cached.reply,'remaining',greatest(0,p_limit-used_pages),
    'resetAt',((today+1)::timestamp at time zone 'UTC'));
end $$;

create function public.mtverse_ai_finish(p_owner uuid,p_digest text,p_lease uuid,p_reply text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_reply is null then
    update public.mtverse_ai_sections set expires_at=now()
      where owner_id=p_owner and digest=p_digest and lease=p_lease and reply is null;
  else
    update public.mtverse_ai_sections set reply=p_reply, expires_at=now()+interval '24 hours'
      where owner_id=p_owner and digest=p_digest and lease=p_lease and reply is null;
  end if;
  return found;
end $$;

revoke all on function public.mtverse_ai_reserve(uuid,text,int,int,uuid),public.mtverse_ai_finish(uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.mtverse_ai_reserve(uuid,text,int,int,uuid),public.mtverse_ai_finish(uuid,text,uuid,text)
  to service_role;
commit;
