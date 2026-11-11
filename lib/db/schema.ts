import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').defaultRandom().primaryKey()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
const jsonSettings = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`)

export const authUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (table) => ({
  emailUnique: unique('user_email_unique').on(table.email),
  singleOwner: uniqueIndex('user_single_owner_key').on(sql`true`),
}))

export const authSession = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
}, (table) => ({
  tokenUnique: unique('session_token_unique').on(table.token),
  userIdIdx: index('session_user_id_idx').on(table.userId),
}))

export const authAccount = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('account_user_id_idx').on(table.userId),
}))

export const authVerification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (table) => ({
  identifierIdx: index('verification_identifier_idx').on(table.identifier),
}))

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
})

export const appUsers = pgTable('app_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  authUserId: text('auth_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
}, (table) => ({
  authUserIdUnique: unique('app_users_auth_user_id_key').on(table.authUserId),
  singleOwner: uniqueIndex('app_users_single_owner_key').on(sql`true`),
}))

export const authRateLimits = pgTable('auth_rate_limits', {
  keyHash: char('key_hash', { length: 64 }).primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  updatedAt: updatedAt(),
}, (table) => ({
  countCheck: check('auth_rate_limits_attempt_count_check', sql`${table.attemptCount} BETWEEN 0 AND 1000`),
  updatedAtIdx: index('auth_rate_limits_updated_at_idx').on(table.updatedAt),
}))

export const authSessions = pgTable('auth_sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  sessionHash: text('session_hash').notNull().unique(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  expiryCheck: check('auth_sessions_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  userExpiryIdx: index('auth_sessions_user_expiry_idx').on(table.userId, table.expiresAt),
}))

export const books = pgTable('books', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  author: text('author'),
  publisher: text('publisher'),
  language: text('language').notNull().default('und'),
  identifier: text('identifier'),
  description: text('description'),
  coverBlobPath: text('cover_blob_path'),
  epubBlobPath: text('epub_blob_path'),
  epubSha256: text('epub_sha256'),
  status: text('status').$type<'uploading' | 'parsing' | 'ready' | 'partial' | 'failed' | 'archived' | 'deleting'>().notNull().default('uploading'),
  importJobId: uuid('import_job_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  ownerKey: unique('books_id_user_id_key').on(table.id, table.userId),
  userStatusUpdatedIdx: index('books_user_status_updated_idx').on(table.userId, table.status, table.updatedAt.desc()),
}))

export const bookChapters = pgTable('book_chapters', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  spineIndex: integer('spine_index').notNull(),
  chapterNumber: integer('chapter_number').notNull(),
  title: text('title').notNull(),
  href: text('href'),
  mediaType: text('media_type'),
  language: text('language'),
  direction: text('direction').$type<'ltr' | 'rtl' | 'auto'>(),
  cfiStart: text('cfi_start'),
  cfiEnd: text('cfi_end'),
  textBlobPath: text('text_blob_path'),
  extractedText: text('extracted_text'),
  textSha256: text('text_sha256'),
  wordCount: integer('word_count').notNull().default(0),
  characterCount: integer('character_count').notNull().default(0),
  importStatus: text('import_status').$type<'pending' | 'processing' | 'ready' | 'partial' | 'failed' | 'skipped'>().notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  bookSpineKey: unique('book_chapters_book_id_spine_index_key').on(table.bookId, table.spineIndex),
  bookChapterKey: unique('book_chapters_book_id_chapter_number_key').on(table.bookId, table.chapterNumber),
  ownerKey: unique('book_chapters_id_book_id_user_id_key').on(table.id, table.bookId, table.userId),
  bookUserFk: foreignKey({ name: 'book_chapters_book_id_user_id_fkey', columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  bookChapterIdx: index('book_chapters_book_chapter_idx').on(table.bookId, table.chapterNumber),
}))

export const readerProgress = pgTable('reader_progress', {
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id'),
  cfi: text('cfi'),
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  readingMode: text('reading_mode').$type<'paginated' | 'scroll'>().notNull().default('paginated'),
  updatedAt: updatedAt(),
}, (table) => ({
  primary: primaryKey({ columns: [table.userId, table.bookId] }),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
}))

export const readerPreferences = pgTable('reader_preferences', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id'),
  theme: text('theme').$type<'light' | 'dark' | 'sepia' | 'system'>().notNull().default('system'),
  fontFamily: text('font_family').notNull().default('serif'),
  fontSize: numeric('font_size', { precision: 5, scale: 2 }).notNull().default('18'),
  lineHeight: numeric('line_height', { precision: 4, scale: 2 }).notNull().default('1.7'),
  margin: integer('margin').notNull().default(24),
  maxWidth: integer('max_width').notNull().default(760),
  textAlignment: text('text_alignment').$type<'start' | 'justify' | 'center'>().notNull().default('start'),
  paginationMode: text('pagination_mode').$type<'paginated' | 'scroll'>().notNull().default('paginated'),
  settings: jsonSettings('settings'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  scopeUnique: uniqueIndex('reader_preferences_scope_uidx').on(table.userId, sql`COALESCE(${table.bookId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
}))

