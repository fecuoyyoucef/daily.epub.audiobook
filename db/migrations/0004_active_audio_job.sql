CREATE UNIQUE INDEX IF NOT EXISTS audio_jobs_one_active_book_per_user_uidx
  ON audio_jobs (user_id, book_id)
  WHERE status IN ('queued', 'running', 'pause_requested');
