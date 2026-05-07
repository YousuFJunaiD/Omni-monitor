import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

function isConfigured(value) {
  return Boolean(value && !String(value).includes('YOUR_') && !String(value).includes('YOUR-PROJECT'))
}

export const supabaseReady = isConfigured(url) && isConfigured(key)
export const supabaseConfigError = supabaseReady ? '' : 'Supabase environment variables are missing or still using placeholder values.'
export const supabase = supabaseReady ? createClient(url, key) : null
