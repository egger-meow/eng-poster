-- Forward-only migration adding marketing_post_feedback for manual winner feedback and observed metrics

create table if not exists public.marketing_post_feedback (
  post_id uuid primary key references public.marketing_posts(id) on delete cascade,
  is_winner boolean not null default false,
  observed_views bigint check (observed_views is null or observed_views >= 0),
  observed_likes bigint check (observed_likes is null or observed_likes >= 0),
  observed_comments bigint check (observed_comments is null or observed_comments >= 0),
  observed_shares bigint check (observed_shares is null or observed_shares >= 0),
  operator_note text,
  marked_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.marketing_post_feedback enable row level security;
revoke all on table public.marketing_post_feedback from anon, authenticated;
grant all on table public.marketing_post_feedback to service_role;

create index if not exists idx_marketing_post_feedback_is_winner
  on public.marketing_post_feedback(is_winner);

create index if not exists idx_marketing_post_feedback_marked_at
  on public.marketing_post_feedback(marked_at desc);
