// Extract initials from a name
export function getInitials(name = '') {
  const safeName = typeof name === 'string' ? name : ''
  const parts = safeName.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] || 'O'
  const second = parts.length > 1 ? parts[parts.length - 1][0] : 'M'
  return `${first}${second}`.toUpperCase()
}

// Get avatar tone color based on name hash
export function getAvatarTone(name = '') {
  const safeName = typeof name === 'string' ? name : ''
  const tones = ['tone-a', 'tone-b', 'tone-c', 'tone-d']
  const hash = [...safeName].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[hash % tones.length]
}

// Get status variant for pill
export function getStatusVariant(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('done') || normalized.includes('complete')) return 'approved'
  if (normalized.includes('reject') || normalized.includes('blocked') || normalized.includes('overdue')) return 'rejected'
  if (normalized.includes('progress') || normalized.includes('in progress') || normalized.includes('started')) return 'progress'
  return 'pending'
}

// Get title/role with fallback
export function getTitle(user = {}) {
  return user?.title || roleLabel(user?.role) || 'Team member'
}

export function roleLabel(role) {
  const normalized = String(role || '').trim().toUpperCase()
  if (normalized === 'CEO') return 'CEO'
  if (normalized === 'FOUNDER' || normalized === 'BOARD') return 'Founding Member'
  if (normalized === 'INTERN') return 'Intern'
  return role ? String(role).replace(/_/g, ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase()) : ''
}

// Get user name with fallback
export function getUserName(user = {}) {
  return user?.name || 'Omnimate user'
}

// Get first name for greeting
export function getFirstName(fullName = '') {
  return typeof fullName === 'string' && fullName.trim() ? fullName.trim().split(/\s+/)[0] : 'there'
}

// Convert data URL to bytes for size checking
export function dataUrlBytes(dataUrl) {
  const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] || '' : ''
  return Math.ceil((base64.length * 3) / 4)
}
