-- Release a cadence key only when its previous post is conclusively terminal.
-- The failed row remains intact for audit and provider diagnostics.
create or replace function public.release_permanently_failed_marketing_slot(p_idempotency_key text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.marketing_posts
  set idempotency_key = idempotency_key || ':permanently_failed:' || id::text,
      updated_at = now()
  where idempotency_key = p_idempotency_key
    and status = 'permanently_failed';

  get diagnostics released_count = row_count;
  return released_count > 0;
end
$$;

revoke all on function public.release_permanently_failed_marketing_slot(text) from public, anon, authenticated;
grant execute on function public.release_permanently_failed_marketing_slot(text) to service_role;
