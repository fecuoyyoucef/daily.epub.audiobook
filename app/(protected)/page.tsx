import { LibraryDashboard } from '@/components/library-dashboard'
import { getCurrentOwner } from '@/lib/auth/owner'
import { getLibraryStatus } from '@/lib/db/repositories/library'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const owner = await getCurrentOwner()
  const initialStatus = owner ? await getLibraryStatus(owner.id) : { book: null }

  return <LibraryDashboard initialStatus={initialStatus} />
}
