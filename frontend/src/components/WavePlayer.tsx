import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Loader2, Pause, Play, RotateCw } from 'lucide-react'

import { useI18n } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

interface Props {
  url: string
}

const SPEEDS = [1, 1.25, 1.5, 2]

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Waveform player. `speed` is kept in a ref and applied imperatively rather
 * than being an effect dependency — otherwise cycling the speed would tear
 * down and rebuild the entire WaveSurfer instance mid-playback (the bug the
 * old `exhaustive-deps` warning was pointing at).
 */
export function WavePlayer({ url }: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const speedRef = useRef(1)

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    setIsLoading(true)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setIsError(false)

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 40,
      waveColor: 'color-mix(in oklch, var(--color-muted-foreground) 30%, transparent)',
      progressColor: 'var(--color-primary)',
      cursorColor: 'var(--color-primary)',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      url,
    })
    waveRef.current = ws

    ws.on('ready', () => {
      setIsLoading(false)
      setDuration(ws.getDuration() ?? 0)
      ws.setPlaybackRate(speedRef.current)
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
    ws.on('timeupdate', (time: number) => setCurrentTime(time))

    return () => {
      ws.destroy()
      waveRef.current = null
    }
  }, [url, retryCount])

  const toggle = useCallback(() => {
    const ws = waveRef.current
    if (!ws) return
    if (ws.isPlaying()) ws.pause()
    else void ws.play()
  }, [])

  const cycleSpeed = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(speedRef.current) + 1) % SPEEDS.length]
    speedRef.current = next
    waveRef.current?.setPlaybackRate(next)
    setSpeed(next)
  }, [])

  return (
    <div className="flex w-full items-center gap-3">
      <button
        type="button"
        disabled={isLoading}
        onClick={toggle}
        aria-label={isPlaying ? t('call.pause') : t('call.play')}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
          'shadow-e1 outline-none transition-[transform,background-color] duration-150 ease-standard',
          'hover:bg-primary-hover active:scale-95',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:pointer-events-none disabled:opacity-60'
        )}
      >
        {isLoading ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause aria-hidden="true" className="size-4 fill-current" />
        ) : (
          <Play aria-hidden="true" className="size-4 translate-x-px fill-current" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {isError ? (
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive-soft px-3 py-2 text-xs text-destructive-soft-foreground ring-1 ring-destructive/20 ring-inset transition-colors hover:opacity-80"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            {t('call.audio_error')}
          </button>
        ) : (
          <div
            ref={containerRef}
            className={cn('transition-opacity duration-150', isLoading && 'pointer-events-none opacity-40')}
          />
        )}
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        title={t('call.speed')}
        aria-label={t('call.speed')}
        className="shrink-0 rounded-sm border border-border bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold tabular-nums outline-none transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {speed}x
      </button>

      <span className="shrink-0 text-right text-2xs font-medium tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="mx-0.5 opacity-50">/</span>
        {formatTime(duration)}
      </span>
    </div>
  )
}
