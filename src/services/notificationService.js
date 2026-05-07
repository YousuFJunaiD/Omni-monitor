import {callRPC} from './api'
import {getToken} from './authService'

export async function getNotifications(limit = 30) {
  return callRPC('get_notifications', {
    p_token: getToken(),
    p_limit: limit,
    p_include_read: false
  })
}

export async function markRead(id) {
  return callRPC('mark_notification_read_rpc', {
    p_token: getToken(),
    p_notification_id: id
  })
}

export async function markAllRead() {
  return callRPC('mark_all_notifications_read_rpc', {
    p_token: getToken()
  })
}

export async function dismissNotification(id) {
  return callRPC('dismiss_notification_rpc', {
    p_token: getToken(),
    p_notification_id: id
  })
}
