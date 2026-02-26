import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [courseName, setCourseName] = useState('')
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [events, setEvents] = useState([])
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [viewMode, setViewMode] = useState('list') // 'list' or 'calendar'
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(null) // YYYY-MM-DD

  // Check current session on load and on auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load all events from Supabase when user is set (and refetch after uploads)
  const fetchEvents = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .order('event_date')
    if (!error) setEvents(data || [])
  }, [user])

  useEffect(() => {
    if (user) fetchEvents()
  }, [user, fetchEvents])

  async function handleSignUp(e) {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    setAuthLoading(false)
    if (error) {
      setAuthError(error.message)
      return
    }
    setAuthMessage('Check your email to confirm your account, then come back here and sign in.')
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setAuthError('')
    setAuthMessage('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setAuthLoading(false)
    if (error) {
      setAuthError(error.message)
      return
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleDeleteClass(course) {
    if (!user) return
    const confirmed = window.confirm(
      `Delete ${course} and all its events from your planner?`
    )
    if (!confirmed) return

    try {
      const res = await fetch(`${API_URL}/delete-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, course_name: course }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadError(data.detail || 'Could not delete class')
        return
      }
      await fetchEvents()
    } catch (err) {
      setUploadError(err.message || 'Could not delete class')
    }
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!uploadFile || !user) return
    setUploadError('')
    setUploadLoading(true)
    try {
      const fileName = `${user.id}/${Date.now()}-${uploadFile.name}`
      const { error: uploadErr } = await supabase.storage
        .from('syllabi')
        .upload(fileName, uploadFile, { upsert: true })
      if (uploadErr) {
        setUploadError('Upload failed: ' + uploadErr.message)
        setUploadLoading(false)
        return
      }
      const { data: urlData } = supabase.storage.from('syllabi').getPublicUrl(fileName)
      const fileUrl = urlData.publicUrl

      const res = await fetch(`${API_URL}/process-syllabus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: fileUrl,
          user_id: user.id,
          source_filename: uploadFile.name,
          course_name: courseName.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setUploadError(data.detail || 'Backend error')
        setUploadLoading(false)
        return
      }
      await fetchEvents()
      setUploadFile(null)
      setCourseName('')
      e.target.reset()
    } catch (err) {
      setUploadError(err.message || 'Request failed')
    }
    setUploadLoading(false)
  }

  // Sort, filter, then group events by course
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.event_date) - new Date(b.event_date)
  )
  const filteredEvents = sortedEvents.filter((ev) => {
    if (eventTypeFilter === 'all') return true
    const desc = (ev.event_description || '').toLowerCase()
    const title = (ev.event_title || '').toLowerCase()
    if (eventTypeFilter === 'assignment') {
      const hasAssignmentOrHomework =
        desc.includes('assignment') ||
        title.includes('assignment') ||
        desc.includes('homework') ||
        title.includes('homework')
      const hasProject = desc.includes('project') || title.includes('project')
      return hasAssignmentOrHomework && !hasProject
    }
    if (eventTypeFilter === 'exam') return desc.includes('exam') || title.includes('exam')
    if (eventTypeFilter === 'project') return desc.includes('project') || title.includes('project')
    return true
  })
  const byCourse = {}
  filteredEvents.forEach((ev) => {
    const course = ev.course_name || 'Other'
    if (!byCourse[course]) byCourse[course] = []
    byCourse[course].push(ev)
  })
  const courseNames = Object.keys(byCourse).sort()

  const colorPalette = ['#f97316', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#06b6d4']
  const courseColors = {}
  courseNames.forEach((course, idx) => {
    courseColors[course] = colorPalette[idx % colorPalette.length]
  })

  // Calendar data (month grid based on filtered events)
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0)
  const daysInMonth = monthEnd.getDate()
  const startWeekday = monthStart.getDay() // 0 (Sun) – 6 (Sat)

  const calendarCells = []
  for (let i = 0; i < startWeekday; i++) {
    calendarCells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      day
    )
    const key = dateObj.toISOString().slice(0, 10)
    const dayEvents = filteredEvents.filter((ev) => ev.event_date === key)
    calendarCells.push({ day, key, events: dayEvents })
  }

  const monthLabel = calendarMonth.toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  function changeMonth(delta) {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1)
    )
  }

  const eventsOnSelectedDate =
    selectedDate != null
      ? filteredEvents.filter((ev) => ev.event_date === selectedDate)
      : []

  function downloadIcs() {
    if (!filteredEvents.length) return

    const pad = (n) => String(n).padStart(2, '0')
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Syllabus Scanner//EN',
    ]

    filteredEvents.forEach((ev, i) => {
      const dt = new Date(ev.event_date)
      const dtStr = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`
      const uid = `${dtStr}-${i}@syllabus-scanner`
      const title = (ev.event_title || 'Untitled').replace(/[\r\n]/g, ' ')
      const desc = (ev.event_description || '').replace(/[\r\n]/g, ' ')
      const course = ev.course_name || 'Other'

      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${uid}`)
      lines.push(`SUMMARY:${title}`)
      lines.push(`DESCRIPTION:${course}${desc ? ' - ' + desc : ''}`)
      lines.push(`DTSTART;VALUE=DATE:${dtStr}`)
      lines.push(`DTEND;VALUE=DATE:${dtStr}`)
      lines.push('END:VEVENT')
    })

    lines.push('END:VCALENDAR')
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'syllabus-events.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div style={{ padding: '1rem' }}>Loading…</div>
  }

  if (!user) {
    return (
      <div>
        <h1>Syllabus Scanner</h1>
        <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>
          Sign in or create an account to upload a syllabus and get calendar events.
        </p>
        <section className="auth-section">
          <form onSubmit={handleSignIn}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {authError && <p className="error">{authError}</p>}
            {authMessage && <p className="success">{authMessage}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="primary" disabled={authLoading}>
                Sign in
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleSignUp}
                disabled={authLoading}
              >
                Sign up
              </button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div>
      <h1>Syllabus Scanner</h1>
      <p className="sign-out">
        Signed in as {user.email}
        <button type="button" className="secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </p>

      <section className="auth-section">
        <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Add a syllabus</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
          You can add multiple syllabi; events are grouped by class.
        </p>
        <form onSubmit={handleUpload}>
          <label htmlFor="course">Course / class name (optional)</label>
          <input
            id="course"
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="e.g. CPE 380, BIO 101 — leave blank to auto-detect from the PDF"
          />
          <label htmlFor="pdf">Choose a PDF file</label>
          <input
            id="pdf"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          {uploadError && <p className="error">{uploadError}</p>}
          <button
            type="submit"
            className="primary"
            disabled={!uploadFile || uploadLoading}
          >
            {uploadLoading ? 'Processing…' : 'Upload & extract events'}
          </button>
        </form>
      </section>

      {events.length > 0 && (
        <>
          <section>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.35rem' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Events</h2>
              <button
                type="button"
                className="secondary"
                style={{ marginLeft: 'auto' }}
                onClick={downloadIcs}
                disabled={!filteredEvents.length}
              >
                Download .ics
              </button>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
              To add these dates to your calendar: click <strong>Download .ics</strong>, then
              import that file into Google Calendar or Apple Calendar.
            </p>
            <div className="filters">
              <span>Show:</span>
              <button
                type="button"
                className={eventTypeFilter === 'all' ? 'chip active' : 'chip'}
                onClick={() => setEventTypeFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={eventTypeFilter === 'assignment' ? 'chip active' : 'chip'}
                onClick={() => setEventTypeFilter('assignment')}
              >
                Assignments
              </button>
              <button
                type="button"
                className={eventTypeFilter === 'project' ? 'chip active' : 'chip'}
                onClick={() => setEventTypeFilter('project')}
              >
                Projects
              </button>
              <button
                type="button"
                className={eventTypeFilter === 'exam' ? 'chip active' : 'chip'}
                onClick={() => setEventTypeFilter('exam')}
              >
                Exams
              </button>
              <span className="filters-spacer" />
              <span>View:</span>
              <button
                type="button"
                className={viewMode === 'list' ? 'chip active' : 'chip'}
                onClick={() => setViewMode('list')}
              >
                List
              </button>
              <button
                type="button"
                className={viewMode === 'calendar' ? 'chip active' : 'chip'}
                onClick={() => setViewMode('calendar')}
              >
                Calendar
              </button>
            </div>

            {viewMode === 'list' && (
              <>
                {courseNames.map((course) => (
                  <div key={course} className="course-block">
                    <div className="course-header-row">
                      <h3
                        className="course-heading"
                        style={{ borderLeftColor: courseColors[course] }}
                      >
                        {course}
                      </h3>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => handleDeleteClass(course)}
                      >
                        Delete class
                      </button>
                    </div>
                    <ul className="events-list">
                      {byCourse[course].map((ev, i) => (
                        <li key={ev.id || i}>
                          <div className="date">{ev.event_date}</div>
                          <div className="title">{ev.event_title}</div>
                          {ev.event_description && (
                            <div className="desc">{ev.event_description}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}

            {viewMode === 'calendar' && (
              <section className="calendar-section">
                <div className="calendar-header">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => changeMonth(-1)}
                  >
                    ‹
                  </button>
                  <span>{monthLabel}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => changeMonth(1)}
                  >
                    ›
                  </button>
                </div>
                <div className="calendar-grid">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="calendar-dow">
                      {d}
                    </div>
                  ))}
                  {calendarCells.map((cell, idx) =>
                    cell ? (
                      <button
                        type="button"
                        key={idx}
                        className={
                          'calendar-day' +
                          (cell.events.length ? ' has-events' : '') +
                          (selectedDate === cell.key ? ' selected' : '')
                        }
                        onClick={() => setSelectedDate(cell.key)}
                      >
                        <div className="day-number">{cell.day}</div>
                        {cell.events.slice(0, 3).map((ev, i) => (
                          <div
                            key={i}
                            className="day-dot"
                            title={ev.event_title}
                            style={{
                              backgroundColor:
                                courseColors[ev.course_name || 'Other'] || '#3b82f6',
                            }}
                          />
                        ))}
                      </button>
                    ) : (
                      <div key={idx} className="calendar-day empty" />
                    )
                  )}
                </div>
                {selectedDate && eventsOnSelectedDate.length > 0 && (
                  <div className="calendar-detail">
                    <h3>
                      Events on{' '}
                      {new Date(selectedDate).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </h3>
                    <ul className="events-list">
                      {eventsOnSelectedDate.map((ev, i) => (
                        <li key={ev.id || i}>
                          <div className="title">{ev.event_title}</div>
                          <div className="date">
                            {ev.course_name || 'Other'} · {ev.event_date}
                          </div>
                          {ev.event_description && (
                            <div className="desc">{ev.event_description}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </section>
        </>
      )}
    </div>
  )
}
