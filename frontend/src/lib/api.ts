import type { Call, Client, Manager, User, Notification, Tag, YoutubeWhitelistEntry } from './types'

const TOKEN_KEY = 'suhbatdosh_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const isForm = init?.body instanceof FormData
  if (!isForm) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(path, { ...init, headers })
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null)
    window.dispatchEvent(new Event('auth:logout'))
    throw new Error('Session expired')
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) detail = String(body.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) }
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', jsonBody('POST', { email, password })),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', jsonBody('POST', {})),
  me: () => request<User>('/api/auth/me'),
  regenerateToken: (userId?: number) =>
    request<{ api_token: string }>(
      userId ? `/api/users/${userId}/token` : '/api/auth/token',
      { method: 'POST' },
    ),

   // users (admin)
  listUsers: () => request<(User & { active: boolean })[]>('/api/users'),
  createUser: (data: { name: string; email: string; password: string; role: string }) =>
    request<User>('/api/users', jsonBody('POST', data)),
  updateUser: (id: number, data: Partial<{ name: string; email: string; password: string; role: string; active: boolean }>) =>
    request<{ ok: boolean }>(`/api/users/${id}`, jsonBody('PATCH', data)),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  // managers (admin analytics)
  listManagers: () => request<Manager[]>('/api/managers'),
  listManagerCalls: (id: number) => request<Call[]>(`/api/managers/${id}/calls`),

  // clients
  listClients: () => request<Client[]>('/api/clients'),
  createClient: (data: Partial<Client>) =>
    request<Client>('/api/clients', jsonBody('POST', data)),
  updateClient: (id: number, data: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, jsonBody('PATCH', data)),
  deleteClient: (id: number) =>
    request<{ ok: boolean }>(`/api/clients/${id}`, { method: 'DELETE' }),

  // calls
  listCalls: () => request<Call[]>('/api/calls'),
  getCall: (id: number) => request<Call>(`/api/calls/${id}`),
  uploadCall: (file: File, opts?: { name?: string; call_type?: string; client_id?: number | null }) => {
    const fd = new FormData()
    fd.append('file', file)
    if (opts?.name) fd.append('name', opts.name)
    if (opts?.call_type) fd.append('call_type', opts.call_type)
    if (opts?.client_id) fd.append('client_id', String(opts.client_id))
    return request<Call>('/api/calls', { method: 'POST', body: fd })
  },
  audioUrl: (id: number) => {
    const token = getToken()
    const base = `${window.location.origin}/api/calls/${id}/audio`
    return token ? `${base}?token=${token}` : base
  },
  updateTranscript: (id: number, transcript: string, segments?: unknown[]) =>
    request<Call>(`/api/calls/${id}/transcript`, {
      method: 'PATCH',
      body: JSON.stringify({ transcript, ...(segments ? { segments } : {}) }),
    }),
  updateCall: (id: number, data: Partial<{ call_type: string; client_id: number | null }>) =>
    request<Call>(`/api/calls/${id}`, jsonBody('PATCH', data)),
  reanalyze: (id: number) =>
    request<{ ok: boolean }>(`/api/calls/${id}/reanalyze`, { method: 'POST' }),
  deleteCall: (id: number) =>
    request<{ ok: boolean }>(`/api/calls/${id}`, { method: 'DELETE' }),

  // notifications
  listNotifications: (unreadOnly?: boolean, limit?: number) => {
    const params = new URLSearchParams()
    if (unreadOnly) params.set('unread_only', 'true')
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<Notification[]>(`/api/notifications${qs ? '?' + qs : ''}`)
  },
  getUnreadCount: () => request<{ count: number }>('/api/notifications/unread-count'),
  markNotificationRead: (id: number) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  // telegram
  linkTelegram: (data: { telegram_id: number; username?: string; first_name?: string; last_name?: string }) =>
    request<{ ok: boolean }>('/api/telegram/link', jsonBody('POST', data)),
  unlinkTelegram: () => request<{ ok: boolean }>('/api/telegram/unlink', { method: 'DELETE' }),

  // tags
  listTags: () => request<Tag[]>('/api/tags'),
  createTag: (data: { name: string; color?: string }) =>
    request<Tag>('/api/tags', jsonBody('POST', data)),
  deleteTag: (id: number) =>
    request<{ ok: boolean }>(`/api/tags/${id}`, { method: 'DELETE' }),
  tagCall: (callId: number, tagId: number) =>
    request<{ ok: boolean }>(`/api/calls/${callId}/tags`, jsonBody('POST', { tag_id: tagId })),
  untagCall: (callId: number, tagId: number) =>
    request<{ ok: boolean }>(`/api/calls/${callId}/tags/${tagId}`, { method: 'DELETE' }),
  getCallTags: (callId: number) => request<Tag[]>(`/api/calls/${callId}/tags`),

  // youtube
  listYoutubeWhitelist: () => request<YoutubeWhitelistEntry[]>('/api/youtube/whitelist'),
  addYoutubeWhitelist: (data: { channel_id?: string; channel_name?: string; pattern?: string }) =>
    request<{ id: number }>('/api/youtube/whitelist', jsonBody('POST', data)),
  removeYoutubeWhitelist: (id: number) =>
    request<{ ok: boolean }>(`/api/youtube/whitelist/${id}`, { method: 'DELETE' }),
  processYoutube: (url: string) =>
    request<{ ok: boolean; call_id: number }>('/api/youtube/process', jsonBody('POST', { url })),

  // analytics
  getOverviewStats: () => request<{
    total_calls: number; done_calls: number; error_calls: number; processing_calls: number;
    avg_score: number | null; total_managers: number; total_clients: number;
    calls_today: number; top_managers: { name: string; email: string; call_count: number; avg_score: number | null }[];
  }>('/api/stats/overview'),
  getDayOverDay: () => request<{
    today: { calls: number; done: number; avg_score: number | null; avg_duration: number | null; avg_talk_ratio: number | null };
    yesterday: { calls: number; done: number; avg_score: number | null; avg_duration: number | null; avg_talk_ratio: number | null };
    date_today: string; date_yesterday: string;
  }>('/api/stats/day-over-day'),
  getWeeklyTrend: () => request<{ day: string; total_calls: number; done_calls: number; avg_score: number | null; avg_duration: number | null }[]>('/api/stats/weekly-trend'),
  getMonthlyTrend: () => request<{ week: string; total_calls: number; done_calls: number; avg_score: number | null }[]>('/api/stats/monthly-trend'),
  getProblemCalls: () => request<{ id: number; name: string; duration_sec: number; source_type: string; created_at: string; score: number | null; outcome: string; summary: string; uploader_name: string | null }[]>('/api/stats/problem-calls'),
  getManagerRankings: () => request<{ id: number; name: string; email: string; role?: string; total_calls: number; avg_score: number | null; avg_talk_ratio: number | null; calls_today: number; calls_yesterday: number; trend: string; best_score: number | null; solved_problems?: number; unsolved_problems?: number }[]>('/api/stats/manager-rankings'),
  getSourceBreakdown: () => request<Record<string, number>>('/api/stats/source-breakdown'),
}