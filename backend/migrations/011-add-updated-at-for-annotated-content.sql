-- Add updated_at tracking for annotated content sync.
ALTER TABLE highlights
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE youtube_annotations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE highlights
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

UPDATE youtube_annotations
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE highlights
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE youtube_annotations
  ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_highlights_updated_at ON highlights (updated_at);
CREATE INDEX IF NOT EXISTS idx_youtube_annotations_updated_at ON youtube_annotations (updated_at);
