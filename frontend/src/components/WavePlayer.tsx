import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Loader2, Pause, Play, RotateCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n/i18n'

interface Props {
  url: string
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function WavePlayer({ url }: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [retryCount, setRetryCount] = useState(0)

  const [speed, setSpeed] = useState<number>(1)

  useEffect(() => {
    if (!containerRef.current) return
    setIsLoading(true)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setIsError(false)

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 48,
      waveColor: 'rgba(148, 163, 184, 0.35)',
      progressColor: 'var(--color-primary)',
      cursorColor: 'var(--color-primary)',
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      url,
    })
    waveRef.current = ws

    ws.on('ready', () => {
      setIsLoading(false)
      setDuration(ws.getDuration() ?? 0)
      ws.setPlaybackRate(speed)
    })
    ws.on('loading', () => {
      setIsLoading(true)
      setIsError(false)
    })
    ws.on('error', () => {
      setIsError(true)
      setIsLoading(false)
    })
    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))
    ws.on('timeupdate', (t: number) => setCurrentTime(t))

    return () => {
      ws.destroy()
      waveRef.current = null
    }
  }, [url, retryCount])

  const toggle = () => {
    const ws = waveRef.current
    if (!ws) return
    if (ws.isPlaying()) ws.pause()
    else void ws.play()
  }

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2]
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length]
    setSpeed(next)
    waveRef.current?.setPlaybackRate(next)
  }

  const retry = () => {
    setRetryCount((c) => c + 1)
  }

  return (
    <div className="flex w-full items-center gap-3.5">
      <button
        type="button"
        disabled={isLoading}
        onClick={toggle}
        aria-label={isPlaying ? t('call.pause') : t('call.play')}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all duration-200 ease-smooth hover:scale-105 hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-0.5 fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {isError ? (
          <button
            type="button"
            onClick={retry}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
          >
            <RotateCw className="size-4" />
            {t('call.audio_error')}
          </button>
        ) : (
          <div
            ref={containerRef}
            className={cn(
              'transition-opacity duration-200',
              isLoading && 'pointer-events-none opacity-40',
            )}
          />
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={cycleSpeed}
          title={t('call.speed')}
          className="rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors tabular-nums"
        >
          {speed}x
        </button>

        <div className="whitespace-nowrap text-right text-xs font-medium tabular-nums text-muted-foreground">
          {formatTime(currentTime)}
          <span className="mx-1 text-muted-foreground/50">/</span>
          {formatTime(duration)}
        </div>
      </div>
    </div>
  )
}