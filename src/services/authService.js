import { supabase, supabaseConfigError } from '../supabase'

const TOKEN_KEY = 'omnimate_session_token'
let logoutHandler = null

export function registerLogoutHandler(handler) {
  logoutHandler = handler
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Storage may be unavailable in restricted browser modes.
  }
}

export async function login(username, password) {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured')
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You appear to be offline. Check your connection and try again.')
  }

  const { data, error } = await supabase.rpc('login_user', {
    p_username: username,
    p_password: password
  })

  if (error) {
    throw new Error(error.message || 'Login failed')
  }

  if (!data?.ok) {
    throw new Error(data?.error || 'Invalid username or password')
  }

  return {
    token: data.token,
    user: data.user
  }
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Ignore storage errors during logout.
  }

  if (typeof logoutHandler === 'function') {
    logoutHandler()
    return
  }

  window.location.href = '/login'
}
