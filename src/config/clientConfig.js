// ─────────────────────────────────────────────────────────────────────────────
// Omni Monitor — Client Configuration
//
// Single source of truth for every client-facing string and branding choice.
//
// DEFAULT: Omnimate.  This file ships with Omnimate's values so the existing
// Omnimate deployment keeps working unchanged. To deploy this product for a
// new client, override the values via VITE_CLIENT_* environment variables —
// no code change required.
//
// Override precedence:
//   1. VITE_CLIENT_<FIELD> env var  →  used at build time by Vite.
//   2. Default below                →  used when no env var is set.
//
// CLIENT_MODE is a positioning marker, not a runtime gate. The current shipped
// mode is 'single_client' — one deployment per customer. SaaS multi-tenant
// (`multi_tenant`) is planned in MULTI_ORG_IMPLEMENTATION_PLAN.md and is NOT
// implemented yet.
//
// What this file does NOT do:
//   • It does not change Supabase data, users, departments, roles, or workflows.
//   • It does not store anything in the database.
//   • It does not gate any RBAC decision.
//   • It is purely UI/strings configuration.
// ─────────────────────────────────────────────────────────────────────────────

const env = (typeof import.meta !== 'undefined' && import.meta?.env) || {}

function pick(envKey, fallback) {
  const v = env[envKey]
  return (v === undefined || v === null || v === '') ? fallback : String(v)
}

function pickBool(envKey, fallback) {
  const v = env[envKey]
  if (v === undefined || v === null || v === '') return fallback
  return String(v).toLowerCase() === 'true'
}

const clientConfig = {
  // ── Deployment mode marker ────────────────────────────────────────────────
  // 'single_client' (default, shipped today) | 'multi_tenant' (planned, not built)
  clientMode: pick('VITE_CLIENT_MODE', 'single_client'),

  // ── Brand identity (client-facing UI strings) ─────────────────────────────
  companyName: pick('VITE_CLIENT_COMPANY_NAME', 'Omnimate'),
  productName: pick('VITE_CLIENT_PRODUCT_NAME', 'Omnimate Monitor'),
  logoMark:    pick('VITE_CLIENT_LOGO_MARK',    'OM'),
  tagline:     pick('VITE_CLIENT_TAGLINE',      'Execution control'),
  appHeading:  pick('VITE_CLIENT_APP_HEADING',  'Execution OS'),

  // Industry positioning. Free-form label visible in the navbar workspace pill.
  // e.g. 'Operations', 'Construction', 'Hospital Ops', 'Sales Team', 'School Admin'.
  industryLabel: pick('VITE_CLIENT_INDUSTRY_LABEL', 'Operations'),
  workspaceLabel: pick('VITE_CLIENT_WORKSPACE_LABEL', 'Operations'),

  // ── AI assistant naming ───────────────────────────────────────────────────
  aiAssistantName: pick('VITE_CLIENT_AI_ASSISTANT_NAME', 'AI Executive'),

  // ── Login + onboarding wording ────────────────────────────────────────────
  loginDescription:    pick('VITE_CLIENT_LOGIN_DESCRIPTION',    'Private workspace for the team.'),
  onboardingMessage:   pick('VITE_CLIENT_ONBOARDING_MESSAGE',   ''),
  emptyDashboardHint:  pick('VITE_CLIENT_EMPTY_DASHBOARD_HINT', 'Create a task to give the team a clear owner, outcome, and next step.'),

  // ── Placeholder text for reserved features ────────────────────────────────
  financePlaceholderText: pick(
    'VITE_CLIENT_FINANCE_PLACEHOLDER',
    'Financial and project tracking is reserved for a future phase. Connect your billing or PM system to populate this card.'
  ),

  // ── Support contact (shown in docs and footer) ────────────────────────────
  supportEmail: pick('VITE_CLIENT_SUPPORT_EMAIL', 'support@omnimate.example'),
  supportUrl:   pick('VITE_CLIENT_SUPPORT_URL',   ''),

  // ── Demo mode ─────────────────────────────────────────────────────────────
  // Set VITE_CLIENT_DEMO_BANNER_TEXT non-empty to render a top-of-app banner
  // labelling the deployment as a demo workspace.
  demoModeLabel:      pick('VITE_CLIENT_DEMO_LABEL',         'Demo workspace'),
  demoModeBannerText: pick('VITE_CLIENT_DEMO_BANNER_TEXT',   ''),

  // ── Departments (display labels) ──────────────────────────────────────────
  // Keys ('frontend', 'backend') match the values returned by user_department()
  // in supabase/round4-task-workflow.sql. To rename more deeply (e.g., add a
  // 'design' department), that requires a SQL change too — out of scope for
  // pure UI config. Use this to relabel what the user SEES.
  //
  // For a non-tech client, common renames: frontend → 'Operations',
  // backend → 'Engineering' (or whatever fits). Pure display.
  defaultDepartments: {
    frontend: pick('VITE_CLIENT_DEPT_FRONTEND_LABEL', 'Frontend'),
    backend:  pick('VITE_CLIENT_DEPT_BACKEND_LABEL',  'Backend')
  },

  // ── Default roles (display labels for the four built-in role values) ──────
  // The role enum in the database is CEO/FOUNDER/BOARD/INTERN. These are the
  // UI display labels. Change them if your client uses different terminology
  // (e.g., CEO → 'Founder', INTERN → 'Team Member', FOUNDER → 'Manager').
  defaultRoles: {
    CEO:     pick('VITE_CLIENT_ROLE_CEO_LABEL',     'CEO'),
    FOUNDER: pick('VITE_CLIENT_ROLE_FOUNDER_LABEL', 'Founder'),
    BOARD:   pick('VITE_CLIENT_ROLE_BOARD_LABEL',   'Board / Dept Head'),
    INTERN:  pick('VITE_CLIENT_ROLE_INTERN_LABEL',  'Intern')
  },

  // ── Footer / copyright ────────────────────────────────────────────────────
  copyrightOwner: pick('VITE_CLIENT_COPYRIGHT_OWNER', 'Omnimate'),

  // ── Feature flags (defaults: off so Omnimate's experience is unchanged) ───
  // Toggle small UX behaviours per client without code changes.
  featureFlags: {
    showDemoBanner: pickBool('VITE_CLIENT_FEATURE_DEMO_BANNER', false),
    requireProofOnSubmit: pickBool('VITE_CLIENT_FEATURE_REQUIRE_PROOF', true)
  }
}

export default clientConfig
// Convenience named export for code that already used BRAND_CONFIG.
// New code should import the default export as `clientConfig`.
export { clientConfig as BRAND_CONFIG }
