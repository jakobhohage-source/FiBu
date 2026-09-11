-- ===========================================================================
-- Finanzübersicht – Setup für Belege und Kontoauszug-Import
-- Einmal komplett im Supabase SQL-Editor ausführen (Dashboard → SQL Editor).
-- Das Skript ist wiederholbar: mehrfaches Ausführen schadet nicht.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Belege: Datei-Anhang je Buchung
-- ---------------------------------------------------------------------------
alter table public.entries add column if not exists receipt_path text;
alter table public.entries add column if not exists receipt_name text;

-- ---------------------------------------------------------------------------
-- 2. Kontoauszug-Import: Kennung zur Dublettenerkennung
-- ---------------------------------------------------------------------------
alter table public.entries add column if not exists import_hash text;
create index if not exists entries_import_hash_idx on public.entries (import_hash);

-- ---------------------------------------------------------------------------
-- 3. Zuordnungsregeln (werden in der App unter "Einstellungen" gepflegt)
-- ---------------------------------------------------------------------------
create table if not exists public.import_rules (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  active       boolean not null default true,
  priority     integer not null default 100,
  match_field  text not null default 'any',      -- 'text' | 'party' | 'any'
  match_op     text not null default 'contains', -- 'contains' | 'starts' | 'equals' | 'regex'
  pattern      text not null,
  direction    text,                             -- null | 'income' | 'expense'
  account_code text,
  percent      text,
  note         text
);

alter table public.import_rules enable row level security;

drop policy if exists "import_rules fuer angemeldete Personen" on public.import_rules;
create policy "import_rules fuer angemeldete Personen"
  on public.import_rules
  for all
  to authenticated
  using (true)
  with check (true);

-- Live-Sync für Regeln (damit Änderungen bei allen sofort ankommen)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'import_rules'
  ) then
    alter publication supabase_realtime add table public.import_rules;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Speicher für die Belegdateien (privater Bucket)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('belege', 'belege', false)
on conflict (id) do nothing;

drop policy if exists "Belege lesen" on storage.objects;
create policy "Belege lesen"
  on storage.objects for select to authenticated
  using (bucket_id = 'belege');

drop policy if exists "Belege hochladen" on storage.objects;
create policy "Belege hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'belege');

drop policy if exists "Belege ersetzen" on storage.objects;
create policy "Belege ersetzen"
  on storage.objects for update to authenticated
  using (bucket_id = 'belege');

drop policy if exists "Belege loeschen" on storage.objects;
create policy "Belege loeschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'belege');

-- ---------------------------------------------------------------------------
-- 5. Kalender: wiederkehrende Termine und Erinnerungen
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  active         boolean not null default true,
  title          text not null,
  note           text,
  next_due       date not null,
  interval_unit  text not null default 'year',  -- 'once' | 'month' | 'quarter' | 'year'
  interval_count integer not null default 1,
  lead_days      integer not null default 14,   -- ab wann vorgewarnt wird
  amount         numeric,
  movement_type  text,                          -- 'income' | 'expense'
  wallet         text,                          -- 'bank' | 'cash'
  account_code   text,
  percent        text,
  last_done      date
);

-- ---------------------------------------------------------------------------
-- 6. Rechnungen (Positionen liegen als JSON in der Zeile)
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  number            text not null unique,
  invoice_date      date not null,
  due_date          date,
  service_period    text,
  recipient_name    text not null,
  recipient_address text,
  positions         jsonb not null default '[]'::jsonb,
  total_net         numeric not null default 0,
  total_vat         numeric not null default 0,
  total_gross       numeric not null default 0,
  status            text not null default 'open', -- 'open' | 'paid' | 'cancelled'
  paid_date         date,
  entry_id          uuid,                          -- erzeugte Buchung
  wallet            text,
  account_code      text,
  note              text
);

-- ---------------------------------------------------------------------------
-- 7. Vereinsdaten und andere Einstellungen (Schlüssel/Wert)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. Zugriff und Live-Sync für die neuen Tabellen
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array['reminders', 'invoices', 'app_settings'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists "%s fuer angemeldete Personen" on public.%I', target, target);
    execute format(
      'create policy "%s fuer angemeldete Personen" on public.%I for all to authenticated using (true) with check (true)',
      target, target
    );
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;
