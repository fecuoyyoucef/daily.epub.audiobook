import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
const previewHost = process.env.NEON_PREVIEW_DATABASE_HOST ?? 'ep-steep-truth-bcm0xwwl.c-16.us-east-1.aws.neon.tech'
const source = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (process.env.VERCEL_ENV === 'production') {
  throw new Error('The schema integration test refuses to run against a production deployment.')
}

if (!source) {
  throw new Error('A Neon database connection must be available in the project environment.')
}

const connection = new URL(source)
connection.hostname = previewHost
connection.searchParams.set('sslmode', 'verify-full')

const pool = new Pool({
  connectionString: connection.toString(),
  max: 1,
  connectionTimeoutMillis: 5_000,
})

let client
let transactionOpen = false

try {
  client = await pool.connect()
  await client.query('BEGIN')
  transactionOpen = true

  const ownerResult = await client.query(
    'INSERT INTO app_users (username) VALUES ($1) RETURNING id',
    [`schema-test-${randomUUID()}`],
  )
  const userId = ownerResult.rows[0].id
  const bookResult = await client.query(
    'INSERT INTO books (user_id, title) VALUES ($1, $2) RETURNING id',
    [userId, 'Schema integration test'],
  )
  const bookId = bookResult.rows[0].id
  const chapterResult = await client.query(
    'INSERT INTO book_chapters (user_id, book_id, spine_index, chapter_number, title) VALUES ($1, $2, 0, 1, $3) RETURNING id',
    [userId, bookId, 'Chapter'],
  )
  const chapterId = chapterResult.rows[0].id
  const progressResult = await client.query(
    'INSERT INTO reader_progress (user_id, book_id, chapter_id, progress_percent) VALUES ($1, $2, $3, 37.5) RETURNING progress_percent',
    [userId, bookId, chapterId],
  )

  const jobResult = await client.query(
    'INSERT INTO audio_jobs (user_id, book_id, mode, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, bookId, 'manual', randomUUID()],
  )
  const idempotencyKey = randomUUID()
  const reservationValues = [userId, 'test-model', 'schema-test', jobResult.rows[0].id, idempotencyKey]
  await client.query(
    'INSERT INTO quota_reservations (user_id, model, usage_date, reason, audio_job_id, idempotency_key, requests_reserved) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1)',
    reservationValues,
  )

  await client.query('SAVEPOINT uniqueness_check')
  let idempotencyConstraintWorks = false
  try {
    await client.query(
      'INSERT INTO quota_reservations (user_id, model, usage_date, reason, audio_job_id, idempotency_key, requests_reserved) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1)',
      reservationValues,
    )
  } catch (error) {
    if (error.code !== '23505') throw error
    idempotencyConstraintWorks = true
    await client.query('ROLLBACK TO SAVEPOINT uniqueness_check')
  }

  if (!idempotencyConstraintWorks) {
    throw new Error('The quota reservation idempotency constraint did not reject a duplicate.')
  }

  const scopedResult = await client.query(
    'SELECT id FROM books WHERE id = $1 AND user_id = $2',
    [bookId, randomUUID()],
  )
  if (scopedResult.rowCount !== 0) {
    throw new Error('A user-scoped book lookup returned another user’s row.')
  }

  const databaseResult = await client.query('SELECT current_database() AS name')
  await client.query('ROLLBACK')
  transactionOpen = false

  console.log(JSON.stringify({
    database: databaseResult.rows[0].name,
    chapterAndProgressRoundTrip: progressResult.rows[0].progress_percent === '37.50',
    quotaIdempotencyConstraint: idempotencyConstraintWorks,
    userScopedLookup: scopedResult.rowCount === 0,
    rolledBack: true,
  }))
} catch (error) {
  if (transactionOpen && client) {
    await client.query('ROLLBACK').catch(() => {})
  }
  console.error(JSON.stringify({ test: 'db-schema', status: 'failed', code: error.code ?? 'unknown' }))
  process.exitCode = 1
} finally {
  client?.release()
  await pool.end()
}
