CREATE TABLE IF NOT EXISTS read_later (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  domain TEXT,
  preview_image TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_read_later_is_read ON read_later (is_read, created_at DESC);
