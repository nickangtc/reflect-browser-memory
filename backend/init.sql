-- Database initialization script for PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id VARCHAR(255),
  client_highlight_id VARCHAR(255),
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  page_title TEXT,
  annotation TEXT,
  xpath TEXT,
  context_before TEXT,
  context_after TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);

-- Existing installations keep their rows unchanged; only new captures populate this field.
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS page_title TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS highlights_machine_client_id
  ON highlights (machine_id, client_highlight_id)
  WHERE client_highlight_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_highlights_processed ON highlights(processed, created_at);
CREATE INDEX IF NOT EXISTS idx_highlights_machine ON highlights(machine_id, created_at);
CREATE INDEX IF NOT EXISTS idx_highlights_updated_at ON highlights(updated_at);

CREATE TABLE IF NOT EXISTS youtube_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id VARCHAR(255),
  client_annotation_id VARCHAR(255),
  client_visit_id VARCHAR(255),
  url TEXT NOT NULL,
  youtube_title TEXT,
  youtube_channel TEXT,
  timestamp_seconds INTEGER,
  annotation TEXT NOT NULL,
  draw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);

ALTER TABLE youtube_annotations
  ADD COLUMN IF NOT EXISTS youtube_title TEXT,
  ADD COLUMN IF NOT EXISTS youtube_channel TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS youtube_annotations_machine_client_id
  ON youtube_annotations (machine_id, client_annotation_id)
  WHERE client_annotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_youtube_annotations_updated_at ON youtube_annotations(updated_at);

CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id VARCHAR(255),
  client_image_id VARCHAR(255),
  client_highlight_id VARCHAR(255),
  r2_key TEXT,
  r2_url TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  url TEXT,
  page_url TEXT,
  page_title TEXT,
  width INTEGER,
  height INTEGER,
  context_text TEXT,
  annotation TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS images_machine_client_id
  ON images (machine_id, client_image_id)
  WHERE client_image_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id VARCHAR(255),
  url TEXT NOT NULL,
  text TEXT,
  r2_key TEXT,
  r2_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS read_later (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  domain TEXT,
  preview_image TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_url TEXT UNIQUE NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Explicit, user-confirmed observations of social posts. A post is canonical;
-- every capture creates a timestamped metrics snapshot and reflection.
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin')),
  platform_post_id TEXT NOT NULL,
  permalink TEXT NOT NULL,
  author_name TEXT,
  author_profile_url TEXT,
  content_text TEXT,
  published_at TIMESTAMPTZ,
  published_at_raw TEXT,
  published_at_source TEXT,
  media JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedded_post JSONB,
  author_name_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  author_profile_url_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  content_text_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  published_at_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, platform_post_id)
);

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS author_name_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS author_profile_url_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS content_text_user_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at_user_corrected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS social_post_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  machine_id VARCHAR(255) NOT NULL,
  client_capture_id VARCHAR(255) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('feed', 'detail', 'unknown')),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  parser_version TEXT NOT NULL,
  extraction_confidence TEXT NOT NULL CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  capture_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (machine_id, client_capture_id)
);

CREATE INDEX IF NOT EXISTS idx_social_post_snapshots_post_observed
  ON social_post_snapshots (post_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_post_snapshots_observed
  ON social_post_snapshots (observed_at DESC);

CREATE TABLE IF NOT EXISTS social_post_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL UNIQUE REFERENCES social_post_snapshots(id) ON DELETE CASCADE,
  ownership TEXT NOT NULL CHECK (ownership IN ('own', 'external', 'unknown')),
  performance_assessment TEXT NOT NULL CHECK (performance_assessment IN ('doing_well', 'underperforming', 'too_early_or_unknown')),
  reflection_text TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