export const bookmarks = pgTable('bookmarks', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  cfi: text('cfi').notNull(),
  label: text('label'),
  excerpt: text('excerpt'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
  userBookCreatedIdx: index('bookmarks_user_book_created_idx').on(table.userId, table.bookId, table.createdAt.desc()),
}))

export const annotations = pgTable('annotations', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  cfiRange: text('cfi_range').notNull(),
  selectedText: text('selected_text').notNull(),
  note: text('note'),
  color: text('color').notNull().default('amber'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
  userBookActiveIdx: index('annotations_user_book_active_idx').on(table.userId, table.bookId, table.deletedAt),
}))

export const audioProfiles = pgTable('audio_profiles', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id'),
  settings: jsonSettings('settings'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ownerKey: unique('audio_profiles_id_user_id_key').on(table.id, table.userId),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  scopeUnique: uniqueIndex('audio_profiles_scope_uidx').on(table.userId, sql`COALESCE(${table.bookId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
}))

export const audioJobs = pgTable('audio_jobs', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  mode: text('mode').$type<'manual' | 'automatic'>().notNull(),
  status: text('status').$type<'queued' | 'running' | 'pause_requested' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'uncertain'>().notNull().default('queued'),
  priority: integer('priority').notNull().default(0),
  requestedBy: text('requested_by').notNull().default('user'),
  settingsSnapshot: jsonSettings('settings_snapshot'),
  totalChapters: integer('total_chapters').notNull().default(0),
  completedChapters: integer('completed_chapters').notNull().default(0),
  totalParts: integer('total_parts').notNull().default(0),
  completedParts: integer('completed_parts').notNull().default(0),
  requestsReserved: integer('requests_reserved').notNull().default(0),
  requestsUsed: integer('requests_used').notNull().default(0),
  lastErrorCode: text('last_error_code'),
  lastErrorMessageSafe: text('last_error_message_safe'),
  idempotencyKey: text('idempotency_key').notNull(),
  workflowRunId: text('workflow_run_id'),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  updatedAt: updatedAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => ({
  ownerKey: unique('audio_jobs_id_user_id_key').on(table.id, table.userId),
  idempotency: unique('audio_jobs_user_id_idempotency_key_key').on(table.userId, table.idempotencyKey),
  activeBookJobUnique: uniqueIndex('audio_jobs_one_active_book_per_user_uidx')
    .on(table.userId, table.bookId)
    .where(sql`${table.status} IN ('queued', 'running', 'pause_requested')`),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  userStatusCreatedIdx: index('audio_jobs_user_status_created_idx').on(table.userId, table.status, table.createdAt.desc()),
}))

export const audioJobItems = pgTable('audio_job_items', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull(),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  sequence: integer('sequence').notNull(),
  status: text('status').$type<'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'skipped' | 'uncertain'>().notNull().default('queued'),
  completedParts: integer('completed_parts').notNull().default(0),
  totalParts: integer('total_parts').notNull().default(0),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  jobChapter: unique('audio_job_items_job_id_chapter_id_key').on(table.jobId, table.chapterId),
  jobSequence: unique('audio_job_items_job_id_sequence_key').on(table.jobId, table.sequence),
  jobUserFk: foreignKey({ columns: [table.jobId, table.userId], foreignColumns: [audioJobs.id, audioJobs.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
  jobStatusSequenceIdx: index('audio_job_items_job_status_sequence_idx').on(table.jobId, table.status, table.sequence),
}))

export const audioParts = pgTable('audio_parts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  partIndex: integer('part_index').notNull(),
  textSha256: text('text_sha256').notNull(),
  textStartAnchor: text('text_start_anchor'),
  textEndAnchor: text('text_end_anchor'),
  model: text('model').notNull(),
  voice: text('voice').notNull(),
  language: text('language').notNull(),
  styleHash: text('style_hash').notNull(),
  status: text('status').$type<'pending' | 'reserved' | 'generating' | 'completed' | 'failed' | 'uncertain'>().notNull().default('pending'),
  audioBlobPath: text('audio_blob_path'),
  audioSha256: text('audio_sha256'),
  mimeType: text('mime_type'),
  sampleRate: integer('sample_rate'),
  channels: integer('channels'),
  bitDepth: integer('bit_depth'),
  durationMs: bigint('duration_ms', { mode: 'bigint' }),
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  idempotency: unique('audio_parts_chapter_id_part_index_text_sha256_model_voice_style_hash_key').on(table.chapterId, table.partIndex, table.textSha256, table.model, table.voice, table.styleHash),
  ownerKey: unique('audio_parts_id_user_id_key').on(table.id, table.userId),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
  chapterStatusIdx: index('audio_parts_chapter_status_idx').on(table.chapterId, table.status),
}))

export const audioChapterAssets = pgTable('audio_chapter_assets', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull().unique(),
  blobPath: text('blob_path').notNull(),
  sha256: text('sha256').notNull(),
  mimeType: text('mime_type').notNull(),
  sampleRate: integer('sample_rate').notNull(),
  channels: integer('channels').notNull(),
  bitDepth: integer('bit_depth').notNull(),
  durationMs: bigint('duration_ms', { mode: 'bigint' }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
  status: text('status').$type<'pending' | 'ready' | 'failed'>().notNull().default('ready'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
}))

export const audioProgress = pgTable('audio_progress', {
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id'),
  positionMs: bigint('position_ms', { mode: 'bigint' }).notNull().default(0n),
  playbackRate: numeric('playback_rate', { precision: 3, scale: 2 }).notNull().default('1'),
  updatedAt: updatedAt(),
}, (table) => ({
  primary: primaryKey({ columns: [table.userId, table.bookId] }),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
}))

export const audioBookmarks = pgTable('audio_bookmarks', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  audioPartId: uuid('audio_part_id'),
  positionMs: bigint('position_ms', { mode: 'bigint' }).notNull(),
  label: text('label'),
  note: text('note'),
  createdAt: createdAt(),
}, (table) => ({
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  chapterOwnerFk: foreignKey({ columns: [table.chapterId, table.bookId, table.userId], foreignColumns: [bookChapters.id, bookChapters.bookId, bookChapters.userId] }).onDelete('cascade'),
  partOwnerFk: foreignKey({ columns: [table.audioPartId, table.userId], foreignColumns: [audioParts.id, audioParts.userId] }).onDelete('cascade'),
}))

export const dailyUsage = pgTable('daily_usage', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  usageDate: date('usage_date', { mode: 'string' }).notNull(),
  timezone: text('timezone').notNull().default('Africa/Algiers'),
  requestsReserved: integer('requests_reserved').notNull().default(0),
  requestsCommitted: integer('requests_committed').notNull().default(0),
  tokensReserved: bigint('tokens_reserved', { mode: 'bigint' }).notNull().default(0n),
  tokensCommitted: bigint('tokens_committed', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: updatedAt(),
}, (table) => ({
  scopeUnique: unique('daily_usage_user_id_model_usage_date_timezone_key').on(table.userId, table.model, table.usageDate, table.timezone),
  userDateIdx: index('daily_usage_user_date_idx').on(table.userId, table.usageDate),
}))

export const quotaReservations = pgTable('quota_reservations', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  usageDate: date('usage_date', { mode: 'string' }).notNull(),
  timezone: text('timezone').notNull().default('Africa/Algiers'),
  requestsReserved: integer('requests_reserved').notNull().default(0),
  requestsCommitted: integer('requests_committed').notNull().default(0),
  tokensReserved: bigint('tokens_reserved', { mode: 'bigint' }).notNull().default(0n),
  tokensCommitted: bigint('tokens_committed', { mode: 'bigint' }).notNull().default(0n),
  status: text('status').$type<'reserved' | 'committed' | 'released' | 'uncertain'>().notNull().default('reserved'),
  reason: text('reason').notNull(),
  audioJobId: uuid('audio_job_id'),
  audioPartId: uuid('audio_part_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  idempotency: unique('quota_reservations_user_id_idempotency_key_key').on(table.userId, table.idempotencyKey),
  jobOwnerFk: foreignKey({ columns: [table.audioJobId, table.userId], foreignColumns: [audioJobs.id, audioJobs.userId] }).onDelete('cascade'),
  partOwnerFk: foreignKey({ columns: [table.audioPartId, table.userId], foreignColumns: [audioParts.id, audioParts.userId] }).onDelete('cascade'),
  userStatusCreatedIdx: index('quota_reservations_user_status_created_idx').on(table.userId, table.status, table.createdAt),
}))

export const uploads = pgTable('uploads', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id'),
  replaceExisting: boolean('replace_existing').notNull().default(false),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
  sha256: text('sha256'),
  chunkCount: integer('chunk_count').notNull(),
  completedChunks: integer('completed_chunks').notNull().default(0),
  status: text('status').$type<'created' | 'uploading' | 'uploaded' | 'processing' | 'completed' | 'failed' | 'expired' | 'cancelled'>().notNull().default('created'),
  blobPath: text('blob_path'),
  rightsConfirmedAt: timestamp('rights_confirmed_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  ownerKey: unique('uploads_id_user_id_key').on(table.id, table.userId),
  idempotency: unique('uploads_user_id_idempotency_key_key').on(table.userId, table.idempotencyKey),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  userStatusExpiryIdx: index('uploads_user_status_expiry_idx').on(table.userId, table.status, table.expiresAt),
}))

export const uploadParts = pgTable('upload_parts', {
  id: id(),
  uploadId: uuid('upload_id').notNull(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  partIndex: integer('part_index').notNull(),
  blobPath: text('blob_path').notNull(),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: createdAt(),
}, (table) => ({
  uploadPart: unique('upload_parts_upload_id_part_index_key').on(table.uploadId, table.partIndex),
  uploadOwnerFk: foreignKey({ columns: [table.uploadId, table.userId], foreignColumns: [uploads.id, uploads.userId] }).onDelete('cascade'),
}))

export const importJobs = pgTable('import_jobs', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  uploadId: uuid('upload_id').notNull(),
  bookId: uuid('book_id'),
  status: text('status').$type<'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'>().notNull().default('queued'),
  stage: text('stage').notNull().default('queued'),
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  attemptCount: integer('attempt_count').notNull().default(0),
  idempotencyKey: text('idempotency_key').notNull(),
  workflowRunId: text('workflow_run_id'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessageSafe: text('last_error_message_safe'),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  updatedAt: updatedAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  ownerKey: unique('import_jobs_id_user_id_key').on(table.id, table.userId),
  idempotency: unique('import_jobs_user_id_idempotency_key_key').on(table.userId, table.idempotencyKey),
  uploadOwnerFk: foreignKey({ columns: [table.uploadId, table.userId], foreignColumns: [uploads.id, uploads.userId] }).onDelete('cascade'),
  bookUserFk: foreignKey({ columns: [table.bookId, table.userId], foreignColumns: [books.id, books.userId] }).onDelete('cascade'),
  userStatusCreatedIdx: index('import_jobs_user_status_created_idx').on(table.userId, table.status, table.createdAt.desc()),
}))

export const jobEvents = pgTable('job_events', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  audioJobId: uuid('audio_job_id'),
  importJobId: uuid('import_job_id'),
  eventType: text('event_type').notNull(),
  payload: jsonSettings('payload'),
  createdAt: createdAt(),
}, (table) => ({
  oneJob: check('job_events_one_job_check', sql`(${table.audioJobId} IS NOT NULL) <> (${table.importJobId} IS NOT NULL)`),
  audioJobOwnerFk: foreignKey({ columns: [table.audioJobId, table.userId], foreignColumns: [audioJobs.id, audioJobs.userId] }).onDelete('cascade'),
  importJobOwnerFk: foreignKey({ columns: [table.importJobId, table.userId], foreignColumns: [importJobs.id, importJobs.userId] }).onDelete('cascade'),
  audioJobCreatedIdx: index('job_events_audio_job_created_idx').on(table.audioJobId, table.createdAt.desc()),
  importJobCreatedIdx: index('job_events_import_job_created_idx').on(table.importJobId, table.createdAt.desc()),
}))

export type AppUser = typeof appUsers.$inferSelect
export type Book = typeof books.$inferSelect
export type NewBook = typeof books.$inferInsert
export type BookChapter = typeof bookChapters.$inferSelect
