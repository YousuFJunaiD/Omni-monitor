const DEFAULT_TIMEOUT_MS = 20000

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Provider abstraction layer
const providers = {
  ollama: {
    name: 'Ollama',
    enabled: () => String(process.env.ENABLE_AI_ANALYSIS || 'false').toLowerCase() === 'true',
    call: async (context) => {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      const model = process.env.OLLAMA_MODEL || 'llama3.1'

      const prompt = [
        'You are an internal work review assistant. Return concise operational analysis.',
        'Include strengths, delays, blockers, risk flags, and recommended next actions.',
        'Do not invent facts. Use only this JSON context:',
        JSON.stringify(context, null, 2)
      ].join('\n\n')

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
        return { ok: true, summary: data.response || '', provider: 'ollama', model }
      } finally {
        clearTimeout(timeout)
      }
    }
  },
  mock: {
    name: 'Mock Provider',
    enabled: () => true,
    call: async (context) => {
      const insights = context.insights || []
      const templateKey = context.template_key || 'weekly_company'

      const severityCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      insights.forEach(insight => {
        const sev = parseInt(insight.severity) || 2
        if (severityCounts[sev] !== undefined) severityCounts[sev]++
      })

      const total = insights.length
      const critical = severityCounts[5] + severityCounts[4]
      const high = severityCounts[3]

      let summary = `Report generated: ${total} insight(s) identified. `
      if (critical > 0) {
        summary += `${critical} critical/high severity item(s) require attention. `
      }
      if (high > 0) {
        summary += `${high} moderate severity item(s) to monitor. `
      }
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

function getProvider() {
  if (String(process.env.ENABLE_AI_ANALYSIS || 'false').toLowerCase() === 'true') {
    return providers.ollama
  }
  return providers.mock
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

  try {
    const result = await provider.call(body)
    return json(res, 200, result)
  } catch (error) {
    if (provider === providers.ollama) {
      try {
        const fallbackResult = await providers.mock.call(body)
        return json(res, 200, { ...fallbackResult, fallback: true })
      } catch {
        // Fall through to error
      }
    }

    return json(res, 200, {
      ok: false,
      ai_enabled: String(process.env.ENABLE_AI_ANALYSIS || 'false').toLowerCase() === 'true',
      error: error?.name === 'AbortError' ? 'AI analysis timed out' : 'AI analysis unavailable'
    })
  }
}