import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { translations, type Lang } from './translations'

const LANG_KEY = 'suhbatdosh_lang'

interface I18nContext {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Record<string, unknown>) => string
}

const I18nContext = createContext<I18nContext | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang) || 'en',
  )

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
  }, [lang])

  const t = (
    key: string,
    vars?: Record<string, unknown>,
  ): string => {
    const dict = translations[lang] || translations.en
    let value = dict[key] ?? translations.en[key] ?? key
    if (vars) {
      for (const k of Object.keys(vars)) {
        value = value.replaceAll('{' + k + '}', String(vars[k]))
      }
    }
    return value
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
