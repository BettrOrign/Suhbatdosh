import { PerformanceDirectory, type PerformanceConfig } from '@/components/people/PerformanceDirectory'

/**
 * Managers overview. All the UI lives in `PerformanceDirectory`; this file is
 * only the configuration that distinguishes it from the Directions variant.
 */
const CONFIG: PerformanceConfig = {
  role: 'manager',
  titleKey: 'managers.title',
  descriptionKey: 'managers.manager_desc',
  failureKey: 'managers.load_failed',
  browseLabelKey: 'managers.show_calls',
  browseDialogTitleKey: 'managers.recent_for',
  browseDialogCountKey: 'managers.calls_label',
  browseEmptyKey: 'managers.no_calls',
  primaryStatLabelKey: 'managers.calls_label',
  chartLabelKeys: {
    volume: 'managers.most_calls',
    score: 'managers.most_successful',
    share: 'managers.most_effective',
  },
}

export function ManagersPage() {
  return <PerformanceDirectory config={CONFIG} />
}

export default ManagersPage
