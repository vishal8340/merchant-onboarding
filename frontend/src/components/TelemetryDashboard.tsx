import React, { useState, useEffect, useCallback } from 'react';
import { telemetryApi } from '../api/client';

interface AICallRecord {
  service: string;
  model: string;
  agent: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensEstimated?: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  pages?: number;
  error?: string;
  timestamp: string;
}

interface AppTelemetry {
  applicationId: string;
  businessName?: string;
  status?: string;
  source?: string;
  calls: AICallRecord[];
  totals: {
    totalCalls: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalLatencyMs: number;
    totalCostUsd: number;
    textractPages: number;
    textractCostUsd: number;
    llmCostUsd: number;
    errorCount: number;
  };
}

interface TelemetrySummary {
  grand: {
    totalApplications: number;
    totalCalls: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalLatencyMs: number;
    totalCostUsd: number;
    textractPages: number;
    textractCostUsd: number;
    llmCostUsd: number;
    errorCount: number;
  };
  applications: AppTelemetry[];
  collectedAt: string;
}

const SERVICE_COLORS: Record<string, string> = {
  DIAL: '#6366f1',
  TEXTRACT: '#f59e0b',
  MCC_ANALYSER: '#10b981',
  RISK_SCORING: '#ef4444',
  AI_PROXY_GPT4O: '#8b5cf6',
};
const AGENT_COLORS: Record<string, string> = {
  KYC: '#3b82f6',
  MCC: '#10b981',
  RISK: '#f59e0b',
  TEXTRACT: '#f59e0b',
  SYSTEM: '#64748b',
};

function fmtCost(n: number) { return `$${n.toFixed(5)}`; }
function fmtTokens(n: number) { return n > 0 ? n.toLocaleString() : '—'; }

