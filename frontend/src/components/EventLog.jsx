/**
 * EventLog.jsx
 *
 * A scrolling log panel that shows raw SSE events as they arrive,
 * styled like a terminal. Newest events appear at the TOP so you
 * never need to scroll down to see the latest data.
 */

const MAX_LOG_ENTRIES = 200

export default function EventLog({ events }) {
  // Take the last MAX_LOG_ENTRIES and reverse so newest is first
  const displayEvents = [...events.slice(-MAX_LOG_ENTRIES)].reverse()

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      lineHeight: '1.7',
      padding: '12px 4px',
    }}>
      {displayEvents.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '8px 12px' }}>
          Waiting for events…
        </div>
      ) : (
        displayEvents.map((e, i) => {
          // Color-code value: green &gt; 0.8, red &lt; 0.2, cyan otherwise
          const valueColor =
            e.value > 0.8 ? 'var(--accent-green)'
            : e.value < 0.2 ? 'var(--accent-red)'
            : 'var(--accent-cyan)'

          // Format timestamp to just show time portion
          const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false })

          return (
            <div
              key={e.id ?? i}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 90px 1fr',
                gap: '0 14px',
                padding: '2px 12px',
                borderRadius: '4px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e2 => e2.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e2 => e2.currentTarget.style.background = 'transparent'}
            >
              {/* Event ID */}
              <span style={{ color: 'var(--text-muted)' }}>
                #{String(e.id).padStart(4, '0')}
              </span>

              {/* Timestamp */}
              <span style={{ color: 'var(--text-secondary)' }}>
                {time}
              </span>

              {/* Value */}
              <span style={{ color: valueColor, fontWeight: 500 }}>
                {e.value.toFixed(8)}
                {e.value > 0.8 && <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>▲ HIGH</span>}
                {e.value < 0.2 && <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>▼ LOW</span>}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
