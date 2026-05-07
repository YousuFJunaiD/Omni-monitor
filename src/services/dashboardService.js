import {callRPC} from './api'
import {getToken} from './authService'

let cachedDashboard = null
let pendingRequest = null
let cacheVersion = 0

export async function getDashboard({forceRefresh = false} = {}) {
  if (!forceRefresh && cachedDashboard) {
    return cachedDashboard
  }

  if (!forceRefresh && pendingRequest) {
    return pendingRequest
  }

  const requestVersion = cacheVersion

  pendingRequest = callRPC('get_dashboard', {
    p_token: getToken()
  })
    .then(data => {
      if (cacheVersion === requestVersion) {
        cachedDashboard = data
        pendingRequest = null
      }
      return data
    })
    .catch(err => {
      if (cacheVersion === requestVersion) {
        pendingRequest = null
      }
      throw err
    })

  return pendingRequest
}

export function clearDashboardCache() {
  cacheVersion += 1
  cachedDashboard = null
  pendingRequest = null
}

export function getCachedDashboard() {
  return cachedDashboard
}