export const TelemetryDashboard: React.FC = () => {
  const [data, setData] = useState<TelemetrySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(async () => {
    try {
      setError('');
      const result = await telemetryApi.getAll();
      setData(result);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load telemetry');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000); // auto-refresh every 15s
    return () => clearInterval(interval);
  }, [load]);

  if (isLoading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <p style={{ color: '#64748b', marginTop: '16px' }}>Loading telemetry data…</p>
    </div>
  );

  const g = data?.grand;
  const apps = data?.applications ?? [];
  const allCalls = apps.flatMap(app =>
    (app.calls ?? []).map(c => ({ ...c, appName: app.businessName ?? app.applicationId }))
  );

  const cards = [
    { label: 'Applications Tracked', value: g?.totalApplications ?? 0, sub: `${apps.length} in memory`, color: '#a5b4fc' },
    { label: 'Total AI Calls', value: g?.totalCalls ?? 0, sub: `${g?.errorCount ?? 0} errors`, color: '#34d399' },
    { label: 'Total Tokens', value: (g?.totalTokens ?? 0).toLocaleString(), sub: 'all LLM calls', color: '#818cf8' },
    { label: 'Total Cost', value: `$${(g?.totalCostUsd ?? 0).toFixed(4)}`, sub: 'LLM + Textract', color: '#fbbf24' },
    { label: 'LLM Cost', value: `$${(g?.llmCostUsd ?? 0).toFixed(4)}`, sub: 'DIAL / AI Proxy', color: '#6366f1' },
    { label: 'Textract Cost', value: `$${(g?.textractCostUsd ?? 0).toFixed(4)}`, sub: `${g?.textractPages ?? 0} pages`, color: '#f59e0b' },
    {
      label: 'Avg Latency',
      value: (g?.totalCalls ?? 0) > 0
        ? `${Math.round((g?.totalLatencyMs ?? 0) / (g?.totalCalls ?? 1))}ms`
        : '—',
      sub: 'per AI call', color: '#94a3b8',
    },
  ];

  return (
    <div style={s.page}>
      {/* ── Blue Header ── */}
      <div style={s.pageHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '13px',
            background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', backdropFilter: 'blur(8px)',
          }}>📊</div>
          <div>
            <h1 style={s.h1}>AI Cost & Telemetry Dashboard</h1>
            <p style={s.sub}>
              Real token usage · Actual latency · Cost breakdown
              &nbsp;·&nbsp; Last refreshed: {lastRefresh.toLocaleTimeString()}
              &nbsp;<span style={{ color: '#6ee7b7', fontSize: '11px' }}>(auto-refreshes every 15s)</span>
            </p>
          </div>
        </div>
      </div>
      <div style={s.content}>

      {error && (
        <div style={s.errorBox}>⚠️ {error}</div>
      )}

      {/* Summary cards */}
      <div style={s.cards}>
        {cards.map(c => (
          <div key={c.label} style={s.card}>
            <div style={s.cardLabel}>{c.label}</div>
            <div style={{ ...s.cardValue, color: c.color }}>{c.value}</div>
            <div style={s.cardSub}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Per-Application Summary */}
      <section style={s.section}>
        <h2 style={s.h2}>Per-Application Summary</h2>
        {apps.length === 0 ? (
          <div style={s.empty}>No telemetry data yet — submit an application to see AI cost tracking here.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Business', 'App ID', 'Status', 'Calls', 'Tokens', 'Pages', 'Latency', 'Total $', 'Textract $', 'LLM $', 'Errors'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map(app => {
                  const t = app.totals ?? {} as any;
                  const isExpanded = expandedApp === app.applicationId;
                  const appStatus = app.status ?? '—';
                  const statusBg = appStatus === 'APPROVED' ? '#10b981' : appStatus === 'REJECTED' ? '#ef4444' : '#6366f1';
                  return (
                    <React.Fragment key={app.applicationId}>
                      <tr
                        style={{ ...s.tr, cursor: 'pointer' }}
                        onClick={() => setExpandedApp(isExpanded ? null : app.applicationId)}
                      >
                        <td style={s.td}>{app.businessName ?? app.applicationId}</td>
                        <td style={{ ...s.td, fontSize: '11px', color: '#64748b' }}>{app.applicationId}</td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, background: statusBg }}>{appStatus}</span>
                        </td>
                        <td style={{ ...s.td, ...s.num }}>{t.totalCalls ?? 0}</td>
                        <td style={{ ...s.td, ...s.num }}>{(t.totalTokens ?? 0).toLocaleString()}</td>
                        <td style={{ ...s.td, ...s.num }}>{t.textractPages ?? 0} pg</td>
                        <td style={{ ...s.td, ...s.num }}>{Math.round((t.totalLatencyMs ?? 0) / 1000)}s</td>
                        <td style={{ ...s.td, ...s.num, ...s.cost }}>{fmtCost(t.totalCostUsd ?? 0)}</td>
                        <td style={{ ...s.td, ...s.num, color: '#f59e0b' }}>{fmtCost(t.textractCostUsd ?? 0)}</td>
                        <td style={{ ...s.td, ...s.num, color: '#818cf8' }}>{fmtCost(t.llmCostUsd ?? 0)}</td>
                        <td style={{ ...s.td, color: (t.errorCount ?? 0) > 0 ? '#ef4444' : '#10b981' }}>
                          {t.errorCount ?? 0}
                        </td>
                      </tr>
                      {isExpanded && (app.calls ?? []).length > 0 && (
                        <tr key={`${app.applicationId}-expand`}>
                          <td colSpan={11} style={{ padding: '0 0 12px 24px', background: '#f0f7ff' }}>
                            <CallsTable calls={app.calls} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* All Calls (flat) */}
      <section style={s.section}>
        <h2 style={s.h2}>All AI Calls</h2>
        <p style={s.legend}>
          <sup style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', background: '#e2e8f0', borderRadius: '3px', padding: '1px 3px' }}>est</sup>
          {' '}= BPE-estimated token count (API did not return usage; counted via gpt-tokenizer) &nbsp;·&nbsp;
          <span style={{ color: '#f59e0b' }}>—</span> = N/A (Textract uses page-based billing, not tokens)
        </p>
        {allCalls.length === 0 ? (
          <div style={s.empty}>No calls recorded yet.</div>
        ) : (
          <CallsTable calls={allCalls} showApp />
        )}
      </section>
      </div>
    </div>
  );
};

/* ─── Reusable inner calls table ─────────────────────────────── */
const CallsTable: React.FC<{ calls: (AICallRecord & { appName?: string })[]; showApp?: boolean }> = ({ calls, showApp }) => {
  const renderToken = (c: AICallRecord, val: number) => {
    if (c.service === 'TEXTRACT') return c.pages != null ? `${c.pages} pg` : '—';
    if (val === 0 && !c.tokensEstimated) return '—';
    return <>{val.toLocaleString()}</>;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ ...st.table, minWidth: showApp ? '900px' : '720px' }}>
        <thead>
          <tr>
            {showApp && <th style={st.th}>App</th>}
            <th style={st.th}>Agent</th>
            <th style={st.th}>Service</th>
            <th style={{ ...st.th, maxWidth: '200px' }}>Purpose</th>
            <th style={st.th}>Model</th>
            <th style={{ ...st.th, textAlign: 'right' }}>Total tkns</th>
            <th style={{ ...st.th, textAlign: 'right' }}>Latency</th>
            <th style={{ ...st.th, textAlign: 'right' }}>Cost</th>
            <th style={st.th}>Status</th>
            <th style={st.th}>Time</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} style={st.tr}>
              {showApp && <td style={st.td}>{(c as any).appName ?? '—'}</td>}
              <td style={st.td}>
                <span style={{ ...st.badge, background: AGENT_COLORS[c.agent] ?? '#64748b' }}>{c.agent}</span>
              </td>
              <td style={st.td}>
                <span style={{ ...st.badge, background: SERVICE_COLORS[c.service] ?? '#64748b' }}>{c.service}</span>
              </td>
              <td style={{ ...st.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.purpose}>
                {c.purpose}
              </td>
              <td style={{ ...st.td, fontSize: '11px', color: '#94a3b8' }}>{c.model}</td>
              <td style={{ ...st.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{renderToken(c, c.totalTokens)}</td>
              <td style={{ ...st.td, textAlign: 'right' }}>{c.latencyMs}ms</td>
              <td style={{ ...st.td, textAlign: 'right', color: '#fbbf24', fontWeight: 600 }}>{fmtCost(c.estimatedCostUsd ?? 0)}</td>
              <td style={st.td}>
                {c.error
                  ? <span style={{ color: '#ef4444', fontSize: '11px' }}>⚠ {c.error.slice(0, 30)}</span>
                  : <span style={{ color: '#10b981' }}>✓</span>
                }
              </td>
              <td style={{ ...st.td, color: '#475569', fontSize: '11px' }}>
                {new Date(c.timestamp).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ─── Styles ──────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
    background: '#f1f5f9',
    color: '#1e293b',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  pageHeader: {
    background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #2563eb 100%)',
    color: 'white',
    padding: '18px 32px',
    boxShadow: '0 4px 20px rgba(30,58,138,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px',
    flexShrink: 0,
  },
  content: { padding: '24px 28px 48px', flex: 1 },
  h1: { fontSize: '24px', fontWeight: 800, margin: 0, letterSpacing: '-0.3px' },
  sub: { fontSize: '13px', color: '#bfdbfe', margin: '3px 0 0' },
  refreshBtn: {
    background: 'rgba(255,255,255,0.15)', color: '#fff',
    border: '1.5px solid rgba(255,255,255,0.3)',
    padding: '10px 20px', borderRadius: '10px', cursor: 'pointer',
    fontSize: '14px', fontWeight: 700, backdropFilter: 'blur(8px)',
    transition: 'all 0.2s', letterSpacing: '0.02em', flexShrink: 0,
  },
  errorBox: {
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
    borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px', marginBottom: '28px',
  },
  card: {
    background: 'white', border: '1px solid #e2e8f0',
    borderRadius: '12px', padding: '16px',
    boxShadow: '0 2px 8px rgba(37,99,235,0.06)',
  },
  cardLabel: { fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 },
  cardValue: { fontSize: '22px', fontWeight: 800 },
  cardSub: { fontSize: '11px', color: '#94a3b8', marginTop: '3px' },
  section: { marginBottom: '32px' },
  h2: {
    fontSize: '13px', fontWeight: 800, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px',
  },
  legend: { fontSize: '11px', color: '#94a3b8', marginBottom: '10px' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px', background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(37,99,235,0.06)', border: '1px solid #e2e8f0' },
  th: { background: '#f8fafc', color: '#475569', fontWeight: 700, textTransform: 'uppercase' as const, fontSize: '10px', letterSpacing: '0.06em', padding: '10px 12px', textAlign: 'left' as const, borderBottom: '1px solid #e2e8f0' },
  tr: { borderTop: '1px solid #f1f5f9' },
  td: { padding: '9px 12px', verticalAlign: 'middle' as const, borderTop: '1px solid #f1f5f9', color: '#1e293b' },
  num: { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  cost: { color: '#d97706', fontWeight: 700 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, color: '#fff' },
  empty: { color: '#94a3b8', textAlign: 'center', padding: '32px 16px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '14px' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', background: '#f1f5f9' },
  spinner: { width: '40px', height: '40px', border: '4px solid rgba(37,99,235,0.1)', borderTop: '4px solid #2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};

const st: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px', background: 'white', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0' },
  th: { background: '#f8fafc', color: '#475569', fontWeight: 700, textTransform: 'uppercase' as const, fontSize: '10px', letterSpacing: '0.06em', padding: '9px 11px', textAlign: 'left' as const, borderBottom: '1px solid #e2e8f0' },
  tr: { borderTop: '1px solid #f1f5f9' },
  td: { padding: '8px 11px', verticalAlign: 'middle' as const, borderTop: '1px solid #f1f5f9', color: '#1e293b' },
  badge: { display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, color: '#fff' },
};
