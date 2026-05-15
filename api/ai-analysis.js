// AI analysis proxy. Pure env-driven provider selection. No hardcoded IPs.
//
// Phase 12 (overnight sprint): extended from Ollama-only to a provider-pluggable
// design that supports local Ollama, hosted Ollama-compatible endpoints, and
// OpenAI-compatible chat APIs (which covers OpenAI, Anthropic via the
// Anthropic-OpenAI adapter, Groq, Together, Mistral, vLLM, and most
// self-hosted gateways). Mock provider remains as the always-on fallback.
//
// Provider selection precedence (first non-empty wins):
//   1. AI_PROVIDER env var: 'ollama' | 'openai' | 'mock'
//   2. If OPENAI_API_KEY is set            → 'openai'
//   3. If ENABLE_AI_ANALYSIS=true          → 'ollama'
//   4. otherwise                            → 'mock'
//
// All providers receive the same `context` object and must return:
//   { ok: true, summary, provider, model?, fallback?, insight_counts? }
//
// If a real provider throws or times out, the handler transparently falls
// back to the mock provider and tags the response with `fallback: true`.

const DEFAULT_TIMEOUT_MS = 20000

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function envFlag(name, def = 'false') {
  return String(process.env[name] || def).toLowerCase() === 'true'
}

// ─── Providers ───────────────────────────────────────────────────────────────

const providers = {
  ollama: {
    name: 'Ollama',
    // Works for both local LAN Ollama and a hosted Ollama-compatible endpoint
    // (same /api/generate contract). Set OLLAMA_BASE_URL accordingly:
    //   local:  http://192.168.x.x:11434
    //   hosted: https://your-ollama-host.example.com
    call: async (context) => {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      const model = process.env.OLLAMA_MODEL || 'llama3.1'
      const prompt = buildPrompt(context)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model, prompt, stream: false })
        })
        if (!response.ok) {
          throw new Error(`Ollama request failed: ${response.status}`)
        }
        const data = await response.json()
        return { ok: true, summary: String(data.response || '').trim(), provider: 'ollama', model }
      } finally {
        clearTimeout(timeout)
      }
    }
  },

  // OpenAI-compatible Chat Completions endpoint. Works for:
  //   • OpenAI            — OPENAI_BASE_URL omitted (defaults to api.openai.com)
  //   • Anthropic (via    — set OPENAI_BASE_URL to your Anthropic-OpenAI proxy
  //     OpenAI adapter)
  //   • Groq / Together / Mistral / vLLM / self-hosted gateway
  //     — set OPENAI_BASE_URL to that gateway's /v1 path.
  openai: {
    name: 'OpenAI-compatible',
    call: async (context) => {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY not set')
      const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
      const prompt = buildPrompt(context)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are an internal work review assistant. Return concise operational analysis only. Do not invent facts.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 600
          })
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`OpenAI-compatible request failed: ${response.status} ${text.slice(0, 120)}`)
        }
        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content || ''
        return { ok: true, summary: String(content).trim(), provider: 'openai', model }
      } finally {
        clearTimeout(timeout)
      }
    }
  },

  mock: {
    name: 'Mock Provider',
    call: async (context) => {
      const insights = context?.insights || []
      const severityCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      insights.forEach(insight => {
        const sev = parseInt(insight?.severity) || 2
        if (severityCounts[sev] !== undefined) severityCounts[sev]++
      })

      const total = insights.length
      const critical = severityCounts[5] + severityCounts[4]
      const high = severityCounts[3]

      let summary = `Report generated: ${total} insight(s) identified. `
      if (critical > 0) summary += `${critical} critical/high severity item(s) require attention. `
      if (high > 0) summary += `${high} moderate severity item(s) to monitor. `
      summary += 'Recommendations are advisory. No automated actions taken.'

      return {
        ok: true,
        summary,
        provider: 'mock',
        insight_counts: severityCounts,
        rule_based: true
      }
    }
  }
}

function buildPrompt(context) {
  const kind = String((context && context.report_kind) || '').toLowerCase()

  if (kind === 'executive_report') {
    // Structured weekly/monthly executive report. Ollama is asked to return
    // ONLY a JSON object whose keys match AI_SECTIONS in src/lib/reportPdf.js.
    return [
      'You are an enterprise operations analyst for an internal AI management system.',
      'Based ONLY on the provided JSON data, generate a detailed professional management report.',
      '',
      'Strict rules:',
      '- Do not invent facts.',
      '- If a section has no relevant data, write: "Data unavailable for this period."',
      '- Names, scores, counts must be quoted from the JSON exactly.',
      '- Keep each section concise: 2-5 sentences max. No bullet lists.',
      '',
      'Return ONLY a single valid JSON object with these exact keys (all strings):',
      '  executive_summary',
      '  operational_health',
      '  productivity_analysis',
      '  top_performers',
      '  underperforming_members',
      '  overdue_risks',
      '  review_bottlenecks',
      '  proof_quality_summary',
      '  strike_discipline_summary',
      '  department_summary',
      '  recommended_actions',
      '  next_week_priorities',
      '',
      'Do NOT add any commentary or markdown outside the JSON. The JSON value must',
      'be parseable by JSON.parse. No code fences. No explanation.',
      '',
      'Operational data context:',
      JSON.stringify(context || {}, null, 2)
    ].join('\n')
  }

  // Default — short advisory note used by the Phase 11 Executive Note feature.
  return [
    'You are an internal work review assistant. Return concise operational analysis.',
    'Include strengths, delays, blockers, risk flags, and recommended next actions.',
    'Do not invent facts. Use only this JSON context:',
    JSON.stringify(context || {}, null, 2)
  ].join('\n\n')
}

function getProvider() {
  // Explicit override
  const explicit = String(process.env.AI_PROVIDER || '').toLowerCase()
  if (explicit === 'ollama' || explicit === 'openai' || explicit === 'mock') {
    return providers[explicit]
  }
  // Auto-pick: OpenAI-compatible if key present, else Ollama if enabled, else mock.
  if (process.env.OPENAI_API_KEY) return providers.openai
  if (envFlag('ENABLE_AI_ANALYSIS')) return providers.ollama
  return providers.mock
}

function describeMode() {
  // Used by callers (front-end Phase 11 mode pill) to know what to display.
  const p = getProvider()
  if (p === providers.mock) return 'mock'
  if (p === providers.openai) return 'openai'
  return 'ollama'
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' })
  }

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body' })
  }

  const provider = getProvider()
  const isReal = provider !== providers.mock

  try {
    const result = await provider.call(body)
    // For probe requests (front-end mode detection), include the resolved
    // provider key under `provider` so the client can label correctly.
    return json(res, 200, { ...result, provider_mode: describeMode() })
  } catch (error) {
    // Real provider failed — fall back to mock and TAG it. The client uses
    // the `fallback: true` flag to render "Fallback Mode".
    if (isReal) {
      try {
        const fallbackResult = await providers.mock.call(body)
        return json(res, 200, {
          ...fallbackResult,
          fallback: true,
          fallback_from: provider.name,
          fallback_reason: error?.name === 'AbortError'
            ? 'timeout'
            : (error?.message || 'provider error').slice(0, 200),
          provider_mode: describeMode()
        })
      } catch {
        // Fall through to error response.
      }
    }
    return json(res, 200, {
      ok: false,
      ai_enabled: envFlag('ENABLE_AI_ANALYSIS'),
      provider_mode: describeMode(),
      error: error?.name === 'AbortError' ? 'AI analysis timed out' : 'AI analysis unavailable'
    })
  }
}
