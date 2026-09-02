-- Migration: Add copy_length_mode to marketing_posts for explicit long/short writing strategy
alter table public.marketing_posts
  add column if not exists copy_length_mode text
  check (copy_length_mode is null or copy_length_mode in ('short', 'long'));
