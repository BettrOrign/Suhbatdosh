import { PeoplePage, type PeoplePageConfig } from '@/components/people/PeoplePage'
import { PeopleDenied } from '@/components/people/PeopleDenied'
import { useAuth } from '@/lib/auth'

const CONFIG: PeoplePageConfig = {
  titleKey: 'users.title',
  descriptionKey: 'users.desc',
  /** Every role, including `yonalish`, which the old `ROLES` list omitted —
   *  meaning you literally could not assign it from the UI. */
  roles: ['admin', 'manager', 'yonalish', 'receptionist'],
  emptyTitleKey: 'users.no_team',
  emptyDescriptionKey: 'users.no_team_desc',
  addLabelKey: 'users.add',
  addFirstLabelKey: 'users.add_first',
  failureKey: 'users.load_failed',
}

export function UsersPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <PeopleDenied />
  return <PeoplePage config={CONFIG} currentUserId={user?.id} />
}

export default UsersPage
