import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { useI18n } from '@/i18n/i18n'

/**
 * The 403 card every admin-only page renders in place of its content.
 * Frontend guards are cosmetic — the backend enforces access — so this is
 * presentation only, not security.
 */
export function PeopleDenied({
  titleKey = 'users.no_access',
  descriptionKey = 'users.no_access_desc',
}: {
  titleKey?: string
  descriptionKey?: string
}) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-md pt-12">
      <EmptyState
        icon={ShieldAlert}
        title={t(titleKey)}
        description={t(descriptionKey)}
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/">{t('common.back_home')}</Link>
          </Button>
        }
      />
    </div>
  )
}
