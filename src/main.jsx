import React, {useEffect, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CheckCircle,
  ClipboardList,
  Download,
  LogOut,
  Plus,
  Send,
  Trophy,
  Trash2,
  Upload,
  Users
} from 'lucide-react'
import {supabase, supabaseReady} from './supabase'
import './styles.css'

const TOKEN_KEY='omnimate_session_token'
const LEGACY_TOKEN_KEY='omnimart_session_token'
const emptyDash={me:null,visible_users:[],tasks:[],founder_ranking:[],intern_ranking:[],proof_feed:[]}

async function rpc(name,args){
  if(!supabaseReady) throw new Error('Add Supabase URL and anon key in .env.local')
  const {data,error}=await supabase.rpc(name,args)
  if(error) throw error
  if(data?.ok===false) throw new Error(data.error || 'Request failed')
  return data
}
function downloadJson(name,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href)
}
function readFileAsDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
function isOverdue(task){return task.due_date && task.status!=='DONE' && new Date(`${task.due_date}T23:59:59`) < new Date()}
function niceDate(date){return date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'No deadline'}
function displayRole(role){
  if(role==='CEO') return 'CEO • FOUNDER'
  if(role==='FOUNDER') return 'FOUNDING MEMBER'
  return role || ''
}

function Login({onLogin}){
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState('')
  const [err,setErr]=useState('')
  const [loading,setLoading]=useState(false)
  async function submit(e){
    e.preventDefault(); setErr(''); setLoading(true)
    try{
      const data=await rpc('login_user',{p_username:username,p_password:password})
      localStorage.setItem(TOKEN_KEY,data.token); localStorage.removeItem(LEGACY_TOKEN_KEY); onLogin(data.token)
    }catch(ex){setErr(ex.message)}finally{setLoading(false)}
  }
  return <div className="login"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">OM</div>
    <h1>Omnimate Monitor</h1>
    <p className="muted">Private workspace access for assigned team members.</p>
    {!supabaseReady&&<div className="notice">Add your Supabase keys in <b>.env.local</b> first.</div>}
    <label>Username</label>
    <input className="input" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="Enter username" autoComplete="username" />
    <label>Password</label>
    <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" />
    {err&&<p className="error">{err}</p>}
    <button className="btn primary" disabled={loading}>{loading?'Logging in...':'Login'}</button>
  </form></div>
}

function App(){
  const [token,setToken]=useState(localStorage.getItem(TOKEN_KEY)||localStorage.getItem(LEGACY_TOKEN_KEY)||'')
  const [dash,setDash]=useState(emptyDash)
  const [err,setErr]=useState('')
  const [loading,setLoading]=useState(false)
  const [toast,setToast]=useState(null)
  async function load(){
    if(!token)return
    setLoading(true); setErr('')
    try{setDash(await rpc('get_dashboard',{p_token:token}))}
    catch(ex){setErr(ex.message); localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(LEGACY_TOKEN_KEY); setToken('')}
    finally{setLoading(false)}
  }
  function notify(message,type='success'){setToast({message,type}); window.clearTimeout(notify.t); notify.t=window.setTimeout(()=>setToast(null),3200)}
  useEffect(()=>{load()},[token])
  async function logout(){try{await rpc('logout_user',{p_token:token})}catch{} localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(LEGACY_TOKEN_KEY); setToken(''); setDash(emptyDash)}
  if(!token) return <Login onLogin={setToken}/>
  return <>
    <Dashboard token={token} dash={dash} reload={load} logout={logout} err={err} loading={loading} notify={notify}/>
    {toast&&<div className={`toast ${toast.type}`}>{toast.message}</div>}
  </>
}

