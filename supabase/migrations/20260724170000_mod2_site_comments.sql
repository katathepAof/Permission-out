begin;

create table if not exists public.mod2_site_comments (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.mod2_sites(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mod2_site_comments_site_created_idx
  on public.mod2_site_comments(site_id, created_at desc);

alter table public.mod2_site_comments enable row level security;
revoke all on public.mod2_site_comments from anon, authenticated;

comment on table public.mod2_site_comments is
  'Comments attached to MOD 2 map sites; access is mediated by the Worker API.';

commit;
