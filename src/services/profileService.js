import {callRPC} from './api'
import {getToken} from './authService'

export async function getProfile(userId) {
  return callRPC('get_person_profile', {
    p_token: getToken(),
    p_user_id: userId
  })
}

export async function updateAvatar(dataUrl) {
  return callRPC('update_avatar_rpc', {
    p_token: getToken(),
    p_avatar_data_url: dataUrl
  })
}
