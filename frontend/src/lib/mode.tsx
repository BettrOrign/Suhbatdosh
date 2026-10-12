import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/i18n/i18n'
import type { ProcessingMode, Settings } from '@/lib/types'

/**
 * The single seam for processing mode (docs/CONTRACT.md).
 *
 * This used to persist to `localStorage` and lie to the user. Now it reads
 * `GET /api/settings` and writes `PATCH /api/settings`, optimistically with a
 * revert on failure. The top-bar badge and the Settings switcher both consume
 * this context, so they can never disagree.
 *
 * Non-admins can READ the mode (the API allows any authenticated user) but the
 * setter refuses for them: the backend returns 403 and we do not want the UI
 * to pretend a change landed.
 */

export type Mode = ProcessingMode

export interface ModeState {
  settings: Settings | null
  loading: boolean
  saving: boolean
  error: string | null
  /** True once GET /api/settings has resolved at least once. */
  loaded: boolean
  canEdit: boolean
  mode: Mode
  setMode: (next: Mode) => Promise<void>
  refresh: () => Promise<void>
  /** Local STT is missing/unusable while the mode is `private`. */
  sttUnavailable: boolean
  /** One-click escape hatch offered next to the warning. */
  fallBackToOnline: () => Promise<void>
}

const ModeContext = createContext<ModeState | null>(null)

export function ModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const canEdit = user?.role === 'admin'

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getSettings())
    } catch {
      // A missing /api/settings is not a reason to break the shell. Stay on
      // `online`, which is the backend default, and let Settings explain.
      setSettings(null)
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setSettings(null)
      setLoaded(false)
      setLoading(false)
      return
    }
    setLoading(true)
    void refresh()
  }, [user, refresh])

  const setMode = useCallback(
    async (next: Mode) => {
      if (!canEdit) return
      const previous = settings
      // Optimistic: the switcher animates immediately, and reverts if the
      // server disagrees (403 for non-admins, or the mode is unsupported).
      setSettings((s) => (s ? { ...s, mode: next } : s))
      setSaving(true)
      try {
        setSettings(await api.updateSettings({ mode: next }))
        toast.success(
          t(next === 'private' ? 'settings.mode.switched_private' : 'settings.mode.switched_online'),
        )
      } catch (e) {
        setSettings(previous)
        toast.error(t('settings.mode.switch_failed', { error: (e as Error).message }))
      } finally {
        setSaving(false)
      }
    },
    [canEdit, settings, t],
  )

  const fallBackToOnline = useCallback(async () => {
    if (!canEdit) return
    await setMode('online')
  }, [canEdit, setMode])

  const mode = settings?.mode ?? 'online'

  const value = useMemo<ModeState>(() => {
    return {
      settings,
      loading,
      saving,
      error: null,
      loaded,
      canEdit,
      mode,
      setMode,
      refresh,
      sttUnavailable: mode === 'private' && settings?.stt?.available === false,
      fallBackToOnline,
    }
  }, [settings, loading, saving, loaded, canEdit, mode, setMode, refresh, fallBackToOnline])

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useMode(): ModeState {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used within ModeProvider')
  return ctx
}
