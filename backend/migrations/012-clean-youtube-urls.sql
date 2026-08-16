-- Clean up YouTube URLs to remove tracking parameters and standardize format.
-- This guarantees backward and forward compatibility with the simple REGEXP_REPLACE GROUP BY clause.

UPDATE youtube_annotations
SET url = 
  COALESCE(
    'https://www.youtube.com/watch?v=' || SUBSTRING(url FROM '[&?]v=([^&#]+)'),
    'https://www.youtube.com/watch?v=' || SUBSTRING(url FROM 'youtu\.be/([^?#&]+)'),
    'https://www.youtube.com/watch?v=' || SUBSTRING(url FROM '/shorts/([^?#&]+)'),
    url
  ) ||
  COALESCE(
    '&t=' || SUBSTRING(url FROM '[&?]t=(\d+)'),
    ''
  )
WHERE (url LIKE '%youtube.com%' OR url LIKE '%youtu.be%');

UPDATE content_shares
SET content_url = 
  COALESCE(
    'https://www.youtube.com/watch?v=' || SUBSTRING(content_url FROM '[&?]v=([^&#]+)'),
    'https://www.youtube.com/watch?v=' || SUBSTRING(content_url FROM 'youtu\.be/([^?#&]+)'),
    'https://www.youtube.com/watch?v=' || SUBSTRING(content_url FROM '/shorts/([^?#&]+)'),
    content_url
  )
WHERE (content_url LIKE '%youtube.com%' OR content_url LIKE '%youtu.be%');
