-- Marketing-only, forward-only: no enrollment changes or queued copy rewrites.
alter table public.marketing_posts add column offer_gate text
  check (offer_gate is null or offer_gate = 'free_pilot_active');
alter table public.marketing_posts add column first_comment_text text;
alter table public.marketing_posts add column cta_mode text
  check (cta_mode is null or cta_mode in ('none', 'soft', 'direct'));

-- Keep the cancelled row as audit history and atomically release its cadence key.
create or replace function public.cancel_marketing_offer_post(p_post_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.marketing_posts
  set status = 'cancelled', last_error = left(p_reason, 1000),
      idempotency_key = idempotency_key || ':cancelled:' || id::text,
      lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_post_id and status in ('scheduled', 'claimed', 'retryable_failed', 'provider_scheduled');
end $$;
revoke all on function public.cancel_marketing_offer_post(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_marketing_offer_post(uuid, text) to service_role;
