CREATE TABLE IF NOT EXISTS images (
  id SERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL,
  client_image_id TEXT NOT NULL,
  client_highlight_id TEXT,
  url TEXT,
  page_url TEXT,
  page_title TEXT,
  r2_key TEXT NOT NULL,
  r2_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  annotation TEXT,
  context_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_images_upsert
  ON images (machine_id, client_image_id);
