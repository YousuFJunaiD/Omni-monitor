import {useCallback, useEffect, useMemo, useState} from 'react'
import useAsync from './useAsync'
import {getCachedDashboard, getDashboard} from '../services/dashboardService'

export default function useDashboard({showToast} = {}) {
  const initialDashboard = useMemo(() => getCachedDashboard(), [])
  const [dashboard, setDashboard] = useState(initialDashboard)
  const [error, setError] = useState('')
  const {run, loading} = useAsync({minLoadingMs: 200})

  const loadDashboard = useCallback(async () => {
    setError('')
    const result = await getDashboard()
    setDashboard(result)
    return result
  }, [])

  useEffect(() => {
    if (dashboard) {
      return
    }

    let active = true
    run(async () => {
      try {
        const result = await loadDashboard()
        if (!active) return
        setDashboard(result)
      } catch (err) {
        if (!active) return
        setError(err.message)
        if (showToast) {
          showToast({type: 'error', message: err.message})
        }
      }
    }).catch(() => {
      // handled above
    })

    return () => {
      active = false
    }
  }, [dashboard, loadDashboard, run, showToast])

  const refreshDashboard = useCallback(async () => {
    setError('')
    const result = await getDashboard({forceRefresh: true})
    setDashboard(result)
    return result
  }, [])

  return {dashboard, loading, error, refreshDashboard}
}