function Dashboard({token,dash,reload,logout,err,loading,notify}){
 const me=dash.me||{}
 const tasks=dash.tasks||[]
 const people=dash.visible_users||[]
 const [newTaskId,setNewTaskId]=useState('')
 const completed=tasks.filter(t=>t.status==='DONE').length
 const overdue=tasks.filter(isOverdue).length
 const topScore=Math.max(0,...[...(dash.founder_ranking||[]),...(dash.intern_ranking||[])].map(r=>r.score||0))
 const strikes=people.reduce((sum,u)=>sum+(u.strikes||0),0)
 return <div className="app">
  <header className="top">
    <div><p className="eyebrow">Team operations</p><h1>Omnimate Monitor</h1><p className="muted">{me.name} · {me.title} · {displayRole(me.role)}</p></div>
    <button className="btn ghost" onClick={logout}><LogOut size={18}/> Logout</button>
  </header>
  {err&&<div className="notice errorNotice">{err}</div>}{loading&&<p className="loading">Refreshing dashboard...</p>}
  <section className="section">
    <div className="section-title"><h2>Overview</h2></div>
    <div className="stats"><Stat icon={<Users/>} n={people.length} label="Visible people"/><Stat icon={<ClipboardList/>} n={tasks.length} label="Visible tasks"/><Stat icon={<CheckCircle/>} n={completed} label="Completed"/><Stat icon={<AlertTriangle/>} n={overdue || strikes} label={overdue?'Overdue tasks':'Total strikes'}/><Stat icon={<Trophy/>} n={topScore} label="Top score"/></div>
  </section>
  <div className="layout">
    <main className="stack">
      {(me.role==='CEO'||me.role==='BOARD')&&<Assign token={token} users={people} reload={reload} notify={notify} onAssigned={setNewTaskId}/>}
      <Tasks token={token} me={me} tasks={tasks} users={people} reload={reload} notify={notify} newTaskId={newTaskId}/>
      <Proof token={token} dash={dash} me={me} reload={reload} notify={notify}/>
    </main>
    <aside className="stack">
      <People users={people}/>
      <RankingSection title="Founding Member Ranking" rows={dash.founder_ranking||[]} empty="Only your own founder rank is visible unless you are CEO."/>
      <RankingSection title="Intern Ranking" rows={dash.intern_ranking||[]} empty="No interns available"/>
      {me.role==='CEO'&&<Reports token={token} notify={notify}/>}
    </aside>
  </div>
 </div>
}
function Stat({icon,n,label}){return <div className="stat"><div className="stat-icon">{icon}</div><div><b>{n}</b><span>{label}</span></div></div>}

function SectionHeader({icon,title,meta}){return <div className="section-title"><h2>{icon}{title}</h2>{meta&&<span className="muted small">{meta}</span>}</div>}
function Field({label,children}){return <label className="field"><span>{label}</span>{children}</label>}
function Badge({children,tone=''}){return <span className={`badge ${tone}`}>{children}</span>}
function StrikeBadge({strikes=0}){return <span className={strikes>=3?'badge strike warn':'badge strike'}>Strikes {strikes}</span>}

function People({users}){
 return <section className="panel"><SectionHeader icon={<Users/>} title="People" meta={`${users.length} visible`}/>
  {users.length?users.map(u=><div className={u.strikes>=3?'person danger':'person'} key={u.id}><div><b>{u.name}</b><div className="small muted">{u.title} · {displayRole(u.role)}</div></div><StrikeBadge strikes={u.strikes}/></div>):<EmptyState text="No people visible yet"/>}
 </section>
}

function Assign({token,users,reload,notify,onAssigned}){
 const assignees=users.filter(u=>u.role==='FOUNDER'||u.role==='INTERN')
 const [f,setF]=useState({title:'',details:'',assigned_to:'',priority:'HIGH',due_date:''})
 const [saving,setSaving]=useState(false)
 async function submit(e){
  e.preventDefault(); setSaving(true)
  try{
   const result=await rpc('create_task_rpc',{p_token:token,p_title:f.title,p_details:f.details,p_assigned_to:f.assigned_to,p_priority:f.priority,p_due_date:f.due_date||null})
   setF({title:'',details:'',assigned_to:'',priority:'HIGH',due_date:''})
   onAssigned(result.id); await reload(); notify('Task assigned successfully')
  }catch(ex){notify(ex.message,'error')}finally{setSaving(false)}
 }
 return <section className="panel assign-panel"><SectionHeader icon={<Plus/>} title="Assign Task"/>
  {assignees.length?<form onSubmit={submit} className="form-grid">
   <Field label="Task Title"><input className="input" required placeholder="Write a clear task title" value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></Field>
   <Field label="Task Details"><textarea placeholder="Add context, expected output, and proof needed" value={f.details} onChange={e=>setF({...f,details:e.target.value})}/></Field>
   <Field label="Assignee"><select required value={f.assigned_to} onChange={e=>setF({...f,assigned_to:e.target.value})}><option value="">Select assignee</option>{assignees.map(u=><option key={u.id} value={u.id}>{u.name} - {u.title}</option>)}</select></Field>
   <div className="two-col">
    <Field label="Priority"><select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></Field>
    <Field label="Deadline"><input className="input" type="date" value={f.due_date} onChange={e=>setF({...f,due_date:e.target.value})}/></Field>
   </div>
   <button className="btn primary" disabled={saving}>{saving?'Assigning...':'Assign Task'}</button>
  </form>:<EmptyState text="No interns available"/>}
 </section>
}

