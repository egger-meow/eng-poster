-- Forward-only bridge for connector-safe ChatGPT online queue authoring.
-- ChatGPT can only stage a candidate. Existing TypeScript enqueuePlan remains the sole queue writer/validator.

create table public.marketing_authoring_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_key text not null unique,
  source text not null default 'chatgpt-online' check (source = 'chatgpt-online'),
  expected_git_sha text not null check (expected_git_sha ~ '^[0-9a-f]{40}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  target_date date,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'accepted', 'rejected', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_marketing_authoring_submissions_pending
  on public.marketing_authoring_submissions(status, created_at, id)
  where status in ('pending', 'claimed');

alter table public.marketing_authoring_submissions enable row level security;
revoke all on table public.marketing_authoring_submissions from public, anon, authenticated;
grant all on table public.marketing_authoring_submissions to service_role;

create or replace function public.chatgpt_submit_marketing_plan(
  p_payload jsonb,
  p_expected_git_sha text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
  v_status text;
  v_inserted boolean := false;
  v_target_date date;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Marketing authoring payload must be a JSON object' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 131072 then
    raise exception 'Marketing authoring payload exceeds 128 KiB' using errcode = '22023';
  end if;

  if p_expected_git_sha is null or lower(p_expected_git_sha) !~ '^[0-9a-f]{40}$' then
    raise exception 'expected_git_sha must be a 40-character hexadecimal Git SHA' using errcode = '22023';
  end if;

  if coalesce(p_payload->>'planDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_target_date := (p_payload->>'planDate')::date;
    exception when others then
      v_target_date := null;
    end;
  end if;

  -- jsonb::text has deterministic key ordering in PostgreSQL, making this stable for identical payloads.
  v_key := encode(
    extensions.digest(convert_to(lower(p_expected_git_sha) || ':' || p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.marketing_authoring_submissions (
    submission_key,
    source,
    expected_git_sha,
    payload,
    target_date
  ) values (
    v_key,
    'chatgpt-online',
    lower(p_expected_git_sha),
    p_payload,
    v_target_date
  )
  on conflict (submission_key) do nothing
  returning id, status into v_id, v_status;

  if found then
    v_inserted := true;
  else
    select id, status into v_id, v_status
    from public.marketing_authoring_submissions
    where submission_key = v_key;
  end if;

  return jsonb_build_object(
    'submissionId', v_id,
    'submissionKey', v_key,
    'status', v_status,
    'duplicate', not v_inserted
  );
end;
$$;

revoke all on function public.chatgpt_submit_marketing_plan(jsonb, text) from public, anon, authenticated;
grant execute on function public.chatgpt_submit_marketing_plan(jsonb, text) to service_role;

create or replace function public.chatgpt_get_marketing_submission(
  p_submission_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'submissionId', s.id,
    'status', s.status,
    'targetDate', s.target_date,
    'attemptCount', s.attempt_count,
    'result', s.result,
    'errorCode', s.error_code,
    'errorMessage', s.error_message,
    'createdAt', s.created_at,
    'finishedAt', s.finished_at
  )
  from public.marketing_authoring_submissions s
  where s.id = p_submission_id;
$$;

revoke all on function public.chatgpt_get_marketing_submission(uuid) from public, anon, authenticated;
grant execute on function public.chatgpt_get_marketing_submission(uuid) to service_role;

create or replace function private_generation.claim_marketing_authoring_submissions(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 10
)
returns setof public.marketing_authoring_submissions
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) < 3 then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;

  return query
  with candidates as materialized (
    select s.id
    from public.marketing_authoring_submissions s
    where (
      s.status = 'pending'
      or (s.status = 'claimed' and s.lease_expires_at < now())
    )
      and s.attempt_count < 3
    order by s.created_at asc, s.id asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ), claimed as (
    update public.marketing_authoring_submissions s
    set status = 'claimed',
        attempt_count = s.attempt_count + 1,
        claimed_by = trim(p_worker_id),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(mins => greatest(1, least(coalesce(p_lease_minutes, 10), 60))),
        claimed_at = now(),
        updated_at = now()
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select * from claimed;
end;
$$;

revoke all on function private_generation.claim_marketing_authoring_submissions(text, integer, integer) from public, anon, authenticated;
grant execute on function private_generation.claim_marketing_authoring_submissions(text, integer, integer) to service_role;

-- Public PostgREST wrapper. It is still service-role-only and delegates the atomic claim to the private function.
create or replace function public.worker_claim_marketing_authoring_submissions(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 10
)
returns setof public.marketing_authoring_submissions
language sql
security invoker
set search_path = ''
as $$
  select *
  from private_generation.claim_marketing_authoring_submissions(p_worker_id, p_limit, p_lease_minutes);
$$;

revoke all on function public.worker_claim_marketing_authoring_submissions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.worker_claim_marketing_authoring_submissions(text, integer, integer) to service_role;
