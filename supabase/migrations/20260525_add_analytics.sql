-- Migration: Add analytics tables and trigger
-- Run this in the Supabase SQL editor AFTER the initial migration (20260525_init.sql)

-- 1. Add ai_confidence column to food_entries
alter table food_entries
  add column if not exists ai_confidence text;  -- 'high' | 'medium' | 'low'

-- 2. Create daily_summaries table
create table if not exists daily_summaries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users on delete cascade,
  log_date        date not null,
  total_calories  int default 0,
  total_protein_g decimal default 0,
  total_carbs_g   decimal default 0,
  total_fat_g     decimal default 0,
  total_fibre_g   decimal default 0,
  entry_count     int default 0,
  unique (user_id, log_date)
);

-- 3. Enable RLS on daily_summaries
alter table daily_summaries enable row level security;

create policy "Users access own daily summaries"
  on daily_summaries for all using (auth.uid() = user_id);

-- 4. Postgres function to keep daily_summaries in sync with food_entries
create or replace function update_daily_summary()
returns trigger as $$
declare
  target_user_id uuid;
  target_date    date;
begin
  -- For DELETE, use old values; for INSERT/UPDATE, use new values
  target_user_id := coalesce(new.user_id, old.user_id);
  target_date    := coalesce(new.log_date, old.log_date);

  insert into daily_summaries (
    user_id,
    log_date,
    total_calories,
    total_protein_g,
    total_carbs_g,
    total_fat_g,
    total_fibre_g,
    entry_count
  )
  select
    target_user_id,
    target_date,
    coalesce(sum(calories),   0),
    coalesce(sum(protein_g),  0),
    coalesce(sum(carbs_g),    0),
    coalesce(sum(fat_g),      0),
    coalesce(sum(fibre_g),    0),
    count(*)
  from food_entries
  where user_id = target_user_id
    and log_date = target_date
  group by user_id, log_date
  on conflict (user_id, log_date) do update set
    total_calories  = excluded.total_calories,
    total_protein_g = excluded.total_protein_g,
    total_carbs_g   = excluded.total_carbs_g,
    total_fat_g     = excluded.total_fat_g,
    total_fibre_g   = excluded.total_fibre_g,
    entry_count     = excluded.entry_count;

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- 5. Attach trigger to food_entries
drop trigger if exists trg_update_daily_summary on food_entries;

create trigger trg_update_daily_summary
after insert or update or delete on food_entries
for each row execute function update_daily_summary();

-- 6. Backfill daily_summaries from any existing food_entries
insert into daily_summaries (
  user_id,
  log_date,
  total_calories,
  total_protein_g,
  total_carbs_g,
  total_fat_g,
  total_fibre_g,
  entry_count
)
select
  user_id,
  log_date,
  coalesce(sum(calories),  0),
  coalesce(sum(protein_g), 0),
  coalesce(sum(carbs_g),   0),
  coalesce(sum(fat_g),     0),
  coalesce(sum(fibre_g),   0),
  count(*)
from food_entries
group by user_id, log_date
on conflict (user_id, log_date) do nothing;
