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
  // items = [{ label, value }] — numbers only. Long strings should use
  // drawTopPerformerCards instead.
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
    // Defensive: truncate to fit within card width to avoid spilling into
    // the next card (the overlap bug fix). 18pt fits ~10–11 wide chars.
    const valueStr = String(it.value ?? '—')
    const truncated = valueStr.length > 12 ? valueStr.slice(0, 11) + '…' : valueStr
    doc.text(truncated, x + 12, cy + 40)
  })
  const rows = Math.ceil(items.length / cols)
  return y + rows * (cardH + gap)
}

// Phase 15: top-performer cards use a taller layout so long names don't
// overflow into adjacent cards. Two cards per row, each with name + score
// stacked vertically.
function drawTopPerformerCards(doc, items, y) {
  // items = [{ label, name, scoreLabel, scoreValue, accent }]
  if (!items || !items.length) return y
  const pageW = doc.internal.pageSize.getWidth()
  const gap = 14
  const cardW = (pageW - PAGE_MARGIN_X * 2 - gap) / 2
  const cardH = 88
  items.forEach((it, idx) => {
    const col = idx % 2
    const row = Math.floor(idx / 2)
    const x = PAGE_MARGIN_X + col * (cardW + gap)
    const cy = y + row * (cardH + gap)
    setDraw(doc, COLOR_BORDER)
    doc.setLineWidth(0.6)
    doc.roundedRect(x, cy, cardW, cardH, 8, 8, 'S')
    // Accent bar
    setFill(doc, it.accent || COLOR_ACCENT)
    doc.roundedRect(x, cy, 4, cardH, 2, 2, 'F')
    // Label
    setText(doc, COLOR_MUTED)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(String(it.label).toUpperCase(), x + 16, cy + 20)
    // Name (wrap if needed)
    setText(doc, COLOR_TEXT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    const nameLines = doc.splitTextToSize(String(it.name || '—'), cardW - 28)
    doc.text(nameLines.slice(0, 2), x + 16, cy + 40)
    // Score below name
    setText(doc, COLOR_MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`${it.scoreLabel}: ${it.scoreValue ?? '—'}`, x + 16, cy + 74)
  })
  const rows = Math.ceil(items.length / 2)
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

  // Top performers — Phase 15 layout: name + score stacked in a tall card
  // so long names don't overflow into the adjacent card.
  if (report?.best_founder || report?.best_intern) {
    y = ensureRoom(doc, y, 130)
    y = drawHeading(doc, 'Top performers', y + 18)
    const topItems = []
    if (report?.best_founder) topItems.push({
      label: 'Best founder',
      name: report.best_founder.name || '—',
      scoreLabel: 'Score',
      scoreValue: report.best_founder.score ?? '—',
      accent: COLOR_ACCENT
    })
    if (report?.best_intern) topItems.push({
      label: 'Best intern',
      name: report.best_intern.name || '—',
      scoreLabel: 'Score',
      scoreValue: report.best_intern.score ?? '—',
      accent: COLOR_ACCENT
    })
    y = drawTopPerformerCards(doc, topItems, y + 8)
  }

  // Full leaderboard table
  const rows = Array.isArray(report?.rows) ? report.rows : []
  const STRIKE_PENALTY = 70
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

  // Phase 15: Strike & Discipline Summary in the metrics-only PDF too.
  // `rows` from get_report_rpc doesn't include strike count per user, so we
  // surface the policy statement plus a sentence on aggregate impact. The
  // AI report PDF carries the detailed per-user strike table.
  y = ensureRoom(doc, y, 100)
  y = drawHeading(doc, 'Strike & Discipline Summary', y + 24)
  setText(doc, COLOR_DANGER)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Strike policy: each strike subtracts ${STRIKE_PENALTY} points from the assignee's score.`, PAGE_MARGIN_X, y + 6)
  y += 14
  setText(doc, COLOR_TEXT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  y = drawParagraph(
    doc,
    'Repeated strikes heavily reduce a member\'s performance score. Review members with three or more strikes ' +
    'this period and consider a discipline conversation. For per-user strike counts and impact, run the AI Executive Report.',
    y + 10
  )

  // Footer + page numbers
  drawPageChrome(doc, chrome)

  return doc
}

// ── Public: AI-enhanced report PDF (Weekly AI / Monthly AI) ─────────────────

// Phase 16: AI sections rendered in strike-first priority order.
// Discipline first, then delivered work, then workload context, THEN score —
// matching the project rule that score is the least important of the four.
const AI_SECTIONS = [
  ['executive_summary',         'Executive Summary'],
  ['strike_discipline_summary', 'Strike & Discipline Summary'],
  ['task_completion_summary',   'Task Completion Summary'],
  ['assigned_workload_summary', 'Assigned Workload Summary'],
  ['operational_health',        'Operational Health'],
  ['productivity_analysis',     'Productivity Analysis'],
  ['top_performers',            'Top Performers'],
  ['underperforming_members',   'Underperforming or Inactive Members'],
  ['overdue_risks',             'Overdue Risk'],
  ['review_bottlenecks',        'Review Bottlenecks'],
  ['proof_quality_summary',     'Proof Submission Quality'],
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

  // Leaderboard tables — top founders, top interns — from context.
  // Phase 15: switched to a Score Breakdown view that exposes the underlying
  // components when the rich rankings (from get_rankings_rpc) are present.
  // The Strike Penalty column uses the new ×70 multiplier and is highlighted.
  const STRIKE_PENALTY = 70

  const founders = Array.isArray(ctx?.rankings?.founders) ? ctx.rankings.founders.slice(0, 10) : []
  const interns  = Array.isArray(ctx?.rankings?.interns)  ? ctx.rankings.interns.slice(0, 10)  : []

  // Helper: turn one ranking row into a breakdown row. Numbers are read
  // from real fields; missing fields render "—" rather than being invented.
  function breakdownRow(r, idx) {
    const strikes = Number(r?.strikes || 0)
    const strikePenalty = strikes * STRIKE_PENALTY
    return {
      cells: [
        idx + 1,
        r?.name || '—',
        r?.title || '—',
        Number(r?.done ?? 0),
        r?.submissions !== undefined ? Number(r.submissions) : '—',
        r?.overdue !== undefined ? Number(r.overdue) : '—',
        strikes,
        `-${strikePenalty}`,
        Number(r?.score ?? 0)
      ],
      strikes
    }
  }

  function drawBreakdownTable(rows, title) {
    if (!rows.length) return
    y = ensureRoom(doc, y, 160)
    y = drawHeading(doc, title, y + 24)
    const built = rows.map((r, i) => breakdownRow(r, i))
    autoTable(doc, {
      startY: y + 6,
      head: [['#', 'Name', 'Title', 'Done', 'Proofs', 'Overdue', 'Strikes', 'Strike −70 ea', 'Score']],
      body: built.map(b => b.cells),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
      didParseCell(data) {
        // Highlight the Strike Penalty column in red when non-zero.
        if (data.section === 'body' && data.column.index === 7) {
          const v = data.cell.text?.[0]
          if (v && v !== '-0') {
            data.cell.styles.textColor = COLOR_DANGER
            data.cell.styles.fontStyle = 'bold'
          }
        }
        // Bold the strikes count too when >0.
        if (data.section === 'body' && data.column.index === 6) {
          const n = Number(data.cell.text?.[0])
          if (n > 0) data.cell.styles.fontStyle = 'bold'
        }
      }
    })
    y = doc.lastAutoTable.finalY
  }

  // Phase 16: post-narrative block ordering matches the project's analysis
  // priority — strikes/discipline first, then delivered work, then workload,
  // THEN scores. Score breakdown tables are deliberately the LAST per-user
  // detail block before the page chrome.

  // 1) Strike & Discipline Summary — most important. Always rendered.
  const allRank = [...founders, ...interns]
  const offenders = allRank
    .map(r => ({ ...r, strikes: Number(r?.strikes || 0) }))
    .filter(r => r.strikes > 0)
    .sort((a, b) => b.strikes - a.strikes)
    .slice(0, 10)
  const totalStrikes = ctx?.strike_summary?.total_strikes ?? offenders.reduce((s, r) => s + r.strikes, 0)
  const totalPenalty = totalStrikes * STRIKE_PENALTY

  y = ensureRoom(doc, y, 200)
  y = drawHeading(doc, 'Strike & Discipline Summary', y + 24)

  setText(doc, COLOR_DANGER)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Strike policy: each strike subtracts ${STRIKE_PENALTY} points from the assignee's score.`, PAGE_MARGIN_X, y + 6)
  y += 14
  setText(doc, COLOR_TEXT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  const summaryLines = [
    `Total active strikes in workspace: ${totalStrikes}.`,
    `Aggregate score impact this period: −${totalPenalty} points.`,
    offenders.length
      ? `${offenders.length} member${offenders.length === 1 ? ' has' : 's have'} one or more strikes.`
      : 'No members currently have strikes.',
    'Repeated strikes heavily reduce performance score and should trigger a discipline conversation.'
  ]
  for (const line of summaryLines) {
    y = drawParagraph(doc, line, y + 10)
  }

  if (offenders.length) {
    y = ensureRoom(doc, y, 140)
    autoTable(doc, {
      startY: y + 12,
      head: [['#', 'Name', 'Role', 'Title', 'Strikes', 'Score impact']],
      body: offenders.map((r, i) => [
        i + 1, r.name || '—', r.role || '—', r.title || '—', r.strikes, `-${r.strikes * STRIKE_PENALTY}`
      ]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: COLOR_DANGER, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [254, 226, 226] },
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
      didParseCell(data) {
        if (data.section === 'body' && (data.column.index === 4 || data.column.index === 5)) {
          data.cell.styles.textColor = COLOR_DANGER
          data.cell.styles.fontStyle = 'bold'
        }
      }
    })
    y = doc.lastAutoTable.finalY
    y = drawParagraph(
      doc,
      'Recommended action: review the highest-strike members with their department lead. ' +
      'Strikes accumulating past 3 should trigger an immediate conversation; past 5 is escalation territory.',
      y + 14,
      { color: COLOR_TEXT }
    )
  }

  // 2) Task Completion Summary — second priority. Reads from rich rankings.
  if (founders.length || interns.length) {
    y = ensureRoom(doc, y, 160)
    y = drawHeading(doc, 'Task Completion Summary', y + 24)
    const completionRows = [...founders, ...interns]
      .map(r => ({ ...r, done: Number(r?.done || 0) }))
      .sort((a, b) => b.done - a.done)
      .slice(0, 10)
    if (completionRows.length) {
      autoTable(doc, {
        startY: y + 6,
        head: [['#', 'Name', 'Role', 'Title', 'Tasks done']],
        body: completionRows.map((r, i) => [i + 1, r.name || '—', r.role || '—', r.title || '—', r.done]),
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X }
      })
      y = doc.lastAutoTable.finalY
    }
  }

  // 3) Assigned Workload Summary — third priority. `total` is the per-user
  // assigned-task count returned by get_rankings_rpc.
  if (founders.length || interns.length) {
    y = ensureRoom(doc, y, 160)
    y = drawHeading(doc, 'Assigned Workload Summary', y + 24)
    const workloadRows = [...founders, ...interns]
      .map(r => ({
        ...r,
        total: Number(r?.total || 0),
        done: Number(r?.done || 0),
        completion_pct: Number(r?.total || 0) > 0 ? Math.round((Number(r?.done || 0) / Number(r?.total || 0)) * 100) : 0
      }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
    if (workloadRows.length) {
      autoTable(doc, {
        startY: y + 6,
        head: [['#', 'Name', 'Title', 'Assigned', 'Done', 'Completion %']],
        body: workloadRows.map((r, i) => [i + 1, r.name || '—', r.title || '—', r.total, r.done, `${r.completion_pct}%`]),
        theme: 'striped',
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: COLOR_ACCENT, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X }
      })
      y = doc.lastAutoTable.finalY
    } else {
      y = drawParagraph(doc, 'No assignments recorded for this period.', y + 6, { color: COLOR_MUTED })
    }
  }

  // 4) Final Scores / Score Breakdown — LEAST important; rendered last.
  drawBreakdownTable(founders, 'Founder score breakdown')
  drawBreakdownTable(interns, 'Intern score breakdown')

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
