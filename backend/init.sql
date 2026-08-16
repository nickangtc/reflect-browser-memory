-- Database initialization script for PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id VARCHAR(255),
  client_highlight_id VARCHAR(255),
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  annotation TEXT,
  xpath TEXT,
  context_before TEXT,
  context_after TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);

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
  timestamp_seconds INTEGER,
  annotation TEXT NOT NULL,
  draw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);

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
