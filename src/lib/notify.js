import {createContext, createElement, useCallback, useContext, useMemo, useRef, useState} from 'react'
import Toast from '../components/Toast'

const NotifyContext = createContext(null)

export function NotifyProvider({children}) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismissToast = useCallback(id => {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  const showToast = useCallback(({type = 'success', message}) => {
    if (!message) return

    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
    const duration = type === 'error' ? 5000 : 3000

    setToasts(current => [...current, {id, type, message}])
    timers.current.set(id, window.setTimeout(() => dismissToast(id), duration))
  }, [dismissToast])

  const value = useMemo(() => ({showToast}), [showToast])

  return createElement(
    NotifyContext.Provider,
    {value},
    children,
    createElement(
      'div',
      {className: 'toast-stack', role: 'status', 'aria-live': 'polite'},
      toasts.map(toast => createElement(Toast, {
        key: toast.id,
        message: toast.message,
        type: toast.type
      }))
    )
  )
}

export function useNotify() {
  const context = useContext(NotifyContext)
  if (!context) {
    throw new Error('useNotify must be used within NotifyProvider')
  }

  return context
}
