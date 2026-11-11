import { getCurrentOwner } from '@/lib/auth/owner'
import { getLibraryStatus } from '@/lib/db/repositories/library'
import ManualStudio from './manual-studio'

export const dynamic = 'force-dynamic'

export default async function ManualStudioPage() {
  const owner = await getCurrentOwner()
  const initialStatus = owner
    ? await getLibraryStatus(owner.id)
    : { configured: false, book: null }

  return <ManualStudio initialStatus={initialStatus} />
}
