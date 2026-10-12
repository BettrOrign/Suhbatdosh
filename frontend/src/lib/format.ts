import type { CallStatus } from '@/lib/types'
import type { Lang } from '@/i18n/translations'

/* ---------------------------------------------------------------------------
 * SCORE RUBRIC BANDS — the single source of truth.
 *
 * The backend treats `overall < 50` as a "problem call" (db.py) and the
 * `>= 70` / `>= 40` bands were previously hardcoded in six files. Anything
 * that colours, labels, or ranks a score must go through here.
 * ------------------------------------------------------------------------- */
export const SCORE_GOOD_MIN = 70
export const SCORE_WARN_MIN = 40
export const PROBLEM_CALL_MAX = 50

export type ScoreBand = 'good' | 'warn' | 'bad' | 'none'

export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score == null) return 'none'
  if (score >= SCORE_GOOD_MIN) return 'good'
  if (score >= SCORE_WARN_MIN) return 'warn'
  return 'bad'
}

/** Tailwind text colour for a score, light + dark. */
export function scoreColor(score: number | null | undefined): string {
  switch (scoreBand(score)) {
    case 'good':
      return 'text-success'
    case 'warn':
      return 'text-warning'
    case 'bad':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

/** Tailwind classes for a score pill: soft background + matching text. */
export function scorePill(score: number | null | undefined): string {
  switch (scoreBand(score)) {
    case 'good':
      return 'bg-success-soft text-success-soft-foreground'
    case 'warn':
      return 'bg-warning-soft text-warning-soft-foreground'
    case 'bad':
      return 'bg-destructive-soft text-destructive-soft-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/** Raw CSS custom property value, for SVG strokes and recharts cells. */
export function scoreColorVar(score: number | null | undefined): string {
  switch (scoreBand(score)) {
    case 'good':
      return 'var(--color-score-good)'
    case 'warn':
      return 'var(--color-score-warn)'
    case 'bad':
      return 'var(--color-score-bad)'
    default:
      return 'var(--color-muted-foreground)'
  }
}

/** CSS custom property for the matching translucent track colour. */
export function scoreBgVar(score: number | null | undefined): string {
  switch (scoreBand(score)) {
    case 'good':
      return 'var(--color-score-good-bg)'
    case 'warn':
      return 'var(--color-score-warn-bg)'
    case 'bad':
      return 'var(--color-score-bad-bg)'
    default:
      return 'var(--color-muted)'
  }
}

/**
 * Human label for a score band. Was hardcoded Uzbek in every language mode
 * (`AGENTS.md` flags this) — now parameterised by the active UI language.
 * This is UI chrome, not model output, so translating it is correct.
 */
export function scoreLabel(score: number | null | undefined, lang: Lang): string {
  const band = scoreBand(score)
  if (lang === 'uz') {
    switch (band) {
      case 'good':
        return 'Kuchli'
      case 'warn':
        return 'Yaxshilash kerak'
      case 'bad':
        return 'Zaif'
      default:
        return 'Baholanmagan'
    }
  }
  switch (band) {
    case 'good':
      return 'Strong'
    case 'warn':
      return 'Needs work'
    case 'bad':
      return 'Weak'
    default:
      return 'Not scored'
  }
}

/* ---------------------------------------------------------------------------
 * FORMATTING
 * ------------------------------------------------------------------------- */

export function statusVariant(status: CallStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'done') return 'default'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

const IN_FLIGHT: CallStatus[] = ['uploaded', 'queued', 'transcribing', 'transcribed', 'analyzing']

export function isInFlight(status: CallStatus): boolean {
  return IN_FLIGHT.includes(status)
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const minutes = Math.floor((now.getTime() - d.getTime()) / 60000)

    if (minutes < 1) return rtf.format(0, 'second')
    if (minutes < 60) return rtf.format(-minutes, 'minute')
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return rtf.format(-hours, 'hour')
    const days = Math.floor(hours / 24)
    if (days < 7) return rtf.format(-days, 'day')
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null) return '—'
  return `${Math.round(ratio * 100)}%`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Mean of a set of nullable scores, rounded. `null` when there are none. */
export function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (!nums.length) return null
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

/** Case/accent-insensitive substring match that tolerates null haystacks. */
export function matches(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true
  if (!haystack) return false
  return haystack.toLowerCase().includes(needle)
}
