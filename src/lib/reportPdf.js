// Professional PDF report generation for Omni Monitor.
//
// Two flavours:
//   • generateMetricsReportPdf(...) — rule-based weekly/monthly report.
//   • generateAiReportPdf(...)      — AI-enhanced report with structured sections.
//
// Both download a single-file PDF locally in the browser. No server roundtrip.
// Branding comes from clientConfig (so the same code white-labels for any client).
//
// Layout principles:
//   - Letter-sized portrait, 1-inch margins.
//   - Single accent color sourced from the CSS variable so it matches the app.
//   - Each section has a heading + a tight body. No flashy gradients.
//   - autotable for any tabular data; otherwise plain text wrapped to 80 cols.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import clientConfig from '../config/clientConfig.js'

// ── Layout constants ────────────────────────────────────────────────────────
const PAGE_MARGIN_X = 56          // 0.78"
const PAGE_MARGIN_TOP = 56
const COLOR_TEXT = [17, 24, 39]   // var(--text)
const COLOR_MUTED = [100, 116, 139]
const COLOR_ACCENT = [37, 99, 235] // var(--accent)
const COLOR_DANGER = [220, 38, 38]
const COLOR_BORDER = [226, 232, 240]

function setText(doc, color = COLOR_TEXT) {
  doc.setTextColor(color[0], color[1], color[2])
}

function setFill(doc, color) {
  doc.setFillColor(color[0], color[1], color[2])
}

function setDraw(doc, color) {
  doc.setDrawColor(color[0], color[1], color[2])
}

// Draw the running header on every page after the cover.
function drawPageChrome(doc, opts) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    // Top-left product name
    setText(doc, COLOR_MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(opts.productName, PAGE_MARGIN_X, 28)
    // Top-right report title
    doc.text(opts.reportTitle, pageW - PAGE_MARGIN_X, 28, { align: 'right' })
    // Top border
    setDraw(doc, COLOR_BORDER)
    doc.setLineWidth(0.5)
    doc.line(PAGE_MARGIN_X, 36, pageW - PAGE_MARGIN_X, 36)
    // Footer
    doc.setFontSize(8)
    setText(doc, COLOR_MUTED)
    doc.text(
      `${opts.companyName} · Generated ${opts.generatedAt} · Page ${i} of ${total}`,
      pageW / 2,
      pageH - 24,
      { align: 'center' }
    )
  }
  doc.setPage(total)
  setText(doc, COLOR_TEXT)
}

// Drawing helpers used by both report types -------------------------------

