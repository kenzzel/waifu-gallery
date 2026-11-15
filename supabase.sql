-- WIBU GALLERY — simple public gallery
-- Run the entire script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Member',
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

create table if not exists public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 90),
  character_name text,
  anime_title text,
  description text,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, wallpaper_id)
);

create index if not exists wallpapers_created_idx on public.wallpapers(created_at desc);
create index if not exists wallpapers_user_idx on public.wallpapers(user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'Member'),
    'member'
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_gallery_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

alter table public.profiles enable row level security;
alter table public.wallpapers enable row level security;
alter table public.favorites enable row level security;

-- Public can read member display names and public wallpaper metadata.
drop policy if exists "profiles public read" on public.profiles;
create policy "profiles public read" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update(display_name) on public.profiles to authenticated;

-- All approved/public gallery items are visible to everyone; owner can manage all.
drop policy if exists "wallpapers public read" on public.wallpapers;
create policy "wallpapers public read" on public.wallpapers for select to anon, authenticated using (true);
drop policy if exists "wallpapers insert own" on public.wallpapers;
create policy "wallpapers insert own" on public.wallpapers for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists "wallpapers delete own or owner" on public.wallpapers;
create policy "wallpapers delete own or owner" on public.wallpapers for delete to authenticated
using (user_id = auth.uid() or public.is_gallery_owner());
drop policy if exists "wallpapers update owner" on public.wallpapers;
create policy "wallpapers update owner" on public.wallpapers for update to authenticated
using (public.is_gallery_owner()) with check (public.is_gallery_owner());

-- Favorites require an account and are private to that account.
drop policy if exists "favorites read own" on public.favorites;
create policy "favorites read own" on public.favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists "favorites insert own" on public.favorites;
create policy "favorites insert own" on public.favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "favorites delete own" on public.favorites;
create policy "favorites delete own" on public.favorites for delete to authenticated using (user_id = auth.uid());

-- Public bucket: gallery photos can be viewed without login. Upload still requires login.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('wallpapers','wallpapers',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "gallery photos public read" on storage.objects;
create policy "gallery photos public read" on storage.objects for select to anon, authenticated
using(bucket_id='wallpapers');

drop policy if exists "gallery upload own folder" on storage.objects;
create policy "gallery upload own folder" on storage.objects for insert to authenticated
with check(bucket_id='wallpapers' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "gallery delete own or owner" on storage.objects;
create policy "gallery delete own or owner" on storage.objects for delete to authenticated
using(bucket_id='wallpapers' and (
  (storage.foldername(name))[1]=auth.uid()::text or public.is_gallery_owner()
));


-- Member-created public collections (albums).
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(collection_id, wallpaper_id)
);
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
drop policy if exists "collections public read" on public.collections;
create policy "collections public read" on public.collections for select to anon, authenticated using (true);
drop policy if exists "collections insert own" on public.collections;
create policy "collections insert own" on public.collections for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "collections update own or owner" on public.collections;
create policy "collections update own or owner" on public.collections for update to authenticated
using(user_id=auth.uid() or public.is_gallery_owner()) with check(user_id=auth.uid() or public.is_gallery_owner());
drop policy if exists "collections delete own or owner" on public.collections;
create policy "collections delete own or owner" on public.collections for delete to authenticated
using(user_id=auth.uid() or public.is_gallery_owner());
drop policy if exists "collection items public read" on public.collection_items;
create policy "collection items public read" on public.collection_items for select to anon, authenticated using(true);
drop policy if exists "collection items insert own" on public.collection_items;
create policy "collection items insert own" on public.collection_items for insert to authenticated
with check(exists(select 1 from public.collections c where c.id=collection_id and c.user_id=auth.uid())
  and exists(select 1 from public.wallpapers w where w.id=wallpaper_id and w.user_id=auth.uid()));
drop policy if exists "collection items delete own" on public.collection_items;
create policy "collection items delete own" on public.collection_items for delete to authenticated
using(exists(select 1 from public.collections c where c.id=collection_id and (c.user_id=auth.uid() or public.is_gallery_owner())));

-- Wibu Gallery profile + interaction migration (Disimpan / Disukai / Komentar).
alter table public.profiles add column if not exists bio text not null default '';

create table if not exists public.saved_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, wallpaper_id)
);
create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, wallpaper_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_wallpaper_created_idx on public.comments(wallpaper_id, created_at);
create index if not exists likes_wallpaper_idx on public.likes(wallpaper_id);
create index if not exists saved_items_wallpaper_idx on public.saved_items(wallpaper_id);

alter table public.saved_items enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

drop policy if exists "saved items read own" on public.saved_items;
create policy "saved items read own" on public.saved_items for select to authenticated using(user_id=auth.uid());
drop policy if exists "saved items insert own" on public.saved_items;
create policy "saved items insert own" on public.saved_items for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "saved items delete own" on public.saved_items;
create policy "saved items delete own" on public.saved_items for delete to authenticated using(user_id=auth.uid());

drop policy if exists "likes read own" on public.likes;
create policy "likes read own" on public.likes for select to authenticated using(user_id=auth.uid());
drop policy if exists "likes insert own" on public.likes;
create policy "likes insert own" on public.likes for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "likes delete own" on public.likes;
create policy "likes delete own" on public.likes for delete to authenticated using(user_id=auth.uid());

drop policy if exists "comments public read" on public.comments;
create policy "comments public read" on public.comments for select to anon, authenticated using(true);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "comments delete own or owner" on public.comments;
create policy "comments delete own or owner" on public.comments for delete to authenticated using(user_id=auth.uid() or public.is_gallery_owner());

grant update(display_name, bio) on public.profiles to authenticated;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  wallpaper_id uuid not null references public.wallpapers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(char_length(reason) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "reports owner read" on public.reports;
create policy "reports owner read" on public.reports for select to authenticated using(public.is_gallery_owner());


-- Explicit table privileges. RLS policies above still control which rows each role can access.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.wallpapers, public.collections, public.collection_items, public.comments to anon, authenticated;
grant select, insert, update, delete on public.favorites to authenticated;
grant insert, delete on public.wallpapers to authenticated;
grant update on public.wallpapers to authenticated;
grant insert, update, delete on public.collections to authenticated;
grant insert, delete on public.collection_items to authenticated;
grant select, insert, delete on public.saved_items, public.likes to authenticated;
grant insert, delete on public.comments to authenticated;
grant insert, select on public.reports to authenticated;
grant update(display_name, bio) on public.profiles to authenticated;
