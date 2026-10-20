import { PerformanceDirectory, type PerformanceConfig } from '@/components/people/PerformanceDirectory'

/**
 * Employees ("xodimlar") directory. Previously a near-verbatim copy of
 * ManagersList that cast `User[]` to `Manager[]`, so every `total_calls` and
 * `avg_score` on this page was NaN/undefined. The shared component merges
 * `/api/stats/manager-rankings` onto the real user rows instead.
 */
const CONFIG: PerformanceConfig = {
  role: 'yonalish',
  titleKey: 'directions.title',
  descriptionKey: 'directions.desc',
  failureKey: 'managers.load_failed',
  browseLabelKey: 'directions.show_problems',
  browseDialogTitleKey: 'directions.recent_problems',
  // The dialog lists every manager call for the person, so the count is calls.
  browseDialogCountKey: 'directions.total_calls',
  browseEmptyKey: 'directions.no_problems',
  primaryStatLabelKey: 'directions.total_solved',
  // ...and that label must actually describe solved problems, not the call
  // count it used to sit next to.
  primaryStatKey: 'solved_problems',
  browseFilter: 'problems',
  chartLabelKeys: {
    volume: 'directions.most_solved',
    score: 'directions.most_successful',
    share: 'directions.most_effective',
  },
}

export function ManagersDirectionsPage() {
  return <PerformanceDirectory config={CONFIG} />
}

export default ManagersDirectionsPage
