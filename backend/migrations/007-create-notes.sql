CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  text TEXT,
  r2_key TEXT,
  r2_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notes_url ON notes(url);
