-- Intentional, user-confirmed social-post reflections.
-- One canonical post can have many timestamped metric snapshots and reflections.

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
