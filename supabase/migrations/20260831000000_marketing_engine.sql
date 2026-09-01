create extension if not exists pgcrypto;

create table if not exists public.marketing_content_plans (
  id uuid primary key default gen_random_uuid(), plan_date date not null, archetype text not null,
  topic text not null, audience text not null, campaign_slug text not null, research_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'planned', provenance jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.marketing_assets (
  id uuid primary key default gen_random_uuid(), source text not null check (source in ('manual','screenshot','template','ai_generated','fallback')),
  content_hash text not null unique, storage_path text not null, public_url text not null, width integer not null, height integer not null,
  format text not null, topics text[] not null default '{}', audience text[] not null default '{}', allowed_platforms text[] not null default '{facebook,instagram,threads}',
  reuse boolean not null default true, priority integer not null default 0, concept text, expires_at timestamptz,
  usage_count integer not null default 0, last_used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.marketing_posts (
  id uuid primary key default gen_random_uuid(), content_plan_id uuid not null references public.marketing_content_plans(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','threads')),
  asset_mode text not null default 'text_only' check (asset_mode in ('text_only','image_post','link_preview')),
  copy_text text not null, destination_url text,
  media_asset_id uuid references public.marketing_assets(id), scheduled_for timestamptz not null,
  status text not null check (status in ('scheduled','claimed','provider_scheduled','published','retryable_failed','permanently_failed','cancelled')) default 'scheduled',
  idempotency_key text not null unique, content_hash text not null, claim_manifest jsonb not null default '[]'::jsonb,
  platform_post_id text, platform_post_url text, published_at timestamptz, attempt_count integer not null default 0,
  provider_scheduled_at timestamptz, provider_status text,
  last_error text, lease_token uuid, lease_expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketing_posts_due_idx on public.marketing_posts(status, scheduled_for, lease_expires_at);
create index if not exists marketing_posts_platform_published_idx on public.marketing_posts(platform, published_at);
create table if not exists public.marketing_publish_attempts (
  id bigint generated always as identity primary key, post_id uuid not null references public.marketing_posts(id), attempt_number integer not null,
  platform text not null, request_summary jsonb not null default '{}', response_summary jsonb not null default '{}', status_category text not null,
  started_at timestamptz not null, finished_at timestamptz not null, unique(post_id, attempt_number)
);
create table if not exists public.marketing_token_health (
  id bigint generated always as identity primary key, platform text not null, checked_at timestamptz not null default now(), valid boolean not null,
  expiry_timestamp timestamptz, granted_scopes jsonb not null default '[]', diagnostic_message text not null
);

alter table public.marketing_content_plans enable row level security;
alter table public.marketing_posts enable row level security;
alter table public.marketing_assets enable row level security;
alter table public.marketing_publish_attempts enable row level security;
alter table public.marketing_token_health enable row level security;
revoke all on table public.marketing_content_plans from anon, authenticated;
revoke all on table public.marketing_posts from anon, authenticated;
revoke all on table public.marketing_assets from anon, authenticated;
revoke all on table public.marketing_publish_attempts from anon, authenticated;
revoke all on table public.marketing_token_health from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-media', 'marketing-media', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.claim_marketing_posts(p_limit integer default 10, p_lease_minutes integer default 15, p_platforms text[] default null, p_lookahead_hours integer default 24)
returns setof public.marketing_posts
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with due as (
    select p.id from public.marketing_posts p
    where p.scheduled_for <= (now() + make_interval(hours => p_lookahead_hours))
      and (p.status = 'scheduled' or (p.status = 'retryable_failed' and (p.lease_expires_at is null or p.lease_expires_at < now())))
      and (p_platforms is null or p.platform = any(p_platforms))
    order by p.scheduled_for for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.marketing_posts p set status = 'claimed', lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(mins => p_lease_minutes), attempt_count = attempt_count + 1, updated_at = now()
  from due where p.id = due.id returning p.*;
end $$;
revoke all on function public.claim_marketing_posts(integer, integer, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_posts(integer, integer, text[], integer) to service_role;

