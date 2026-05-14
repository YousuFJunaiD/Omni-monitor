const DEFAULT_TIMEOUT_MS = 20000

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' })
  }

  if (String(process.env.ENABLE_AI_ANALYSIS || 'false').toLowerCase() !== 'true') {
    return json(res, 200, { ok: false, ai_enabled: false, error: 'AI analysis is disabled' })
  }

  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const model = process.env.OLLAMA_MODEL || 'llama3.1'

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const prompt = [
      'You are an internal work review assistant. Return concise operational analysis.',
      'Include strengths, delays, blockers, risk flags, and recommended next actions.',
      'Do not invent facts. Use only this JSON context:',
      JSON.stringify(body.context || body, null, 2)
    ].join('\n\n')

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt, stream: false })
    })

    if (!response.ok) {
      return json(res, 502, { ok: false, ai_enabled: true, error: `Ollama request failed: ${response.status}` })
    }

    const data = await response.json()
    return json(res, 200, { ok: true, ai_enabled: true, summary: data.response || '', model })
  } catch (error) {
    return json(res, 200, {
      ok: false,
      ai_enabled: true,
      error: error?.name === 'AbortError' ? 'AI analysis timed out' : 'AI analysis unavailable'
    })
  } finally {
    clearTimeout(timeout)
  }
}
