import {useCallback, useRef, useState} from 'react'

export default function useAsync({minLoadingMs = 180} = {}) {
  const [loading, setLoading] = useState(false)
  const pending = useRef(0)

  const run = useCallback(async task => {
    const startedAt = Date.now()
    pending.current += 1
    setLoading(true)

    try {
      return await task()
    } finally {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, minLoadingMs - elapsed)

      window.setTimeout(() => {
        pending.current -= 1
        if (pending.current <= 0) {
          pending.current = 0
          setLoading(false)
        }
      }, remaining)
    }
  }, [minLoadingMs])

  return {run, loading}
}