function Tasks({token,me,tasks,users,reload,notify,newTaskId}){
 const [q,setQ]=useState('')
 const [deletedIds,setDeletedIds]=useState([])
 const [deletingId,setDeletingId]=useState('')
 const userById=useMemo(()=>Object.fromEntries(users.map(u=>[u.id,u])),[users])
 const filtered=tasks.filter(t=>!deletedIds.includes(t.id) && (`${t.title} ${t.details} ${t.assigned_to}`).toLowerCase().includes(q.toLowerCase()))
 function canDelete(task){return me.role==='CEO' || (me.role==='BOARD' && task.assignee_role==='INTERN')}
 async function setStatus(id,status){
  try{await rpc('update_task_status_rpc',{p_token:token,p_task_id:id,p_status:status}); await reload(); notify('Task status updated')}
  catch(ex){notify(ex.message,'error')}
 }
 async function deleteTask(task){
  if(!window.confirm(`Delete task "${task.title}"? This will also remove related logs and proof records.`)) return
  setDeletingId(task.id)
  try{
   await rpc('delete_task_rpc',{p_token:token,p_task_id:task.id})
   setDeletedIds(ids=>[...ids,task.id])
   notify('Task deleted successfully')
   await reload()
  }catch(ex){notify(ex.message,'error')}finally{setDeletingId('')}
 }
 return <section className="panel"><SectionHeader icon={<ClipboardList/>} title="Tasks" meta={`${filtered.length} shown`}/>
  <input className="input search" placeholder="Search tasks" value={q} onChange={e=>setQ(e.target.value)}/>
  {filtered.length?filtered.map(t=>{
   const assignee=userById[t.assigned_to_id]||{}
   const overdue=isOverdue(t)
   return <article className={`task ${newTaskId===t.id?'new-task':''} ${overdue?'overdue':''}`} key={t.id}>
    <div className="task-main">
      <div>
        <div className="task-title-row"><h3>{t.title}</h3>{newTaskId===t.id&&<Badge tone="fresh">New</Badge>}</div>
        {t.details&&<p className="muted">{t.details}</p>}
      </div>
      <div className="task-actions">
        <select className="status-select" value={t.status} onChange={e=>setStatus(t.id,e.target.value)}><option>TODO</option><option>IN_PROGRESS</option><option>SUBMITTED</option><option>DONE</option><option>BLOCKED</option></select>
        {canDelete(t)&&<button className="icon-btn danger-btn" type="button" onClick={()=>deleteTask(t)} disabled={deletingId===t.id} aria-label={`Delete ${t.title}`} title="Delete task"><Trash2 size={17}/></button>}
      </div>
    </div>
    <div className="task-meta">
      <Badge tone="assignee">{t.assigned_to}</Badge>
      <Badge tone={t.status.toLowerCase()}>{t.status.replace('_',' ')}</Badge>
      <Badge tone={t.priority.toLowerCase()}>{t.priority}</Badge>
      <Badge><CalendarDays size={14}/> {niceDate(t.due_date)}</Badge>
      {overdue&&<Badge tone="overdue"><AlertTriangle size={14}/> Overdue</Badge>}
      {(assignee.strikes||0)>=3&&<StrikeBadge strikes={assignee.strikes}/>}
      <span className="small muted">{t.minutes||0}m logged</span>
    </div>
   </article>
  }):<EmptyState text="No tasks assigned yet"/>}
 </section>
}

