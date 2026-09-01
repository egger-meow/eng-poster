-- Migration: Add asset_mode to marketing_posts for explicit asset strategy modeling
alter table public.marketing_posts
  add column if not exists asset_mode text not null default 'text_only'
  check (asset_mode in ('text_only', 'image_post', 'link_preview'));
