'use client'

import { useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export type LibraryChapter = {
  number: number
  title: string
  status: string
  partsCompleted: number
  partsTotal: number
  partsFailed: number
  partsUncertain: number
  retryableParts: number
  audioUrl: string | null
  error: string | null
}

export type LibraryBook = {
  id: string
  title: string
  filename: string
  enabled: boolean
  status: string
  total: number
  completed: number
  progress: number
  settings: {
    startChapter: number
    endChapter: number
    dailyTarget: number
  }
  selectedTotal: number
  selectedCompleted: number
  retryableParts: number
  dailyUsage: {
    date: string
    requestsUsed: number
    chaptersCompleted: number
  }
  lastRun: {
    date: string
    status: string
    requestsUsed: number
    chaptersCompleted: number
    message: string | null
    finishedAt: string | null
  } | null
  activeJob: {
    id: string
    status: string
    totalChapters: number
    completedChapters: number
    totalParts: number
    completedParts: number
    requestsUsed: number
    requestsReserved: number
  } | null
  next: {
    number: number
    title: string
    partsCompleted: number
    partsTotal: number
  } | null
  chapters: LibraryChapter[]
}

export type LibraryStatus = {
  book: LibraryBook | null
}

export function useLibraryStatus(initialStatus: LibraryStatus) {
  const router = useRouter()
  const hasActiveJob = Boolean(initialStatus.book?.activeJob)
  const refresh = useCallback(() => router.refresh(), [router])

  useEffect(() => {
    const timer = window.setInterval(refresh, hasActiveJob ? 5_000 : 25_000)
    return () => window.clearInterval(timer)
  }, [hasActiveJob, refresh])

  return { status: initialStatus, refresh }
}
