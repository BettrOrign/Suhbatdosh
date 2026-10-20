import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  /**
   * False until GET /api/settings has succeeded at least once, and false again
   * if a later refresh fails. `mode` falls back to `online` in that case, so
   * UI must not present it as fact — this is what says "we don't know yet".
   */
  modeKnown: boolean
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
  /**
   * Guards `setMode` itself, not just the button. `saving` state lands a render
   * too late for two rapid clicks: both PATCHes went out, and whichever
   * response arrived last wrote its mode into the context — leaving the badge,
   * the switcher and the server disagreeing.
   */
  const savingRef = useRef(false)

  const canEdit = user?.role === 'admin'

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getSettings())
    } catch {
      // Keep the last known settings. Blanking them made `mode` fall back to
      // 'online', so a 500 or a dropped connection flipped the sidebar badge to
      // "online" and hid the local-STT warning — the UI asserting the opposite
      // of what the server actually does, on the one setting that describes
      // where audio goes. Only the very first load (no prior value) falls back.
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
      if (!canEdit || savingRef.current) return
      if (settings?.mode === next) return
      savingRef.current = true
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
        savingRef.current = false
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
  const modeKnown = settings !== null

  const value = useMemo<ModeState>(() => {
    return {
      settings,
      loading,
      saving,
      error: null,
      loaded,
      canEdit,
      mode,
      modeKnown,
      setMode,
      refresh,
      sttUnavailable: modeKnown && mode === 'private' && settings?.stt?.available === false,
      fallBackToOnline,
    }
  }, [settings, loading, saving, loaded, canEdit, mode, modeKnown, setMode, refresh, fallBackToOnline])

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useMode(): ModeState {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used within ModeProvider')
  return ctx
}
