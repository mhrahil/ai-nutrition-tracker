-- AI Nutrition Tracker — Initial Schema

-- user_profiles (set during onboarding)
create table user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users unique on delete cascade,
  name text,
  current_weight_kg decimal,
  target_weight_kg decimal,
  height_cm int,
  age int,
  gender text,                   -- male, female, other
  activity_level text,           -- sedentary, lightly_active, moderately_active, very_active, extra_active
  goal text,                     -- lose_weight, maintain, gain_muscle
  daily_calories_target int,
  daily_protein_g int,
  daily_carbs_g int,
  daily_fat_g int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- food_entries (one row per food item logged)
create table food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  log_date date default current_date,
  logged_at timestamptz default now(),
  meal_type text not null,       -- breakfast, lunch, dinner, snack
  food_name text not null,
  portion_description text,      -- '1 medium chicken breast', '1 cup cooked rice'
  quantity_grams decimal,
  calories int not null,
  protein_g decimal not null,
  carbs_g decimal not null,
  fat_g decimal not null,
  fibre_g decimal,
  photo_url text,                -- Supabase Storage URL (null if manually entered)
  ai_identified boolean default false
);

-- weight_logs
create table weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  log_date date default current_date,
  logged_at timestamptz default now(),
  weight_kg decimal not null
);

-- Row Level Security (users can only access their own data)
alter table user_profiles enable row level security;
alter table food_entries enable row level security;
alter table weight_logs enable row level security;

create policy "Users access own profile"
  on user_profiles for all using (auth.uid() = user_id);

create policy "Users access own food entries"
  on food_entries for all using (auth.uid() = user_id);

create policy "Users access own weight logs"
  on weight_logs for all using (auth.uid() = user_id);

-- Storage bucket for food photos (run this in Supabase dashboard or via CLI)
-- insert into storage.buckets (id, name, public) values ('food-photos', 'food-photos', true);
-- create policy "Users upload own photos" on storage.objects for insert with check (auth.uid()::text = (storage.foldername(name))[1]);
-- create policy "Public read food photos" on storage.objects for select using (bucket_id = 'food-photos');
