/**
 * App.jsx — Main application shell
 *
 * HOW EventSource / SSE WORKS IN THE BROWSER:
 * ─────────────────────────────────────────────
 * The browser's built-in `EventSource` API opens a persistent HTTP GET
 * connection to the server. The server never closes it — instead it keeps
 * writing SSE-formatted text (e.g. "data: {...}\n\n") whenever new events
 * arrive.
 *
 * KEY EventSource behaviours:
 *   • Auto-reconnects: If the connection drops, the browser automatically
 *     retries after `retry:` ms (we set 3000ms in the backend).
 *   • Last-Event-ID: On reconnect the browser sends the `id` of the last
 *     received event as the `Last-Event-Id` HTTP header so the server can
 *     replay missed events.
 *   • Named events: We use `addEventListener('log_event', ...)` instead of
 *     `onmessage` because the backend sends `event: log_event` frames.
 *     `onmessage` only fires for unnamed `event: message` frames.
 *
 * EXPERIMENTING WITH THE URL:
 * ────────────────────────────
 *   Normal:              http://localhost:8000/stream
 *   Resume from ID 42:   http://localhost:8000/stream?resume_from=42
 *   Faster pings (3s):   http://localhost:8000/stream?ping_interval=3
 *   Combine:             http://localhost:8000/stream?resume_from=10&ping_interval=5
 *   curl test:           curl -N -H "Last-Event-Id: 10" http://localhost:8000/stream
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import LiveChart from './components/LiveChart.jsx'
import EventLog from './components/EventLog.jsx'

// ── Change this to point at your backend ──────────────────────────────────
// In Docker Compose the browser reaches the backend via the HOST machine,
// so we use localhost:8000 (the port exposed by docker-compose.yml).
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

const MAX_EVENTS = 500  // keep latest N events in state

// ── Status helpers ──────────────────────────────────────────────────────
const STATUS = {
  CONNECTING:    { label: 'Connecting',    cls: 'badge-connecting' },
  CONNECTED:     { label: 'Connected',     cls: 'badge-connected'  },
  DISCONNECTED:  { label: 'Disconnected',  cls: 'badge-disconnected' },
}

export default function App() {
  const [events, setEvents]     = useState([])         // all received log events
  const [status, setStatus]     = useState('DISCONNECTED')
  const [stats, setStats]       = useState({ total: 0, high: 0, low: 0 })
  const [lastEventId, setLastEventId] = useState(null) // track last received id
  const [activeTab, setActiveTab] = useState('chart')  // 'chart' | 'log'
  const [activeUrl, setActiveUrl] = useState('')       // currently connected SSE URL

  // SSE params — user can tweak these in the UI to experiment
  const [resumeFrom, setResumeFrom] = useState('')
  const [pingInterval, setPingInterval] = useState(15)

  const esRef = useRef(null)  // holds the EventSource instance

  // ── Connect to SSE ──────────────────────────────────────────────────────
  const connect = useCallback((overrideResumeFrom) => {
    // Close any existing connection first
    if (esRef.current) {
      esRef.current.close()
    }

    // Build URL with optional query params — this is where you experiment!
    const params = new URLSearchParams()
    const rf = overrideResumeFrom ?? resumeFrom
    if (rf) params.set('resume_from', rf)
    if (pingInterval) params.set('ping_interval', pingInterval)

    const url = `${BACKEND_URL}/stream${params.toString() ? '?' + params : ''}`
    console.log('[SSE] Connecting to:', url)
    setActiveUrl(url)
    setStatus('CONNECTING')

    const es = new EventSource(url)
    esRef.current = es

    // ── Named event: "connected" (first event the server sends) ──────────
    es.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data)
      console.log('[SSE] connected event:', data)
      setStatus('CONNECTED')
    })

    // ── Named event: "log_event" (every data point from logger) ──────────
    es.addEventListener('log_event', (e) => {
      // e.lastEventId is automatically set by the browser from the SSE `id:` field
      setLastEventId(e.lastEventId)

      const data = JSON.parse(e.data)
      const event = {
        id:        parseInt(e.lastEventId) || Date.now(),
        value:     data.value,
        timestamp: data.timestamp,
      }

      setEvents(prev => {
        const next = [...prev, event]
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
      })

      setStats(prev => ({
        total: prev.total + 1,
        high:  prev.high + (data.value > 0.8 ? 1 : 0),
        low:   prev.low  + (data.value < 0.2 ? 1 : 0),
      }))
    })

    // ── onerror: fires on connection failure OR disconnect ────────────────
    // Note: EventSource will auto-reconnect, so this isn't fatal.
    es.onerror = (err) => {
      console.warn('[SSE] Connection error or closed:', err)
      setStatus(es.readyState === EventSource.CLOSED ? 'DISCONNECTED' : 'CONNECTING')
    }

    es.onopen = () => {
      console.log('[SSE] Connection opened.')
      setStatus('CONNECTED')
    }
  }, [resumeFrom, pingInterval])

  // ── Disconnect ──────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    setStatus('DISCONNECTED')
    console.log('[SSE] Manually disconnected.')
  }, [])

  // ── Reconnect using last known event ID (simulate browser auto-reconnect)
  const reconnectFromLast = useCallback(() => {
    if (lastEventId) {
      console.log(`[SSE] Reconnecting with Last-Event-Id: ${lastEventId}`)
      connect(lastEventId)
    }
  }, [lastEventId, connect])

  // Auto-connect on mount
  useEffect(() => {
    connect()
    return () => esRef.current?.close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { label, cls } = STATUS[status]
  const latestValue = events.at(-1)?.value

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', padding: '24px 28px' }}>

      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            SSE Live{' '}
            <span style={{
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Stream Dashboard
            </span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: 4 }}>
            FastAPI → SSE → React · Docker Compose Demo
          </p>
        </div>
        <span className={`badge ${cls}`}>
          <span className="pulse-dot" />
          {label}
        </span>
      </header>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Events',  value: stats.total,   color: 'var(--accent-cyan)' },
          { label: 'Latest Value',  value: latestValue != null ? latestValue.toFixed(6) : '—', color: 'var(--accent-purple)' },
          { label: '▲ High (>0.8)', value: stats.high,    color: 'var(--accent-green)' },
          { label: '▼ Low (<0.2)',  value: stats.low,     color: 'var(--accent-red)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card" style={{ padding: '18px 22px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {label}
            </p>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700,
              lineHeight: 1, color,
            }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Main Panel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, marginBottom: 16 }}>

        {/* Chart + Log (tabbed) */}
        <div className="glass-card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {['chart', 'log'].map(tab => (
              <button
                key={tab}
                className="btn btn-ghost"
                id={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{
                  borderColor: activeTab === tab ? 'var(--accent-cyan)' : undefined,
                  color: activeTab === tab ? 'var(--accent-cyan)' : undefined,
                  textTransform: 'capitalize',
                }}
              >
                {tab === 'chart' ? '📈 Live Chart' : '📋 Event Log'}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '12px',
              alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>
              Last-Event-Id: <span style={{ color: 'var(--accent-cyan)' }}>{lastEventId ?? '—'}</span>
            </span>
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, minHeight: 0 }}>
            {activeTab === 'chart'
              ? <LiveChart events={events} />
              : <EventLog events={events} />
            }
          </div>
        </div>

        {/* ── Experiment Panel ── */}
        <div className="glass-card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 700, marginBottom: 4 }}>🧪 Experiment Panel</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Tweak the SSE connection parameters and reconnect. Watch the browser's
              <strong style={{ color: 'var(--text-secondary)' }}> DevTools → Network → /stream → EventStream</strong> tab to see raw frames.
            </p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

          {/* resume_from */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600,
              display: 'block', marginBottom: 6 }}>
              resume_from (Last-Event-Id)
            </label>
            <input
              id="input-resume-from"
              type="number"
              placeholder={`e.g. ${lastEventId ?? '10'}`}
              value={resumeFrom}
              onChange={e => setResumeFrom(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px',
                background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '13px',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>
              Simulates the browser sending <code>Last-Event-Id</code> on reconnect.
              Leave blank to start fresh.
            </p>
          </div>

          {/* ping_interval */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600,
              display: 'block', marginBottom: 6 }}>
              ping_interval: <span style={{ color: 'var(--accent-cyan)' }}>{pingInterval}s</span>
            </label>
            <input
              id="input-ping-interval"
              type="range" min={1} max={30} value={pingInterval}
              onChange={e => setPingInterval(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>
              ⚠️ Controls server keep-alive <code>: ping</code> comments only —
              <strong style={{ color: 'var(--text-secondary)' }}> NOT</strong> data speed.
              Data speed is set by <code>INTERVAL_SECONDS</code> in the logger container.
              Hit <em>Reconnect</em> to apply. Visible in DevTools → EventStream tab.
            </p>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button id="btn-reconnect" className="btn btn-primary" onClick={() => connect()}>
              ↺ Reconnect with params
            </button>
            <button
              id="btn-reconnect-last"
              className="btn btn-ghost"
              onClick={reconnectFromLast}
              disabled={!lastEventId}
              title={`Resume from event #${lastEventId}`}
            >
              ↺ Resume from #{lastEventId ?? '?'}
            </button>
            <button
              id="btn-disconnect"
              className="btn btn-danger"
              onClick={status === 'DISCONNECTED' ? () => connect() : disconnect}
            >
              {status === 'DISCONNECTED' ? '⚡ Connect' : '✕ Disconnect'}
            </button>
          </div>

          {/* Active connection URL */}
          {activeUrl && (
            <div style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
            }}>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: 4,
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Active SSE URL
              </p>
              <code style={{ fontSize: '10.5px', color: 'var(--accent-green)',
                fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.6 }}>
                {activeUrl}
              </code>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

          {/* curl cheat sheet */}
          <div>
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              🖥️ curl commands to try:
            </p>
            {[
              `curl -N ${BACKEND_URL}/stream`,
              `curl -N "${BACKEND_URL}/stream?resume_from=5"`,
              `curl -N -H "Last-Event-Id: 10" ${BACKEND_URL}/stream`,
              `curl ${BACKEND_URL}/status`,
            ].map(cmd => (
              <code key={cmd} style={{
                display: 'block', marginBottom: 6,
                background: 'rgba(0,0,0,0.3)', padding: '6px 10px',
                borderRadius: 6, fontSize: '10.5px', color: 'var(--accent-cyan)',
                fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
                border: '1px solid var(--border)',
              }}>
                {cmd}
              </code>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: 8 }}>
        Logger → POST /ingest → FastAPI asyncio.Queue → SSE /stream → EventSource → React
      </footer>
    </div>
  )
}
