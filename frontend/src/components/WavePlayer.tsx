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
  const waveKey = useRef(0)

  useEffect(() => {
    if (!containerRef.current) return
    setIsLoading(true)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setIsError(false)

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
      waveColor: 'var(--color-muted)',
      progressColor: 'var(--color-primary)',
      cursorColor: 'var(--color-ring)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      url,
    })
    waveRef.current = ws

    ws.on('ready', () => {
      setIsLoading(false)
      setDuration(ws.getDuration() ?? 0)
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

  const retry = () => {
    setRetryCount((c) => c + 1)
  }

  return (
    <div className="flex w-full items-center gap-3">
      <button
        type="button"
        disabled={isLoading}
        onClick={toggle}
        aria-label={isPlaying ? t('call.pause') : t('call.play')}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all duration-200 ease-smooth hover:scale-105 hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {isError ? (
          <button
            type="button"
            onClick={retry}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
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

      <div className="shrink-0 whitespace-nowrap text-right text-xs font-medium tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="mx-1 text-muted-foreground/60">/</span>
        {formatTime(duration)}
      </div>
    </div>
  )
}