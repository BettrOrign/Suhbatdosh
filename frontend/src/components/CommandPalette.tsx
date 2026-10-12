import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n/i18n'
import { useAuth } from '@/lib/auth'
import { SPRING } from '@/lib/motion'
import { visibleNav } from './nav-items'
import { cn } from '@/lib/utils'

/** Fired by the top-bar trigger so it can open the palette without a fake
 *  KeyboardEvent. */
export const OPEN_EVENT = 'command:open'

/**
 * ⌘K / Ctrl+K command palette.
 *
 * A keyboard-first way to move around a 9-page dashboard without a mouse.
 * Built on the existing Dialog primitive rather than pulling in cmdk — the
 * surface we need is ~100 lines and the bundle already has framer-motion.
 */
export function CommandPalette() {
  const { t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () => visibleNav(user?.role).map((n) => ({ ...n, label: t(n.labelKey) })),
    [user?.role, t]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.keywords?.toLowerCase().includes(q) ||
        i.to.toLowerCase().includes(q)
    )
  }, [items, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [active, open])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[active]
      if (target) go(target.to)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('command.title')}</DialogTitle>
          <DialogDescription>{t('command.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border-subtle px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('command.placeholder')}
            aria-label={t('command.placeholder')}
            aria-controls="command-results"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="hidden shrink-0 rounded-sm border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label={t('command.title')}
          className="max-h-[min(320px,50vh)] overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {t('command.no_results')}
            </p>
          ) : (
            results.map((item, i) => (
              <motion.div
                key={item.to}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                animate={reduced ? undefined : { opacity: 1, y: 0 }}
                initial={reduced ? undefined : { opacity: 0, y: -2 }}
                transition={SPRING.snappy}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item.to)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors duration-100',
                    i === active
                      ? 'bg-surface-hover text-foreground'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                  )}
                >
                  <item.icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {i === active && (
                    <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </motion.div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
