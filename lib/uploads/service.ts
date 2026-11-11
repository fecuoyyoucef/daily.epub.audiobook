import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { and, count, eq, gt, isNull, lt } from 'drizzle-orm'
import { start } from 'workflow/api'
import { db } from '@/lib/db'
import {
  books,
  importJobs,
  uploadParts,
  uploads,
} from '@/lib/db/schema'
import { putPrivate, readPrivate } from '@/lib/store'
import { importEpubWorkflow } from '@/lib/workflows/import-epub'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const CHUNK_BYTES = 2 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class UploadServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'UploadServiceError'
  }
}

function safeFilename(input: string): string {
  const leaf = input.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180)
  return cleaned || 'book.epub'
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function createUploadForOwner(
  userId: string,
  input: {
    fileName: string
    fileSize: number
    totalParts: number
    rightsConfirmation: boolean
    replace: boolean
    idempotencyKey?: string
  },
) {
  const fileName = safeFilename(input.fileName)
  const idempotencyKey = input.idempotencyKey ?? randomUUID()
  const expectedParts = Math.ceil(input.fileSize / CHUNK_BYTES)

  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new UploadServiceError('معرّف الرفع غير صالح.', 400)
  }
  if (!input.rightsConfirmation) {
    throw new UploadServiceError('يلزم تأكيد امتلاك حق الاستخدام أو الإذن بتحويل الكتاب.', 400)
  }
  if (!fileName.toLowerCase().endsWith('.epub')) {
    throw new UploadServiceError('يجب أن يكون الملف بصيغة EPUB.', 400)
  }
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_FILE_BYTES) {
    throw new UploadServiceError('حجم EPUB يجب ألا يتجاوز 15 MB.', 413)
  }
  if (!Number.isInteger(input.totalParts) || input.totalParts !== expectedParts || expectedParts > 8) {
    throw new UploadServiceError('عدد أجزاء الرفع لا يتطابق مع حجم الملف.', 400)
  }

  const [existingUpload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.userId, userId), eq(uploads.idempotencyKey, idempotencyKey)))
    .limit(1)
  if (existingUpload) return existingUpload

  const [activeBook] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.userId, userId), isNull(books.deletedAt), isNull(books.archivedAt)))
    .limit(1)
  if (activeBook && !input.replace) {
    throw new UploadServiceError('يوجد كتاب في المكتبة. اختر استبدال الكتاب الحالي لبدء مكتبة جديدة.', 409)
  }

  const [upload] = await db
    .insert(uploads)
    .values({
      userId,
      originalFilename: fileName,
      contentType: 'application/epub+zip',
      sizeBytes: BigInt(input.fileSize),
      chunkCount: input.totalParts,
      status: 'uploading',
      rightsConfirmedAt: new Date(),
      replaceExisting: input.replace,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning()

  return upload
}

export async function saveUploadChunk(
  userId: string,
  uploadId: string,
  index: number,
  total: number,
  bytes: Buffer,
) {
  if (!UUID_PATTERN.test(uploadId)) throw new UploadServiceError('معرّف الرفع غير صالح.', 400)
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 8 || index < 0 || index >= total) {
    throw new UploadServiceError('بيانات أجزاء الرفع غير صالحة.', 400)
  }
  if (bytes.length <= 0 || bytes.length > CHUNK_BYTES) {
    throw new UploadServiceError('حجم الجزء يتجاوز 2 MB أو أنه فارغ.', 413)
  }

  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(
      eq(uploads.id, uploadId),
      eq(uploads.userId, userId),
      eq(uploads.status, 'uploading'),
      gt(uploads.expiresAt, new Date()),
    ))
    .limit(1)
  if (!upload) throw new UploadServiceError('جلسة الرفع غير موجودة أو انتهت صلاحيتها.', 404)
  if (upload.chunkCount !== total) throw new UploadServiceError('عدد أجزاء الرفع غير مطابق للجلسة.', 400)

  const expectedSize = index === total - 1
    ? Number(upload.sizeBytes) - CHUNK_BYTES * index
    : CHUNK_BYTES
  if (bytes.length !== expectedSize) throw new UploadServiceError('حجم الجزء غير مطابق للجزء المتوقع.', 400)

  const blobPath = `uploads/${userId}/${uploadId}/part-${String(index).padStart(2, '0')}.bin`
  await putPrivate(blobPath, bytes, 'application/octet-stream')

  await db.transaction(async (transaction) => {
    await transaction
      .insert(uploadParts)
      .values({
        uploadId,
        userId,
        partIndex: index,
        blobPath,
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
      })
      .onConflictDoUpdate({
        target: [uploadParts.uploadId, uploadParts.partIndex],
        set: { blobPath, sha256: sha256(bytes), sizeBytes: bytes.length },
      })

    const [partCount] = await transaction
      .select({ value: count() })
      .from(uploadParts)
      .where(and(eq(uploadParts.uploadId, uploadId), eq(uploadParts.userId, userId)))

    await transaction
      .update(uploads)
      .set({ completedChunks: partCount.value, updatedAt: new Date() })
      .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId)))
  })

  return { ok: true, index, total }
}

