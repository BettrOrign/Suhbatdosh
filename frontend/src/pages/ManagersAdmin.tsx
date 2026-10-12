import { PeoplePage, type PeoplePageConfig } from '@/components/people/PeoplePage'
import { PeopleDenied } from '@/components/people/PeopleDenied'
import { useAuth } from '@/lib/auth'

/**
 * System administrators.
 *
 * This page was a copy-paste of `Clients.tsx`: it typed people as `Client[]`
 * and called `api.createClient` / `api.updateClient` when creating an *admin*
 * account (while `deleteUser` was used for deletion), had no role guard, and
 * its search filter had an operator-precedence bug that threw on a null
 * `company`.
 *
 * It now delegates to the shared `PeoplePage`, which lists real users, uses
 * `createUser` / `updateUser` / `deleteUser`, has a working search, and has an
 * admin guard.
 */
const CONFIG: PeoplePageConfig = {
  titleKey: 'managers.admin_section',
  descriptionKey: 'managers.all_desc',
  roles: ['admin'],
  lockRoleTo: 'admin',
  emptyTitleKey: 'managers.no_managers',
  emptyDescriptionKey: 'managers.no_managers_desc',
  addLabelKey: 'managers.add',
  addFirstLabelKey: 'managers.add_first',
  failureKey: 'managers.load_failed',
}

export function ManagersAdminPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') {
    return <PeopleDenied descriptionKey="managers.no_access_desc" />
  }
  return <PeoplePage config={CONFIG} currentUserId={user.id} />
}

export default ManagersAdminPage
