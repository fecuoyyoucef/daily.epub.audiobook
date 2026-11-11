CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT auth_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text,
  publisher text,
  language text NOT NULL DEFAULT 'und',
  identifier text,
  description text,
  cover_blob_path text,
  epub_blob_path text,
  epub_sha256 text,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'parsing', 'ready', 'partial', 'failed', 'archived', 'deleting')),
  import_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS book_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  spine_index integer NOT NULL CHECK (spine_index >= 0),
  chapter_number integer NOT NULL CHECK (chapter_number >= 1),
  title text NOT NULL,
  href text,
  media_type text,
  language text,
  direction text CHECK (direction IN ('ltr', 'rtl', 'auto')),
  cfi_start text,
  cfi_end text,
  text_blob_path text,
  extracted_text text,
  text_sha256 text,
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  character_count integer NOT NULL DEFAULT 0 CHECK (character_count >= 0),
  import_status text NOT NULL DEFAULT 'pending' CHECK (import_status IN ('pending', 'processing', 'ready', 'partial', 'failed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, spine_index),
  UNIQUE (book_id, chapter_number),
  UNIQUE (id, book_id, user_id),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reader_progress (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid,
  cfi text,
  progress_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  reading_mode text NOT NULL DEFAULT 'paginated' CHECK (reading_mode IN ('paginated', 'scroll')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reader_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'sepia', 'system')),
  font_family text NOT NULL DEFAULT 'serif',
  font_size numeric(5, 2) NOT NULL DEFAULT 18 CHECK (font_size BETWEEN 10 AND 48),
  line_height numeric(4, 2) NOT NULL DEFAULT 1.7 CHECK (line_height BETWEEN 1 AND 3),
  margin integer NOT NULL DEFAULT 24 CHECK (margin BETWEEN 0 AND 120),
  max_width integer NOT NULL DEFAULT 760 CHECK (max_width BETWEEN 320 AND 1600),
  text_alignment text NOT NULL DEFAULT 'start' CHECK (text_alignment IN ('start', 'justify', 'center')),
  pagination_mode text NOT NULL DEFAULT 'paginated' CHECK (pagination_mode IN ('paginated', 'scroll')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  cfi text NOT NULL,
  label text,
  excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  cfi_range text NOT NULL,
  selected_text text NOT NULL,
  note text,
  color text NOT NULL DEFAULT 'amber',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('manual', 'automatic')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'pause_requested', 'paused', 'completed', 'partial', 'failed', 'cancelled', 'uncertain')),
  priority integer NOT NULL DEFAULT 0,
  requested_by text NOT NULL DEFAULT 'user',
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_chapters integer NOT NULL DEFAULT 0 CHECK (total_chapters >= 0),
  completed_chapters integer NOT NULL DEFAULT 0 CHECK (completed_chapters >= 0),
  total_parts integer NOT NULL DEFAULT 0 CHECK (total_parts >= 0),
  completed_parts integer NOT NULL DEFAULT 0 CHECK (completed_parts >= 0),
  requests_reserved integer NOT NULL DEFAULT 0 CHECK (requests_reserved >= 0),
  requests_used integer NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
  last_error_code text,
  last_error_message_safe text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'skipped', 'uncertain')),
  completed_parts integer NOT NULL DEFAULT 0 CHECK (completed_parts >= 0),
  total_parts integer NOT NULL DEFAULT 0 CHECK (total_parts >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, chapter_id),
  UNIQUE (job_id, sequence),
  FOREIGN KEY (job_id, user_id) REFERENCES audio_jobs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  part_index integer NOT NULL CHECK (part_index >= 0),
  text_sha256 text NOT NULL,
  text_start_anchor text,
  text_end_anchor text,
  model text NOT NULL,
  voice text NOT NULL,
  language text NOT NULL,
  style_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reserved', 'generating', 'completed', 'failed', 'uncertain')),
  audio_blob_path text,
  audio_sha256 text,
  mime_type text,
  sample_rate integer CHECK (sample_rate IS NULL OR sample_rate > 0),
  channels integer CHECK (channels IS NULL OR channels > 0),
  bit_depth integer CHECK (bit_depth IS NULL OR bit_depth > 0),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  UNIQUE (chapter_id, part_index, text_sha256, model, voice, style_hash),
  UNIQUE (id, user_id),
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_chapter_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL UNIQUE,
  blob_path text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  sample_rate integer NOT NULL CHECK (sample_rate > 0),
  channels integer NOT NULL CHECK (channels > 0),
  bit_depth integer NOT NULL CHECK (bit_depth > 0),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_progress (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid,
  position_ms bigint NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  playback_rate numeric(3, 2) NOT NULL DEFAULT 1 CHECK (playback_rate BETWEEN 0.5 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL,
  chapter_id uuid NOT NULL,
  audio_part_id uuid,
  position_ms bigint NOT NULL CHECK (position_ms >= 0),
  label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id, book_id, user_id) REFERENCES book_chapters(id, book_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (audio_part_id, user_id) REFERENCES audio_parts(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  model text NOT NULL,
  usage_date date NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Algiers',
  requests_reserved integer NOT NULL DEFAULT 0 CHECK (requests_reserved >= 0),
  requests_committed integer NOT NULL DEFAULT 0 CHECK (requests_committed >= 0),
  tokens_reserved bigint NOT NULL DEFAULT 0 CHECK (tokens_reserved >= 0),
  tokens_committed bigint NOT NULL DEFAULT 0 CHECK (tokens_committed >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, model, usage_date, timezone)
);

CREATE TABLE IF NOT EXISTS quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  model text NOT NULL,
  usage_date date NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Algiers',
  requests_reserved integer NOT NULL DEFAULT 0 CHECK (requests_reserved >= 0),
  requests_committed integer NOT NULL DEFAULT 0 CHECK (requests_committed >= 0),
  tokens_reserved bigint NOT NULL DEFAULT 0 CHECK (tokens_reserved >= 0),
  tokens_committed bigint NOT NULL DEFAULT 0 CHECK (tokens_committed >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'uncertain')),
  reason text NOT NULL,
  audio_job_id uuid,
  audio_part_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (audio_job_id, user_id) REFERENCES audio_jobs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (audio_part_id, user_id) REFERENCES audio_parts(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  book_id uuid,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text,
  chunk_count integer NOT NULL CHECK (chunk_count > 0),
  completed_chunks integer NOT NULL DEFAULT 0 CHECK (completed_chunks >= 0),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'uploading', 'uploaded', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  blob_path text,
  rights_confirmed_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS upload_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK (part_index >= 0),
  blob_path text NOT NULL,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, part_index),
  FOREIGN KEY (upload_id, user_id) REFERENCES uploads(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL,
  book_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  stage text NOT NULL DEFAULT 'queued',
  progress_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  idempotency_key text NOT NULL,
  last_error_code text,
  last_error_message_safe text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (upload_id, user_id) REFERENCES uploads(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (book_id, user_id) REFERENCES books(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  audio_job_id uuid,
  import_job_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_events_one_job_check CHECK ((audio_job_id IS NOT NULL) <> (import_job_id IS NOT NULL)),
  FOREIGN KEY (audio_job_id, user_id) REFERENCES audio_jobs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (import_job_id, user_id) REFERENCES import_jobs(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_expiry_idx ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS books_user_status_updated_idx ON books(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS book_chapters_book_chapter_idx ON book_chapters(book_id, chapter_number);
CREATE UNIQUE INDEX IF NOT EXISTS reader_preferences_scope_uidx ON reader_preferences(user_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS bookmarks_user_book_created_idx ON bookmarks(user_id, book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS annotations_user_book_active_idx ON annotations(user_id, book_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS audio_profiles_scope_uidx ON audio_profiles(user_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS audio_jobs_user_status_created_idx ON audio_jobs(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS audio_job_items_job_status_sequence_idx ON audio_job_items(job_id, status, sequence);
CREATE INDEX IF NOT EXISTS audio_parts_chapter_status_idx ON audio_parts(chapter_id, status);
CREATE INDEX IF NOT EXISTS daily_usage_user_date_idx ON daily_usage(user_id, usage_date);
CREATE INDEX IF NOT EXISTS quota_reservations_user_status_created_idx ON quota_reservations(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS uploads_user_status_expiry_idx ON uploads(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS import_jobs_user_status_created_idx ON import_jobs(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS job_events_audio_job_created_idx ON job_events(audio_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_events_import_job_created_idx ON job_events(import_job_id, created_at DESC);
