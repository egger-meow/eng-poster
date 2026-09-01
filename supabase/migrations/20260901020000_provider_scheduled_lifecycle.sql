-- Forward-only migration adding provider_scheduled lifecycle and look-ahead claiming

alter table public.marketing_posts drop constraint if exists marketing_posts_status_check;
alter table public.marketing_posts add constraint marketing_posts_status_check
  check (status in ('scheduled','claimed','provider_scheduled','published','retryable_failed','permanently_failed','cancelled'));

alter table public.marketing_posts add column if not exists provider_scheduled_at timestamptz;
alter table public.marketing_posts add column if not exists provider_status text;

create index if not exists marketing_posts_provider_scheduled_idx
  on public.marketing_posts(status, scheduled_for) where status = 'provider_scheduled';

-- Replace claim_marketing_posts with look-ahead window support (default 24 hours)
create or replace function public.claim_marketing_posts(
  p_limit integer default 10,
  p_lease_minutes integer default 15,
  p_platforms text[] default null,
  p_lookahead_hours integer default 24
)
returns setof public.marketing_posts
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with due as (
    select p.id from public.marketing_posts p
    where p.scheduled_for <= (now() + make_interval(hours => p_lookahead_hours))
      and (
        p.status = 'scheduled'
        or (p.status = 'retryable_failed' and (p.lease_expires_at is null or p.lease_expires_at < now()))
      )
      and (p_platforms is null or p.platform = any(p_platforms))
    order by p.scheduled_for for update skip locked limit greatest(1, least(p_limit, 100))
  )
  update public.marketing_posts p set status = 'claimed', lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(mins => p_lease_minutes), attempt_count = attempt_count + 1, updated_at = now()
  from due where p.id = due.id returning p.*;
end $$;

revoke all on function public.claim_marketing_posts(integer, integer, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_posts(integer, integer, text[], integer) to service_role;
