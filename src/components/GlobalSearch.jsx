import {Search, X} from 'lucide-react'
import {useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useDashboardContext} from '../context/DashboardContext'

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function taskMatches(task, query) {
  const haystack = [
    task?.title,
    task?.description,
    task?.details,
    task?.status,
    task?.priority,
    task?.assignee?.name,
    task?.assigned_to
  ].map(normalize).join(' ')
  return haystack.includes(query)
}

function userMatches(user, query) {
  return [user?.name, user?.role, user?.title, user?.email].map(normalize).join(' ').includes(query)
}

function ideaMatches(idea, query) {
  return [idea?.title, idea?.name, idea?.description, idea?.summary].map(normalize).join(' ').includes(query)
}

export default function GlobalSearch({onOpenTask}) {
  const {tasks, visibleUsers, ideas, loading} = useDashboardContext()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const deferredQuery = useDeferredValue(query)
  const safeQuery = normalize(deferredQuery)
  const pending = query !== deferredQuery

  const results = useMemo(() => {
    if (!safeQuery) return {tasks: [], users: [], ideas: []}
    return {
      tasks: (Array.isArray(tasks) ? tasks : []).filter(task => taskMatches(task, safeQuery)).slice(0, 5),
      users: (Array.isArray(visibleUsers) ? visibleUsers : []).filter(user => userMatches(user, safeQuery)).slice(0, 4),
      ideas: (Array.isArray(ideas) ? ideas : []).filter(idea => ideaMatches(idea, safeQuery)).slice(0, 4)
    }
  }, [ideas, safeQuery, tasks, visibleUsers])

  const resultCount = results.tasks.length + results.users.length + results.ideas.length

  useEffect(() => {
    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (event.key === 'Escape') setOpen(false)
    }

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  function clearSearch() {
    setQuery('')
    setOpen(false)
  }

  function openTask(task) {
    onOpenTask?.(task)
    setOpen(false)
  }

  function openRoute(path) {
    navigate(path)
    setOpen(false)
  }

  return (
    <div className="global-search" ref={rootRef}>
      <Search size={17} aria-hidden="true" />
      <input
        aria-label="Search tasks, users, and ideas"
        ref={inputRef}
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search work"
      />
      {query ? (
        <button className="search-clear" type="button" aria-label="Clear search" onClick={clearSearch}>
          <X size={14} />
        </button>
      ) : (
        <span className="search-key" aria-hidden="true">Ctrl K</span>
      )}
      {open && safeQuery && (
        <div className="search-panel" role="listbox" aria-label="Search results">
          {loading || pending ? (
            <div className="search-state">Loading workspace...</div>
          ) : resultCount === 0 ? (
            <div className="search-state">No matching tasks, users, or ideas.</div>
          ) : (
            <>
              {results.tasks.length > 0 && (
                <section className="search-group">
                  <h3>Tasks</h3>
                  {results.tasks.map(task => (
                    <button key={task.id || task.title} type="button" onClick={() => openTask(task)}>
                      <span>{task.title || 'Untitled task'}</span>
                      <small>{task.assignee?.name || task.assigned_to || 'Unassigned'} - {task.status || 'TODO'}</small>
                    </button>
                  ))}
                </section>
              )}
              {results.users.length > 0 && (
                <section className="search-group">
                  <h3>Users</h3>
                  {results.users.map(user => (
                    <button key={user.id || user.name} type="button" onClick={() => openRoute('/team')}>
                      <span>{user.name || 'Team member'}</span>
                      <small>{user.title || user.role || 'Contributor'}</small>
                    </button>
                  ))}
                </section>
              )}
              {results.ideas.length > 0 && (
                <section className="search-group">
                  <h3>Ideas</h3>
                  {results.ideas.map(idea => (
                    <button key={idea.id || idea.title || idea.name} type="button" onClick={() => openRoute('/ideas')}>
                      <span>{idea.title || idea.name || 'Untitled idea'}</span>
                      <small>{idea.summary || idea.description || 'Idea board'}</small>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
