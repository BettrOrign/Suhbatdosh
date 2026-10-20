export type Role = 'admin' | 'manager' | 'receptionist' | 'yonalish'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  api_token?: string | null
}

export interface Client {
  id: number
  name: string
  phone: string
  company: string
  email: string
  notes: string
  manager_id: number | null
  manager_name: string | null
  call_count: number
  created_at: string
}

export type CallType = 'manager' | 'receptionist'

export type SourceType = 'upload' | 'ingest' | 'telegram_voice' | 'telegram_audio' | 'telegram_video' | 'youtube' | 'zadarma'

export type CallStatus =
  | 'uploaded'
  | 'queued'
  | 'transcribing'
  | 'transcribed'
  | 'analyzing'
  | 'done'
  | 'error'

export interface Segment {
  text: string
  finished: boolean | null
  speaker_label: string | null
  language_code: string | null
  /** Seconds on the call's timeline. Absent for Gemini transcripts — only the
   *  local private-mode STT produces them. */
  start?: number | null
  end?: number | null
}

export interface Scorecard {
  opening: number
  discovery: number
  objection_handling: number
  value_prop: number
  closing: number
  rapport: number
  talk_ratio: number
  overall: number
}

export interface KeyMetric {
  name: string
  value: string
}

export interface CallAnalysis {
  topic: string
  language: string
  summary: string
  scorecard: Scorecard
  rep_share_of_talk: number
  outcome: string
  key_metrics: KeyMetric[]
  coaching_points: string[]
  next_steps: string[]
  action_items: { description: string; due_date: string | null; assignee: string; priority: string }[]
}

export interface Call {
  id: number
  name: string
  status: CallStatus
  audio_path: string | null
  duration_sec: number | null
  language: string | null
  transcript: string
  segments: Segment[]
  analysis: Partial<CallAnalysis> | Record<string, never>
  call_type: CallType
  source_type: SourceType
  source_meta: Record<string, unknown>
  user_id: number | null
  client_id: number | null
  uploader_name: string | null
  client_name: string | null
  created_at: string
  updated_at: string
}

export interface Notification {
  id: number
  user_id: number
  call_id: number | null
  type: string
  title: string
  message: string
  metadata: Record<string, unknown>
  read: boolean
  created_at: string
}

/* --- processing mode (docs/CONTRACT.md) ----------------------------------- */

/**
 * `online`  — transcription AND analysis via Gemini.
 * `private` — transcription via the local GigaAM model; the transcript still
 *             goes to Gemini for analysis. Audio never leaves the machine.
 */
export type ProcessingMode = 'online' | 'private'

export interface SttInfo {
  provider: string
  model: string
  available: boolean
  languages: string[]
}

export interface AnalysisInfo {
  provider: string
  model: string
}

export interface Settings {
  mode: ProcessingMode
  stt: SttInfo
  analysis: AnalysisInfo
  updated_at: string
}

export type ManagedUser = User & { active: boolean }

/* --- normalised analysis accessors ---------------------------------------
 *
 * `calls.analysis` is a JSON blob written by the model (`analysis.py`). Not
 * every call has one, and every page used to reach into it with an
 * `as unknown as SomeExtras` cast. These helpers make that explicit and
 * total, which is what let `strict` find the real bugs. -------------------- */

export interface AnalysisExtras {
  problem?: string | null
  solutions?: string[]
  error?: string | null
}

/** Narrow the loose `Call.analysis` blob to `Partial<CallAnalysis>`. */
export function asAnalysis(raw: Call['analysis']): Partial<CallAnalysis> {
  return (raw ?? {}) as Partial<CallAnalysis>
}

export function analysisError(raw: Call['analysis']): string {
  const extras = raw as AnalysisExtras
  return typeof extras.error === 'string' ? extras.error.trim() : ''
}

export function analysisProblem(raw: Call['analysis']): string {
  const extras = raw as AnalysisExtras
  return typeof extras.problem === 'string' ? extras.problem.trim() : ''
}

export function analysisSolutions(raw: Call['analysis']): string[] {
  const extras = raw as AnalysisExtras
  return Array.isArray(extras.solutions) ? extras.solutions : []
}

/** Overall score, or `null` when the call is not scored yet. */
export function overallScore(raw: Call['analysis']): number | null {
  const v = asAnalysis(raw).scorecard?.overall
  return typeof v === 'number' ? v : null
}

/** Model-written topic, preferred over the raw call name once analysed. */
export function callTitle(call: Call): string {
  if (call.status === 'done') {
    const topic = asAnalysis(call.analysis).topic
    if (typeof topic === 'string' && topic.trim()) return topic
  }
  return call.name
}
