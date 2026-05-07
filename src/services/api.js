import {supabase, supabaseConfigError} from '../supabase'
import {logout} from './authService'

function shouldLogout(message = '') {
  const normalized = message.toLowerCase()
  return normalized.includes('invalid token') ||
    normalized.includes('expired token') ||
    normalized.includes('jwt') ||
    normalized.includes('login') ||
    normalized.includes('not logged in') ||
    normalized.includes('unauthorized') ||
    normalized.includes('session')
}

export async function callRPC(fn, payload) {
  try {
    if (!supabase) {
      throw new Error(supabaseConfigError || 'Supabase is not configured')
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('You appear to be offline. Check your connection and try again.')
    }

    const {data, error} = await supabase.rpc(fn, payload)

    if (error) {
      throw new Error(error.message || 'RPC failed')
    }

    if (!data?.ok) {
      throw new Error(data?.error || 'Operation failed')
    }

    return data
  } catch (err) {
    const message = err?.message || 'Operation failed'

    if (shouldLogout(message)) {
      logout()
    }

    throw new Error(message)
  }
}