async function getOrCreateImportJob(userId: string, uploadId: string, digest: string) {
  return db.transaction(async (transaction) => {
    const [upload] = await transaction
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId)))
      .for('update')
      .limit(1)

    if (!upload) throw new UploadServiceError('جلسة الرفع غير موجودة.', 404)

    const [existingJob] = await transaction
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), eq(importJobs.uploadId, uploadId)))
      .limit(1)
    if (existingJob?.bookId) {
      return { job: existingJob, bookId: existingJob.bookId, upload }
    }

    if (upload.status !== 'uploading' || upload.completedChunks !== upload.chunkCount) {
      throw new UploadServiceError('لم تكتمل جميع أجزاء الرفع.', 409)
    }

    const [book] = await transaction
      .insert(books)
      .values({
        userId,
        title: upload.originalFilename.replace(/\.epub$/i, '') || 'كتاب EPUB',
        language: 'und',
        epubBlobPath: `books/${userId}/${uploadId}/source.epub`,
        epubSha256: digest,
        status: 'parsing',
      })
      .returning({ id: books.id })

    const [job] = await transaction
      .insert(importJobs)
      .values({
        userId,
        uploadId,
        bookId: book.id,
        status: 'queued',
        stage: 'queued',
        idempotencyKey: uploadId,
      })
      .returning()

    await transaction
      .update(books)
      .set({ importJobId: job.id, updatedAt: new Date() })
      .where(and(eq(books.id, book.id), eq(books.userId, userId)))

    const [updatedUpload] = await transaction
      .update(uploads)
      .set({
        bookId: book.id,
        sha256: digest,
        blobPath: `books/${userId}/${uploadId}/source.epub`,
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId)))
      .returning()

    return { job, bookId: book.id, upload: updatedUpload }
  })
}

export async function startImportRun(userId: string, jobId: string): Promise<string | null> {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    .limit(1)
  if (!job) throw new UploadServiceError('مهمة الاستيراد غير موجودة.', 404)
  if (job.workflowRunId && job.workflowRunId !== 'starting') return job.workflowRunId
  if (job.workflowRunId === 'starting' && Date.now() - job.updatedAt.getTime() < 120_000) return null

  const staleBefore = new Date(Date.now() - 120_000)
  const [claimed] = await db
  .update(importJobs)
  .set({ workflowRunId: 'starting', updatedAt: new Date() })
  .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId), isNull(importJobs.workflowRunId)))
  .returning({ id: importJobs.id })
  const [reclaimed] = claimed ? [] : await db
  .update(importJobs)
  .set({ workflowRunId: 'starting', updatedAt: new Date() })
  .where(and(
    eq(importJobs.id, jobId),
    eq(importJobs.userId, userId),
    eq(importJobs.workflowRunId, 'starting'),
    lt(importJobs.updatedAt, staleBefore),
  ))
  .returning({ id: importJobs.id })
  if (!claimed && !reclaimed) return null

  try {
    const run = await start(importEpubWorkflow, [jobId, userId])
    await db
      .update(importJobs)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    return run.runId
  } catch (error) {
    await db
      .update(importJobs)
      .set({ workflowRunId: null, updatedAt: new Date() })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId), eq(importJobs.workflowRunId, 'starting')))
    throw error
  }
}

export async function finalizeUpload(userId: string, uploadId: string) {
  if (!UUID_PATTERN.test(uploadId)) throw new UploadServiceError('معرّف الرفع غير صالح.', 400)

  const [upload] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId)))
    .limit(1)
  if (!upload) throw new UploadServiceError('جلسة الرفع غير موجودة.', 404)
  if (upload.status === 'failed' || upload.status === 'cancelled' || upload.status === 'expired') {
    throw new UploadServiceError('لا يمكن إكمال جلسة الرفع هذه.', 409)
  }

  const parts = await db
    .select()
    .from(uploadParts)
    .where(and(eq(uploadParts.uploadId, uploadId), eq(uploadParts.userId, userId)))
    .orderBy(uploadParts.partIndex)

  if (parts.length !== upload.chunkCount) throw new UploadServiceError('أعد رفع الأجزاء المفقودة ثم حاول مجدداً.', 409)

  const buffers: Buffer[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.partIndex !== index) throw new UploadServiceError('يوجد جزء مفقود في الملف المرفوع.', 409)
    const bytes = await readPrivate(part.blobPath)
    if (!bytes || bytes.length !== part.sizeBytes || sha256(bytes) !== part.sha256) {
      throw new UploadServiceError('تعذّر التحقق من أحد أجزاء الملف. أعد رفعه.', 400)
    }
    buffers.push(bytes)
  }

  const epub = Buffer.concat(buffers)
  if (epub.length !== Number(upload.sizeBytes)) throw new UploadServiceError('حجم الملف المجمع غير مطابق.', 400)
  const digest = sha256(epub)
  const { job, bookId } = await getOrCreateImportJob(userId, uploadId, digest)
  const sourcePath = `books/${userId}/${uploadId}/source.epub`
  await putPrivate(sourcePath, epub, 'application/epub+zip')

  await db
    .update(uploads)
    .set({ status: 'uploaded', updatedAt: new Date() })
    .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId), eq(uploads.status, 'processing')))

  const workflowRunId = await startImportRun(userId, job.id)
  return { ok: true, jobId: job.id, bookId, workflowRunId, status: 'queued' as const }
}
