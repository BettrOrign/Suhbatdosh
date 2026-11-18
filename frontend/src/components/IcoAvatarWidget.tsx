import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, Send, Sparkles, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type AvatarState = 'offline' | 'connecting' | 'listening' | 'speaking' | 'error'

interface ChatLine {
  id: number
  role: 'user' | 'agent' | 'system'
  text: string
}

const LANG_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'uz', label: 'UZ' },
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
] as const

function buildWsUrl(lang: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/ico?lang=${encodeURIComponent(lang)}`
}

export function IcoAvatarWidget() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AvatarState>('offline')
  const [muted, setMuted] = useState(false)
  const [lang, setLang] = useState<string>('auto')
  const [avatarName, setAvatarName] = useState('Laylo')
  const [avatarRole, setAvatarRole] = useState('AI Operator')
  const [inputText, setInputText] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatLine[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const micCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const playCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const nextPlayTimeRef = useRef(0)
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const mutedRef = useRef(false)
  const stateRef = useRef<AvatarState>('offline')
  const mouthRef = useRef<SVGRectElement | null>(null)
  const haloRef = useRef<HTMLSpanElement | null>(null)
  const animIdRef = useRef<number | null>(null)
  const lineIdRef = useRef(1)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  mutedRef.current = muted
  stateRef.current = state

  useEffect(() => {
    fetch('/api/ico/settings', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (d.avatar_name) setAvatarName(d.avatar_name)
        if (d.avatar_role) setAvatarRole(d.avatar_role)
        if (d.lang) setLang(d.lang)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const appendTurn = useCallback((role: ChatLine['role'], text: string) => {
    const clean = text.trim()
    if (!clean) return
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.role === role && role !== 'system') {
        const sep = !last.text || /\s$/.test(last.text) || /^[.,!?:;]/.test(clean) ? '' : ' '
        return [...prev.slice(0, -1), { ...last, text: last.text + sep + clean }]
      }
      return [...prev.slice(-40), { id: lineIdRef.current++, role, text: clean }]
    })
  }, [])

  const stopPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current.clear()
    if (playCtxRef.current) {
      nextPlayTimeRef.current = playCtxRef.current.currentTime
    } else {
      nextPlayTimeRef.current = 0
    }
  }, [])

  const stopSession = useCallback(() => {
    if (animIdRef.current !== null) {
      cancelAnimationFrame(animIdRef.current)
      animIdRef.current = null
    }
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        // ignore
      }
      wsRef.current = null
    }
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) track.stop()
      micStreamRef.current = null
    }
    if (micCtxRef.current) {
      micCtxRef.current.close().catch(() => {})
      micCtxRef.current = null
    }
    stopPlayback()
    if (playCtxRef.current) {
      playCtxRef.current.close().catch(() => {})
      playCtxRef.current = null
    }
    analyserRef.current = null
    if (mouthRef.current) {
      mouthRef.current.setAttribute('height', '3.5')
      mouthRef.current.setAttribute('y', '50')
    }
    if (haloRef.current) {
      haloRef.current.style.transform = ''
    }
    setState('offline')
  }, [stopPlayback])

  useEffect(() => stopSession, [stopSession])

  const startMouthAnimation = useCallback(() => {
    if (animIdRef.current !== null) return
    const bins = new Uint8Array(64)
    const tick = () => {
      animIdRef.current = requestAnimationFrame(tick)
      let level = 0
      if (analyserRef.current && stateRef.current === 'speaking') {
        analyserRef.current.getByteTimeDomainData(bins)
        let sum = 0
        for (let i = 0; i < bins.length; i++) {
          const v = (bins[i] - 128) / 128
          sum += v * v
        }
        level = Math.min(1, Math.sqrt(sum / bins.length) * 4.5)
      }
      if (mouthRef.current) {
        const h = 3.5 + level * 11
        const y = 51.5 - h / 2
        mouthRef.current.setAttribute('height', h.toFixed(1))
        mouthRef.current.setAttribute('y', y.toFixed(1))
      }
      if (haloRef.current) {
        haloRef.current.style.transform =
          stateRef.current === 'speaking' ? `scale(${(1 + level * 0.28).toFixed(2)})` : ''
      }
    }
    animIdRef.current = requestAnimationFrame(tick)
  }, [])

  const schedulePcmPlayback = useCallback((buf: ArrayBuffer) => {
    const ctx = playCtxRef.current
    if (!ctx) return
    const int16 = new Int16Array(buf)
    if (int16.length === 0) return
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768
    }
    const audioBuf = ctx.createBuffer(1, float32.length, 24000)
    audioBuf.copyToChannel(float32, 0)

    const src = ctx.createBufferSource()
    src.buffer = audioBuf
    if (analyserRef.current) {
      src.connect(analyserRef.current)
      analyserRef.current.connect(ctx.destination)
    } else {
      src.connect(ctx.destination)
    }

    const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current)
    src.start(startAt)
    nextPlayTimeRef.current = startAt + audioBuf.duration
    activeSourcesRef.current.add(src)
    setState('speaking')

    src.onended = () => {
      activeSourcesRef.current.delete(src)
      if (activeSourcesRef.current.size === 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        setState('listening')
      }
    }
  }, [])

  const startSession = useCallback(
    async (selectedLang?: string) => {
      stopSession()
      setErrorMsg(null)
      setState('connecting')

      const targetLang = selectedLang ?? lang

      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const playCtx = new AudioCtx({ sampleRate: 24000 })
        await playCtx.resume().catch(() => {})
        const analyser = playCtx.createAnalyser()
        analyser.fftSize = 128
        playCtxRef.current = playCtx
        analyserRef.current = analyser
        nextPlayTimeRef.current = playCtx.currentTime
        startMouthAnimation()

        const ws = new WebSocket(buildWsUrl(targetLang))
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onmessage = (evt) => {
          if (evt.data instanceof ArrayBuffer) {
            schedulePcmPlayback(evt.data)
            return
          }
          try {
            const msg = JSON.parse(String(evt.data))
            if (msg.type === 'status') {
              if (msg.state === 'connected' || msg.state === 'restarted') {
                setState('listening')
              }
            } else if (msg.type === 'user_text' && msg.text) {
              appendTurn('user', msg.text)
            } else if (msg.type === 'agent_text' && msg.text) {
              appendTurn('agent', msg.text)
            } else if (msg.type === 'interrupt') {
              stopPlayback()
              setState('listening')
            } else if (msg.type === 'turn_end') {
              if (activeSourcesRef.current.size === 0) {
                setState('listening')
              }
            } else if (msg.type === 'error') {
              setErrorMsg(msg.message || 'Connection error')
              setState('error')
            }
          } catch {
            // ignore non-JSON
          }
        }

        ws.onerror = () => {
          setErrorMsg('WebSocket connection failed')
          setState('error')
        }

        ws.onclose = () => {
          if (stateRef.current !== 'error') {
            setState('offline')
          }
        }

        // Start microphone capture (optional — user can still type if mic is denied)
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            })
            micStreamRef.current = stream
            const micCtx = new AudioCtx()
            await micCtx.audioWorklet.addModule('/pcm-worklet.js')
            const source = micCtx.createMediaStreamSource(stream)
            const worklet = new AudioWorkletNode(micCtx, 'pcm-processor', {
              processorOptions: { targetRate: 16000 },
            })
            worklet.port.onmessage = (e) => {
              if (mutedRef.current) return
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(e.data)
              }
            }
            source.connect(worklet)
            micCtxRef.current = micCtx
          } catch {
            appendTurn('system', 'Mikrofon ruxsati berilmadi — matn orqali yozishingiz mumkin.')
          }
        }
      } catch (err) {
        setErrorMsg((err as Error).message || 'Could not start voice session')
        setState('error')
      }
    },
    [appendTurn, lang, schedulePcmPlayback, startMouthAnimation, stopPlayback, stopSession],
  )

  const handleAvatarClick = () => {
    if (!open) {
      setOpen(true)
      if (state === 'offline' || state === 'error') {
        void startSession()
      }
    } else {
      setOpen(false)
    }
  }

  const handleSendText = () => {
    const text = inputText.trim()
    if (!text) return
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      void startSession()
      return
    }
    appendTurn('user', text)
    wsRef.current.send(JSON.stringify({ type: 'text', text }))
    setInputText('')
  }

  const handleLangChange = (nextLang: string) => {
    setLang(nextLang)
    fetch('/api/ico/settings', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: nextLang }),
    }).catch(() => {})
    if (state !== 'offline') {
      void startSession(nextLang)
    }
  }

  const stateLabel: Record<AvatarState, string> = {
    offline: 'Oflayn',
    connecting: 'Ulanmoqda...',
    listening: 'Tinglayapti...',
    speaking: 'Gapiryapti...',
    error: 'Xatolik',
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[340px] sm:w-[370px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-400/20 border border-primary/30">
                <Sparkles className="size-4 text-primary" />
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card',
                    state === 'listening' && 'bg-emerald-500',
                    state === 'speaking' && 'bg-cyan-400 animate-pulse',
                    state === 'connecting' && 'bg-amber-400 animate-pulse',
                    state === 'error' && 'bg-destructive',
                    state === 'offline' && 'bg-muted-foreground',
                  )}
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">{avatarName}</span>
                  <span className="text-[11px] text-muted-foreground">· {stateLabel[state]}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                  {avatarRole}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <select
                value={lang}
                onChange={(e) => handleLangChange(e.target.value)}
                aria-label="Language"
                className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground"
              >
                {LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setOpen(false)}
                aria-label="Minimize"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Messages / Live transcript */}
          <div ref={scrollRef} className="h-60 overflow-y-auto px-3.5 py-3 space-y-2.5 text-xs">
            {messages.length === 0 && !errorMsg && (
              <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground px-4">
                <Volume2 className="size-6 mb-2 text-primary/70" />
                <p className="font-medium text-foreground mb-1">
                  {state === 'connecting' ? `${avatarName} ulanmoqda...` : `${avatarName} bilan suhbatlashing`}
                </p>
                <p className="text-[11px]">
                  Mikrofonga gapiring yoki pastda xabar yozing — avatar ovozli javob beradi.
                </p>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[82%] rounded-xl px-3 py-2 leading-relaxed',
                    m.role === 'user' && 'bg-primary text-primary-foreground',
                    m.role === 'agent' && 'bg-surface-sunken text-foreground border border-border',
                    m.role === 'system' && 'bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[11px]',
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {errorMsg && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Controls + Text Input */}
          <div className="border-t border-border bg-background/60 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendText()
                }}
                placeholder="Savol yozing yoki gapiring..."
                className="h-8 text-xs"
              />
              <Button
                size="icon"
                className="size-8 shrink-0"
                onClick={handleSendText}
                disabled={!inputText.trim()}
                aria-label="Send"
              >
                <Send className="size-3.5" />
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                variant={muted ? 'destructive' : 'outline'}
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => setMuted((m) => !m)}
                disabled={state === 'offline'}
              >
                {muted ? <MicOff className="mr-1.5 size-3.5" /> : <Mic className="mr-1.5 size-3.5" />}
                {muted ? 'Mikrofon o‘chiq' : 'Mikrofon yoniq'}
              </Button>
              {state === 'offline' || state === 'error' ? (
                <Button
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={() => void startSession()}
                >
                  <Mic className="mr-1.5 size-3.5" />
                  Boshlash
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={stopSession}
                >
                  <PhoneOff className="mr-1.5 size-3.5" />
                  Tugatish
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating bottom-right Avatar button */}
      <button
        type="button"
        onClick={handleAvatarClick}
        aria-label={`${avatarName} AI Avatar`}
        title={`${avatarName} — ${avatarRole}`}
        className={cn(
          'group relative flex size-16 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        )}
      >
        <span
          ref={haloRef}
          className={cn(
            'absolute inset-0 rounded-full transition-transform duration-75',
            state === 'listening' && 'bg-emerald-400/25 animate-ping',
            state === 'speaking' && 'bg-cyan-400/35',
            state === 'connecting' && 'bg-violet-400/30 animate-pulse',
            state === 'offline' && 'bg-violet-500/15 group-hover:bg-violet-500/25',
            state === 'error' && 'bg-destructive/25',
          )}
        />
        <svg className="relative size-16 drop-shadow-md" viewBox="0 0 80 80" aria-hidden="true">
          <defs>
            <linearGradient id="icoAvGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="38" fill="url(#icoAvGrad)" opacity="0.22" />
          <circle cx="40" cy="40" r="30" fill="#171d36" stroke="url(#icoAvGrad)" strokeWidth="2.5" />
          <path
            d="M16 38c0-14 10-24 24-24s24 10 24 24c-3-8-10-12-24-12s-21 4-24 12z"
            fill="#a78bfa"
            opacity="0.9"
          />
          <circle cx="31" cy="39" r="2.7" fill="#f8fafc" />
          <circle cx="49" cy="39" r="2.7" fill="#f8fafc" />
          <rect
            ref={mouthRef}
            x="33"
            y="50"
            width="14"
            height="3.5"
            rx="2"
            fill="#22d3ee"
          />
        </svg>
      </button>
    </div>
  )
}
