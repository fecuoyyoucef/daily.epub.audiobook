import { getCurrentOwner } from '@/lib/auth/owner'
import { getLibraryStatus } from '@/lib/db/repositories/library'
import { ListenLibrary } from '@/components/listen-library'

export const dynamic = 'force-dynamic'

export default async function ListenPage() {
  const owner = await getCurrentOwner()
  const initialStatus = owner ? await getLibraryStatus(owner.id) : { book: null }

  return <ListenLibrary initialStatus={initialStatus} />
}
