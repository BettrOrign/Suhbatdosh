export type Role = 'admin' | 'manager' | 'receptionist' | 'yonalish'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  api_token?: string | null
  sip_extension?: string | null
  job_title?: string
  department?: string
  skills?: string
  supervisor_id?: number | null
  telegram_id?: string
  phone?: string
  org_id?: number
  org_name?: string
  org_slug?: string
}

export interface Escalation {
  id: number
  org_id: number
  call_id: number
  call_name?: string
  call_user_name?: string
  detected_problem: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  assigned_to_user_id: number | null
  assigned_user_name?: string | null
  assigned_user_email?: string | null
  assigned_user_role?: Role | null
  assigned_user_title?: string | null
  assigned_user_department?: string | null
  assigned_reason: string
  action_plan: string[]
  channel: 'email' | 'telegram' | 'both'
  status: 'open' | 'sent' | 'resolved'
  email_status: string
  telegram_status: string
  resolved_at?: string | null
  resolution_notes?: string
  created_at: string
}

export interface NotificationSettings {
  smtp_enabled: boolean
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_password?: string
  has_smtp_password?: boolean
  smtp_from_name: string
  telegram_alerts_enabled: boolean
  telegram_bot_token: string
  has_telegram_bot_token?: boolean
  telegram_default_chat_id: string
  auto_escalate_enabled: boolean
  escalation_score_threshold: number
  escalate_on_coach_decision: boolean
}

export interface Invite {
  id: number
  token: string
  org_id: number
  email: string
  role: Role
  created_by: number | null
  expires_at: string
  accepted_at: string | null
  created_at: string
}

export interface InviteInfo {
  email: string
  role: Role
  org_name: string
  expires_at: string
}

export interface UserSession {
  id: number
  user_agent: string
  ip: string
  created_at: string
  last_seen_at: string
  expires_at: string
}

export interface OutcomeMetrics {
  total_leads: number
  converted_leads: number
  overdue_leads: number
  lead_conversion_rate: number | null
  total_escalations: number
  resolved_escalations: number
  escalation_resolved_rate: number | null
  avg_sla_hours: number | null
  avg_telegram_score: number | null
  outcome_score: number | null
  composite_score: number | null
}

export interface EmployeeActionQueue {
  open_escalations: Escalation[]
  due_leads: Client[]
  unanswered_telegram: TelegramMessage[]
  action_items: Notification[]
  outcome_metrics: OutcomeMetrics
}

export interface EmployeeOverview {
  kpis: {
    total_calls: number
    calls_today: number
    calls_this_week: number
    avg_score: number | null
    best_score: number | null
    avg_talk_ratio: number | null
    open_tasks_count: number
    problem_calls_count: number
  }
  rank: {
    position: number | null
    total_peers: number
  }
  weekly_trend: { day: string; total_calls: number; avg_score: number | null }[]
  rubric_averages: { dimension: string; avg_score: number }[]
  coaching_points: {
    call_id: number
    call_title: string
    created_at: string
    score: number | null
    point: string
  }[]
  tasks: Notification[]
  recent_calls: Call[]
  outcome_metrics?: OutcomeMetrics
}

export type PipelineStage = 'new_lead' | 'consulted' | 'test_scheduled' | 'tested' | 'enrolled' | 'lost'
export type SourceChannel = 'manual' | 'phone' | 'telegram' | 'instagram' | 'website'

export interface Client {
  id: number
  name: string
  phone: string
  company: string
  email: string
  notes: string
  manager_id: number | null
  manager_name: string | null
  pipeline_stage?: PipelineStage
  source_channel?: SourceChannel
  student_grade?: string
  test_date?: string
  test_location?: string
  next_follow_up_at?: string
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

export interface EvidenceQuote {
  dimension: string
  quote: string
  speaker?: string | null
  start_sec?: number | null
}

export interface CallAnalysis {
  topic: string
  language: string
  summary: string
  scorecard: Scorecard
  rep_share_of_talk: number
  outcome: string
  coach_decision?: 'NO_ACTION' | 'COACH' | 'ESCALATE'
  key_metrics: KeyMetric[]
  coaching_points: string[]
  next_steps: string[]
  action_items: { description: string; due_date: string | null; assignee: string; priority: string }[]
  evidence_quotes?: EvidenceQuote[]
  objections?: string[]
}

export interface AcousticsInfo {
  channels: number
  total_sec: number
  silence_sec: number
  silence_ratio: number
  longest_silence_sec: number
  dead_air_count: number
  interruption_count: number
  talk_over_sec: number
  rep_talk_sec?: number
  client_talk_sec?: number
  rep_share_acoustics?: number | null
}

export interface CrossCallInsights {
  analyzed_calls: number
  bookmarked_calls: number
  decision_counts: { NO_ACTION: number; COACH: number; ESCALATE: number }
  weakest_dimensions: { dimension: string; avg_score: number }[]
  top_flaws: { text: string; count: number }[]
  top_objections: { text: string; count: number }[]
}

export interface CrossCallAnswer {
  answer: string
  cited_call_ids: number[]
  recommendations: string[]
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
  resolved?: boolean
  bookmarked?: boolean
  bookmark_note?: string
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
  flags: SettingsFlags
  retention_days: number
  stt: SttInfo
  analysis: AnalysisInfo
  updated_at: string
}

export interface SettingsFlags {
  punctuation: boolean
  speaker_labels: boolean
  problem_alerts: boolean
  gpu: boolean
}

export interface OrgProfile {
  name?: string
  direction?: string
  services?: string
  rules?: string
  flaws?: string
  metrics?: string
  summary?: string
  custom_instructions?: string
}

export interface OrgProfileResponse {
  profile: OrgProfile
  updated_at: string | null
}

export interface OrgSearchResult {
  found: boolean
  profile: OrgProfile
  sources: string[]
  facts: string
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

export interface TelegramMessage {
  id: number
  chat_id: number
  message_id: number
  user_id: number | null
  username: string | null
  full_name: string | null
  photo_url: string | null
  text: string | null
  is_bot: number
  is_staff: number
  topic: string | null
  reply_text: string | null
  replied_at: string | null
  created_at: string
}

/** Model-written topic, preferred over the raw call name once analysed. */
export function callTitle(call: Call): string {
  if (call.status === 'done') {
    const topic = asAnalysis(call.analysis).topic
    if (typeof topic === 'string' && topic.trim()) return topic
  }
  return call.name
}

export interface RubricCriterion {
  key: string
  label: string
  weight: number
  description: string
}

export interface Rubric {
  id: number
  org_id: number
  name: string
  call_type: 'manager' | 'receptionist' | 'all'
  description: string
  criteria: RubricCriterion[]
  is_default: boolean
  active: boolean
  created_at: string
  updated_at: string
}