function RankingSection({title,rows,empty}){
 return <section className="panel"><SectionHeader icon={<Trophy/>} title={title}/>
  {rows.length?rows.map(r=><Rank key={r.id} r={r}/>):<EmptyState text={empty}/>}
 </section>
}
function Rank({r}){return <div className={r.strikes>=3?'rank danger':'rank'}><b>#{r.rank}</b><div><b>{r.name}</b><div className="small muted">{r.title} · {r.done}/{r.total} done</div><StrikeBadge strikes={r.strikes}/></div><b className="score">{r.score}</b></div>}

function Proof({token,dash,me,reload,notify}){
 const [taskId,setTaskId]=useState('')
 const [note,setNote]=useState('')
 const [minutes,setMinutes]=useState(30)
 const [img,setImg]=useState('')
 const tasks=dash.tasks||[]
 const canSubmitProof=me.role!=='BOARD'
 async function handlePaste(e){const item=[...e.clipboardData.items].find(i=>i.type.startsWith('image/')); if(item){setImg(await readFileAsDataURL(item.getAsFile()))}}
 async function file(e){const f=e.target.files?.[0]; if(f) setImg(await readFileAsDataURL(f))}
 async function submit(is_submission){
  try{
   await rpc('add_log_rpc',{p_token:token,p_task_id:taskId,p_note:note,p_minutes:Number(minutes)||0,p_screenshot_data_url:img||null,p_is_submission:is_submission})
   setNote(''); setImg(''); await reload(); notify(is_submission?'Submission uploaded successfully':'Log added successfully')
  }catch(ex){notify(ex.message,'error')}
 }
 return <section className="panel"><SectionHeader icon={<Camera/>} title="Proof Feed"/>
  {canSubmitProof&&<>
    <div className="proof-controls">
      <Field label="Task"><select value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">Select task</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
      <Field label="Minutes"><input className="input" type="number" min="0" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)}/></Field>
    </div>
    <div className="drop" tabIndex="0" onPaste={handlePaste}><Upload size={22}/><b>Paste or upload proof</b><span className="muted">Click here, then Ctrl/Cmd + V</span><input type="file" accept="image/*" onChange={file}/>{img&&<img alt="preview" src={img}/>}</div>
    <Field label="Update Note"><textarea placeholder="Write work update or submission note" value={note} onChange={e=>setNote(e.target.value)}/></Field>
    <div className="row"><button className="btn" disabled={!taskId} onClick={()=>submit(false)}>Add Log</button><button className="btn primary" disabled={!taskId} onClick={()=>submit(true)}><Send size={16}/> Submit Work</button></div>
  </>}
  <h3>Recent Proofs</h3>{(dash.proof_feed||[]).length?(dash.proof_feed||[]).map(p=><div className="feedItem" key={p.id}><b>{p.user}</b> <span className="muted">· {p.task_title} · {new Date(p.created_at).toLocaleString()}</span><p>{p.note}</p>{p.screenshot_data_url&&<img alt="proof" src={p.screenshot_data_url}/>}</div>):<EmptyState text="No proofs submitted yet"/>}
 </section>
}
function Reports({token,notify}){
 const [report,setReport]=useState(null)
 async function get(period){
  try{const r=await rpc('get_report_rpc',{p_token:token,p_period:period}); setReport(r); downloadJson(`omnimate-${period}-report.json`,r); notify(`${period[0].toUpperCase()+period.slice(1)} report downloaded`)}
  catch(ex){notify(ex.message,'error')}
 }
 return <section className="panel"><SectionHeader icon={<Download/>} title="Reports"/><p className="muted">CEO report downloads for weekly and monthly review.</p><div className="row"><button className="btn" onClick={()=>get('weekly')}>Weekly Report</button><button className="btn" onClick={()=>get('monthly')}>Monthly Report</button></div>{report&&<div className="report-box"><p><b>Best founder:</b> {report.best_founder?.name} ({report.best_founder?.score})</p><p><b>Best intern:</b> {report.best_intern?.name} ({report.best_intern?.score})</p></div>}</section>
}
function EmptyState({text}){return <div className="empty">{text}</div>}

createRoot(document.getElementById('root')).render(<App />)