function drawCover(doc, opts) {
  const pageW = doc.internal.pageSize.getWidth()
  let y = PAGE_MARGIN_TOP + 16

  // Accent bar
  setFill(doc, COLOR_ACCENT)
  doc.rect(PAGE_MARGIN_X, y, 36, 4, 'F')
  y += 22

  // Eyebrow
  setText(doc, COLOR_MUTED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(opts.eyebrow.toUpperCase(), PAGE_MARGIN_X, y)
  y += 22

  // Title
  setText(doc, COLOR_TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.text(opts.reportTitle, PAGE_MARGIN_X, y)
  y += 14

  // Period subtitle
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  setText(doc, COLOR_MUTED)
  doc.text(opts.period, PAGE_MARGIN_X, y)
  y += 30

  // Mode + meta line
  doc.setFontSize(10)
  setText(doc, COLOR_MUTED)
  doc.text(`AI mode: ${opts.aiModeLabel}`, PAGE_MARGIN_X, y)
  doc.text(`Generated: ${opts.generatedAt}`, pageW - PAGE_MARGIN_X, y, { align: 'right' })

  return y + 16
}

function drawHeading(doc, text, y) {
  setText(doc, COLOR_TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(text, PAGE_MARGIN_X, y)
  setDraw(doc, COLOR_ACCENT)
  doc.setLineWidth(1.2)
  doc.line(PAGE_MARGIN_X, y + 4, PAGE_MARGIN_X + 32, y + 4)
  return y + 18
}

function drawParagraph(doc, text, y, opts = {}) {
  if (!text) return y
  const pageW = doc.internal.pageSize.getWidth()
  const maxWidth = pageW - PAGE_MARGIN_X * 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(opts.fontSize || 10.5)
  setText(doc, opts.color || COLOR_TEXT)
  const lines = doc.splitTextToSize(String(text), maxWidth)
  doc.text(lines, PAGE_MARGIN_X, y)
  return y + lines.length * (opts.lineHeight || 14)
}

function ensureRoom(doc, y, needed = 80) {
  const pageH = doc.internal.pageSize.getHeight()
  if (y + needed > pageH - 48) {
    doc.addPage()
    return PAGE_MARGIN_TOP
  }
  return y
}

function drawMetricsGrid(doc, items, y) {
  // items = [{ label, value }]
  const pageW = doc.internal.pageSize.getWidth()
  const cols = 3
  const gap = 12
  const cardW = (pageW - PAGE_MARGIN_X * 2 - gap * (cols - 1)) / cols
  const cardH = 56
  items.forEach((it, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = PAGE_MARGIN_X + col * (cardW + gap)
    const cy = y + row * (cardH + gap)
    setDraw(doc, COLOR_BORDER)
    doc.setLineWidth(0.6)
    doc.roundedRect(x, cy, cardW, cardH, 6, 6, 'S')
    setText(doc, COLOR_MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(String(it.label).toUpperCase(), x + 12, cy + 18)
    setText(doc, COLOR_TEXT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text(String(it.value ?? '—'), x + 12, cy + 40)
  })
  const rows = Math.ceil(items.length / cols)
  return y + rows * (cardH + gap)
}

// ── Public: metrics-only report PDF (Weekly / Monthly) ──────────────────────

export function generateMetricsReportPdf(report, opts = {}) {
  // `report` is the payload returned by get_report_rpc.
  const period = String(report?.period || opts.period || 'weekly')
  const isMonthly = period === 'monthly'
  const periodLabel = isMonthly ? 'Monthly' : 'Weekly'

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const chrome = {
    productName: clientConfig.productName,
    companyName: clientConfig.companyName,
    reportTitle: `${periodLabel} Operations Report`,
    generatedAt: new Date().toLocaleString()
  }

  // Cover
  let y = drawCover(doc, {
    eyebrow: 'Operations Report',
    reportTitle: chrome.reportTitle,
    period: `${periodLabel} reporting period · ${new Date().toLocaleDateString()}`,
    aiModeLabel: opts.aiModeLabel || 'Rule-based',
    generatedAt: chrome.generatedAt
  })

  // Top performers
  if (report?.best_founder || report?.best_intern) {
    y = ensureRoom(doc, y, 120)
    y = drawHeading(doc, 'Top performers', y + 18)
    const topItems = []
    if (report?.best_founder) topItems.push({ label: 'Best founder', value: report.best_founder.name || '—' })
    if (report?.best_intern) topItems.push({ label: 'Best intern', value: report.best_intern.name || '—' })
    if (report?.best_founder) topItems.push({ label: 'Founder score', value: report.best_founder.score ?? '—' })
    if (report?.best_intern) topItems.push({ label: 'Intern score', value: report.best_intern.score ?? '—' })
    y = drawMetricsGrid(doc, topItems, y + 8)
  }

  // Full leaderboard table
  const rows = Array.isArray(report?.rows) ? report.rows : []
  if (rows.length) {
    y = ensureRoom(doc, y, 140)
    y = drawHeading(doc, 'Team leaderboard', y + 24)
    autoTable(doc, {
      startY: y + 6,
      head: [['Name', 'Role', 'Title', 'Score', 'Assigned', 'Completed', 'Proofs', 'Minutes']],
      body: rows.map(r => [
        r?.name || '—',
        r?.role || '—',
        r?.title || '—',
        r?.score ?? 0,
        r?.tasks_assigned ?? 0,
        r?.completed ?? 0,
        r?.proof_count ?? 0,
        r?.minutes ?? 0
      ]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4, textColor: COLOR_TEXT },
      headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X }
    })
    y = doc.lastAutoTable.finalY
  }

  // Footer + page numbers
  drawPageChrome(doc, chrome)

  return doc
}

// ── Public: AI-enhanced report PDF (Weekly AI / Monthly AI) ─────────────────

// AI sections rendered in this order, with this display label.
const AI_SECTIONS = [
  ['executive_summary',         'Executive Summary'],
  ['operational_health',        'Operational Health'],
  ['productivity_analysis',     'Productivity Analysis'],
  ['top_performers',            'Top Performers'],
  ['underperforming_members',   'Underperforming or Inactive Members'],
  ['overdue_risks',             'Overdue Risk'],
  ['review_bottlenecks',        'Review Bottlenecks'],
  ['proof_quality_summary',     'Proof Submission Quality'],
  ['strike_discipline_summary', 'Strike & Discipline Summary'],
  ['department_summary',        'Department-wise Summary'],
  ['recommended_actions',       'Recommended Actions'],
  ['next_week_priorities',      'Next Week Priorities']
]

export function generateAiReportPdf(payload, opts = {}) {
  // payload may contain:
  //   payload.context  → the structured metrics the AI saw (always present)
  //   payload.sections → object keyed by AI_SECTIONS keys (when AI returned structured JSON)
  //   payload.rawText  → the AI's raw text (used when structured JSON parse failed)
  //   payload.report   → the persisted ai_reports row from generate_ai_report_rpc
  //   opts.aiModeLabel → 'Ollama' / 'OpenAI' / 'Fallback' / 'Rule-based'
  //   opts.period      → 'weekly' / 'monthly'

  const period = String(opts.period || payload?.context?.period || 'weekly')
  const isMonthly = period === 'monthly'
  const periodLabel = isMonthly ? 'Monthly' : 'Weekly'

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const chrome = {
    productName: clientConfig.productName,
    companyName: clientConfig.companyName,
    reportTitle: `${periodLabel} AI Executive Report`,
    generatedAt: new Date().toLocaleString()
  }

  let y = drawCover(doc, {
    eyebrow: 'AI Executive Report',
    reportTitle: chrome.reportTitle,
    period: `${periodLabel} reporting period · ${new Date().toLocaleDateString()}`,
    aiModeLabel: opts.aiModeLabel || 'Rule-based',
    generatedAt: chrome.generatedAt
  })

  // Key metrics grid (from context)
  const ctx = payload?.context || {}
  const keyItems = []
  if (typeof ctx.completed_tasks === 'number') keyItems.push({ label: 'Tasks completed', value: ctx.completed_tasks })
  if (typeof ctx.open_tasks === 'number')      keyItems.push({ label: 'Tasks open',      value: ctx.open_tasks })
  if (typeof ctx.overdue_tasks === 'number')   keyItems.push({ label: 'Overdue',         value: ctx.overdue_tasks })
  if (typeof ctx.tasks_under_review === 'number') keyItems.push({ label: 'In review',    value: ctx.tasks_under_review })
  if (typeof ctx.blocked_tasks === 'number')   keyItems.push({ label: 'Blocked',         value: ctx.blocked_tasks })
  if (typeof ctx.proof_submissions === 'number') keyItems.push({ label: 'Proofs',        value: ctx.proof_submissions })
  if (typeof ctx.total_strikes === 'number')   keyItems.push({ label: 'Strikes total',   value: ctx.total_strikes })
  if (typeof ctx.inactive_members === 'number') keyItems.push({ label: 'Inactive',       value: ctx.inactive_members })
  if (typeof ctx.active_users === 'number')    keyItems.push({ label: 'Active users',    value: ctx.active_users })
  if (keyItems.length) {
    y = ensureRoom(doc, y, 180)
    y = drawHeading(doc, 'Key metrics', y + 18)
    y = drawMetricsGrid(doc, keyItems, y + 8)
  }

  // Structured AI sections — preferred
  const sections = payload?.sections || {}
  const hasStructured = Object.keys(sections).some(k => sections[k])

  if (hasStructured) {
    for (const [key, label] of AI_SECTIONS) {
      const content = sections[key]
      if (!content) continue
      y = ensureRoom(doc, y, 60)
      y = drawHeading(doc, label, y + 24)
      y = drawParagraph(doc, content, y + 6)
    }
  } else if (payload?.rawText) {
    // Fallback: dump the AI's free-form text as a single section.
    y = ensureRoom(doc, y, 100)
    y = drawHeading(doc, 'AI analysis', y + 24)
    y = drawParagraph(doc, payload.rawText, y + 6)
  } else {
    // No AI content at all — emit a rule-based mode note.
    y = ensureRoom(doc, y, 100)
    y = drawHeading(doc, 'Analysis', y + 24)
    y = drawParagraph(
      doc,
      'Rule-based analysis generated from operational data. The configured AI provider was not reached for this report; switching ENABLE_AI_ANALYSIS=true and pointing OLLAMA_BASE_URL at a reachable Ollama instance will surface a structured executive narrative here.',
      y + 6
    )
  }

  // Leaderboard tables — top founders, top interns — from context
  const founders = Array.isArray(ctx?.rankings?.founders) ? ctx.rankings.founders.slice(0, 10) : []
  const interns  = Array.isArray(ctx?.rankings?.interns)  ? ctx.rankings.interns.slice(0, 10)  : []
  if (founders.length) {
    y = ensureRoom(doc, y, 140)
    y = drawHeading(doc, 'Top founders', y + 24)
    autoTable(doc, {
      startY: y + 6,
      head: [['#', 'Name', 'Title', 'Score', 'Strikes']],
      body: founders.map((r, i) => [i + 1, r?.name || '—', r?.title || '—', r?.score ?? 0, r?.strikes ?? 0]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X }
    })
    y = doc.lastAutoTable.finalY
  }
  if (interns.length) {
    y = ensureRoom(doc, y, 140)
    y = drawHeading(doc, 'Top interns', y + 24)
    autoTable(doc, {
      startY: y + 6,
      head: [['#', 'Name', 'Title', 'Score', 'Strikes']],
      body: interns.map((r, i) => [i + 1, r?.name || '—', r?.title || '—', r?.score ?? 0, r?.strikes ?? 0]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X }
    })
    y = doc.lastAutoTable.finalY
  }

  // Page chrome (header / footer / page numbers)
  drawPageChrome(doc, chrome)

  return doc
}

// ── Public: filename helpers ────────────────────────────────────────────────

export function downloadPdf(doc, filename) {
  doc.save(filename)
}

export function reportFilename(kind, period) {
  const slug = clientConfig.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const date = new Date().toISOString().slice(0, 10)
  return `${slug}-${period}-${kind}-${date}.pdf`
}
