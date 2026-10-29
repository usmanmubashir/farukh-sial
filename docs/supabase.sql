-- Shifa Pharmacy POS: sync tables and row-level security (RLS) for Supabase.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run. Safe to run again.
--
-- Model
--   * pharmacies:        one row per pharmacy.
--   * pharmacy_members:  which sign-in account belongs to which pharmacy. One pharmacy per account.
--   * ops:               the change log. Append-only: clients can read and add rows, never edit or delete them.
--   * snapshots:         chunks of a full copy, so a new device starts from a snapshot instead of the whole history.
--                        A snapshot is usable once its '_meta' row exists.
-- Every row carries pharmacy_id. A trigger fills it from the caller's membership, and RLS only lets a member
-- see and add rows for their own pharmacy. The anon key alone can read nothing.

create extension if not exists pgcrypto;

create table if not exists public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pharmacy_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.ops (
  seq bigint generated always as identity primary key,
  op_id text not null unique,
  pharmacy_id uuid,
  device_id text not null,
  stamp text not null,
  store text not null,
  op text not null check (op in ('put', 'delete')),
  key text not null,
  record jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ops_pharmacy_seq on public.ops (pharmacy_id, seq);

create table if not exists public.snapshots (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null,
  pharmacy_id uuid,
  cursor bigint not null,
  store text not null,
  part integer not null,
  rows jsonb not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, store, part)
);
create index if not exists snapshots_pharmacy_store on public.snapshots (pharmacy_id, store, created_at desc);

-- Fills pharmacy_id from the caller's membership. Refuses rows from accounts that belong to no pharmacy.
create or replace function public.set_pharmacy_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select m.pharmacy_id into new.pharmacy_id
  from public.pharmacy_members m
  where m.user_id = auth.uid();
  if new.pharmacy_id is null then
    raise exception 'this account is not a member of a pharmacy';
  end if;
  return new;
end;
$$;

drop trigger if exists ops_set_pharmacy on public.ops;
create trigger ops_set_pharmacy before insert on public.ops
  for each row execute function public.set_pharmacy_id();

drop trigger if exists snapshots_set_pharmacy on public.snapshots;
create trigger snapshots_set_pharmacy before insert on public.snapshots
  for each row execute function public.set_pharmacy_id();

-- Row-level security. Every table is locked; each policy checks membership.
alter table public.pharmacies enable row level security;
alter table public.pharmacy_members enable row level security;
alter table public.ops enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists pharmacies_read on public.pharmacies;
create policy pharmacies_read on public.pharmacies for select to authenticated
  using (id in (select pharmacy_id from public.pharmacy_members where user_id = auth.uid()));

drop policy if exists members_read_own on public.pharmacy_members;
create policy members_read_own on public.pharmacy_members for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ops_read on public.ops;
create policy ops_read on public.ops for select to authenticated
  using (pharmacy_id in (select pharmacy_id from public.pharmacy_members where user_id = auth.uid()));

-- Append-only: there is deliberately no update or delete policy on ops.
drop policy if exists ops_append on public.ops;
create policy ops_append on public.ops for insert to authenticated
  with check (pharmacy_id in (select pharmacy_id from public.pharmacy_members where user_id = auth.uid()));

drop policy if exists snapshots_read on public.snapshots;
create policy snapshots_read on public.snapshots for select to authenticated
  using (pharmacy_id in (select pharmacy_id from public.pharmacy_members where user_id = auth.uid()));

drop policy if exists snapshots_append on public.snapshots;
create policy snapshots_append on public.snapshots for insert to authenticated
  with check (pharmacy_id in (select pharmacy_id from public.pharmacy_members where user_id = auth.uid()));

-- Nothing for the anon role: without a signed-in member account the API returns no rows.
revoke all on public.ops, public.snapshots, public.pharmacy_members, public.pharmacies from anon;

-- ---------------------------------------------------------------------------
-- Setting up a pharmacy (run once, after creating the owner's account):
--   1. Dashboard → Authentication → Users → Add user → email + password, auto-confirm.
--      Copy the user's UID.
--   2. Turn off public sign-ups: Authentication → Providers → Email → "Allow new users to sign up" = off.
--   3. Run, with your values:
--
--   insert into public.pharmacies (name) values ('Demo Pharmacy') returning id;
--   insert into public.pharmacy_members (user_id, pharmacy_id)
--   values ('<the user UID>', '<the pharmacy id returned above>');
--
-- In the app: Settings → Sync: the Project URL (Settings → API → Project URL), the anon public key
-- (Settings → API → anon public), that email and password.
