/**
 * LiveChart.jsx
 *
 * A real-time line chart built with Recharts.
 * Keeps only the last MAX_POINTS data points so the chart doesn't
 * grow unbounded in memory.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

const MAX_POINTS = 60  // show last 60 data points on chart

// Custom tooltip so it looks nice on our dark background
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(6,9,15,0.9)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '8px',
      padding: '10px 14px',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Event #{label}</p>
      <p style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
        {payload[0].value?.toFixed(6)}
      </p>
    </div>
  )
}

export default function LiveChart({ events }) {
  // Slice to only the last MAX_POINTS events
  const chartData = events.slice(-MAX_POINTS).map((e) => ({
    id: e.id,
    value: parseFloat(e.value.toFixed(6)),
  }))

  if (chartData.length === 0) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
      }}>
        Waiting for data…
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="id"
          tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          label={{ value: 'Event ID', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          tickCount={6}
        />
        <Tooltip content={<CustomTooltip />} />
        {/* Reference line at 0.5 — the statistical mean of random() */}
        <ReferenceLine y={0.5} stroke="rgba(168, 85, 247, 0.35)" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent-cyan)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: 'var(--accent-cyan)', stroke: 'var(--bg-deep)', strokeWidth: 2 }}
          isAnimationActive={false}  // disable animation for smoother real-time updates
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
