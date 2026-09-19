export type Role = 'admin' | 'manager' | 'receptionist' | 'yonalish'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  api_token?: string | null
}

export interface Client {
  role: string
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

export interface Manager extends User {
  active: boolean
  created_at: string
  api_token: string | null
  total_calls: number
  avg_score: number | null
  avg_talk_ratio: number | null
  last_score: number | null
  last_call_at: string | null
}

export type CallType = 'manager' | 'receptionist'

export type SourceType = 'upload' | 'ingest' | 'telegram_voice' | 'telegram_audio' | 'telegram_video' | 'youtube'

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

export interface Tag {
  id: number
  name: string
  color: string
  created_at: string
}

export interface YoutubeWhitelistEntry {
  id: number
  channel_id: string | null
  channel_name: string | null
  pattern: string | null
  active: boolean
  created_at: string
}
