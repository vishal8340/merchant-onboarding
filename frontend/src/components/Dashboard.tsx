import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MerchantApplication } from '../types';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');

  const loadApplications = useCallback(async () => {
    try {
      setIsLoading(true);
      const apps = await api.getAllApplications();
      setApplications(apps);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const stats = {
    total: applications.length,
    draft: applications.filter(a => a.status === 'DRAFT').length,
    processing: applications.filter(a => a.status === 'PROCESSING').length,
    review: applications.filter(a => a.status === 'MANUAL_REVIEW').length,
    approved: applications.filter(a => a.status === 'APPROVED').length,
    rejected: applications.filter(a => a.status === 'REJECTED').length,
  };

  const filteredApps = filter === 'ALL'
    ? applications
    : applications.filter(a => a.status === filter);

  const statusColor: Record<string, string> = {
    DRAFT: '#f59e0b',
    PROCESSING: '#3b82f6',
    MANUAL_REVIEW: '#8b5cf6',
    APPROVED: '#10b981',
    REJECTED: '#ef4444',
    SUBMITTED: '#6b7280',
  };

  const statusLabel: Record<string, string> = {
    DRAFT: 'Draft',
    PROCESSING: 'Processing',
    MANUAL_REVIEW: 'In Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    SUBMITTED: 'Submitted',
  };

  const pipelineSteps = [
    { icon: '📋', label: 'Application', sub: 'Step 1–3 Form' },
    { icon: '🔍', label: 'KYC Agent', sub: 'Identity Verification' },
    { icon: '🏷️', label: 'MCC Analyser', sub: 'AI Category Code' },
    { icon: '⚖️', label: 'Risk Scoring', sub: 'ML Risk Model' },
    { icon: '✅', label: 'Decision', sub: 'Approved / Review' },
  ];

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #2563eb 100%)'
      }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{
            width: '64px', height: '64px',
            border: '4px solid rgba(255,255,255,0.2)',
            borderTop: '4px solid #818cf8',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <p style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '0.05em' }}>
            Loading Merchant Portal…
          </p>
          <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f1f5f9',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .app-card:hover { transform: translateY(-4px) !important; box-shadow: 0 16px 48px rgba(0,0,0,0.13) !important; }
        .stat-card:hover { transform: translateY(-3px) !important; }
        .filter-btn:hover { opacity: 0.85 !important; }
      `}</style>

      {/* ── Top Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #2563eb 100%)',
        padding: '0 0 0 0',
        boxShadow: '0 4px 24px rgba(37,99,235,0.25)'
      }}>
        <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '20px 28px' }}>
          {/* Brand row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '56px', height: '56px',
                background: 'linear-gradient(135deg, #818cf8, #c084fc)',
                borderRadius: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '30px', boxShadow: '0 4px 16px rgba(96,165,250,0.45)'
              }}>🏛️</div>
              <div>
                <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: 'white', letterSpacing: '-0.3px' }}>
                  Unified Merchant Onboarding
                </h1>
                <p style={{ margin: 0, fontSize: '14px', color: '#bfdbfe', marginTop: '3px' }}>
                  AI-Powered &nbsp;·&nbsp; Event-Driven &nbsp;·&nbsp; Real-Time Risk Assessment
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={loadApplications}
                style={{
                  padding: '11px 20px',
                  background: 'rgba(255,255,255,0.15)',
                  color: '#ffffff',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  borderRadius: '10px',
                  fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  letterSpacing: '0.02em',
                }}
              >
                ↺ Refresh
              </button>
              <button
                onClick={() => navigate('/review')}
                style={{
                  padding: '11px 20px',
                  background: stats.review > 0
                    ? 'linear-gradient(135deg, #0ea5e9, #0284c7)'
                    : 'rgba(255,255,255,0.15)',
                  color: 'white',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  borderRadius: '10px',
                  fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                  position: 'relative',
                  backdropFilter: 'blur(8px)',
                  letterSpacing: '0.02em',
                }}
              >
                👥 Review Console
                {stats.review > 0 && (
                  <span style={{
                    position: 'absolute', top: '-8px', right: '-8px',
                    background: '#ef4444', color: 'white',
                    width: '20px', height: '20px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 'bold'
                  }}>{stats.review}</span>
                )}
              </button>
              <button
                onClick={() => navigate('/application/new')}
                style={{
                  padding: '11px 24px',
                  background: 'linear-gradient(135deg, #ffffff, #dbeafe)',
                  color: '#1e3a8a',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '14px', fontWeight: 800, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  letterSpacing: '0.02em',
                }}
              >
                + New Application
              </button>
            </div>
          </div>

          {/* AI Pipeline visualization */}
          <div style={{
            marginTop: '20px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '14px',
            padding: '14px 20px',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '11px', fontWeight: 700, color: '#818cf8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              AI Processing Pipeline
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {pipelineSteps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'rgba(255,255,255,0.07)',
                    borderRadius: '10px', padding: '8px 14px',
                    border: '1px solid rgba(255,255,255,0.12)'
                  }}>
                    <span style={{ fontSize: '22px' }}>{step.icon}</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{step.label}</div>
                      <div style={{ fontSize: '12px', color: '#bfdbfe' }}>{step.sub}</div>
                    </div>
                  </div>
                  {i < pipelineSteps.length - 1 && (
                    <div style={{ color: '#93c5fd', fontSize: '18px', flexShrink: 0, fontWeight: 700 }}>→</div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '20px 28px 40px' }}>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Total', value: stats.total, icon: '📊', color: '#6366f1', bg: '#eef2ff', filter: 'ALL' },
            { label: 'Draft', value: stats.draft, icon: '📝', color: '#f59e0b', bg: '#fffbeb', filter: 'DRAFT' },
            { label: 'Processing', value: stats.processing, icon: '⚙️', color: '#3b82f6', bg: '#eff6ff', filter: 'PROCESSING' },
            { label: 'In Review', value: stats.review, icon: '🔎', color: '#8b5cf6', bg: '#f5f3ff', filter: 'MANUAL_REVIEW' },
            { label: 'Approved', value: stats.approved, icon: '✅', color: '#10b981', bg: '#ecfdf5', filter: 'APPROVED' },
            { label: 'Rejected', value: stats.rejected, icon: '❌', color: '#ef4444', bg: '#fef2f2', filter: 'REJECTED' },
          ].map(stat => (
            <div
              key={stat.label}
              className="stat-card"
              onClick={() => setFilter(filter === stat.filter ? 'ALL' : stat.filter)}
              style={{
                background: filter === stat.filter ? stat.bg : 'white',
                borderRadius: '12px',
                padding: '14px 16px',
                boxShadow: filter === stat.filter
                  ? `0 0 0 2px ${stat.color}, 0 4px 16px rgba(0,0,0,0.07)`
                  : '0 2px 8px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                animation: 'fadeIn 0.4s ease'
              }}
            >
              <div style={{ fontSize: '28px', marginBottom: '6px' }}>{stat.icon}</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Active filter badge */}
        {filter !== 'ALL' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Filtering by:</span>
            <span style={{
              padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
              background: statusColor[filter] + '20', color: statusColor[filter], border: `1px solid ${statusColor[filter]}40`
            }}>
              {statusLabel[filter] || filter}
            </span>
            <button
              onClick={() => setFilter('ALL')}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '13px', padding: '2px 8px', borderRadius: '6px' }}
            >
              ✕ Clear
            </button>
          </div>
        )}

        {/* Applications section */}
        {filteredApps.length === 0 ? (
          <div style={{
            background: 'white', borderRadius: '16px', padding: '60px 32px',
            textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            animation: 'fadeIn 0.4s ease'
          }}>
            <div style={{ fontSize: '72px', marginBottom: '20px' }}>
              {filter === 'ALL' ? '📭' : '🔍'}
            </div>
            <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#1e293b', marginBottom: '10px' }}>
              {filter === 'ALL' ? 'No Applications Yet' : `No ${statusLabel[filter]} Applications`}
            </h3>
            <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '15px' }}>
              {filter === 'ALL'
                ? 'Get started by creating your first merchant application.'
                : `There are no applications with status "${statusLabel[filter]}".`}
            </p>
            {filter === 'ALL' && (
              <button
                onClick={() => navigate('/application/new')}
                style={{
                  padding: '14px 32px',
                  background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                  color: 'white', border: 'none', borderRadius: '12px',
                  fontSize: '15px', fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(37,99,235,0.35)',
                  letterSpacing: '0.02em',
                }}
              >
                + Create First Application
              </button>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
                {filter === 'ALL' ? 'All Applications' : `${statusLabel[filter]} Applications`}
                <span style={{ marginLeft: '10px', fontSize: '15px', color: '#64748b', fontWeight: 500 }}>
                  ({filteredApps.length})
                </span>
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
              {filteredApps.map(app => {
                const isDraft = app.status === 'DRAFT';
                const nextRoute = isDraft
                  ? `/application/${app.id}/documents`
                  : `/application/${app.id}/status`;
                const docsUploaded = app.documents?.length ?? 0;
                const color = statusColor[app.status] || '#6b7280';
                const location = [(app as any).city, app.country].filter(Boolean).join(', ');

                const draftSteps = [
                  { label: 'Application Info', done: true },
                  { label: 'Upload Documents', done: docsUploaded > 0 },
                  { label: 'Submit for Review', done: false },
                ];
                const draftStep = docsUploaded > 0 ? 1 : 0;

                return (
                  <div
                    key={app.id}
                    className="app-card"
                    onClick={() => navigate(nextRoute)}
                    style={{
                      background: 'white',
                      borderRadius: '14px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      boxShadow: isDraft
                        ? `0 2px 12px rgba(0,0,0,0.07), 0 0 0 2px ${color}50`
                        : '0 2px 12px rgba(0,0,0,0.07)',
                      transition: 'all 0.22s ease',
                      animation: 'fadeIn 0.4s ease'
                    }}
                  >
                    {/* Status bar */}
                    <div style={{
                      height: '5px',
                      background: `linear-gradient(90deg, ${color}, ${color}88)`
                    }} />

                    <div style={{ padding: '16px' }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {app.businessName}
                          </h3>
                          <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {app.id.slice(0, 8)}…
                          </p>
                        </div>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: '20px',
                          fontSize: '12px', fontWeight: 700,
                          background: color + '18',
                          color: color,
                          border: `1px solid ${color}40`,
                          flexShrink: 0, marginLeft: '10px'
                        }}>
                          {statusLabel[app.status] || app.status}
                        </span>
                      </div>

                      {/* Info grid */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569' }}>
                          <span>🏢</span>
                          <span>{app.businessType}</span>
                        </div>
                        {location && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#475569' }}>
                            <span>📍</span>
                            <span>{location}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#475569' }}>
                          <span>📧</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.contactEmail}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#475569' }}>
                          <span>📄</span>
                          <span>{docsUploaded} document{docsUploaded !== 1 ? 's' : ''} uploaded</span>
                        </div>
                      </div>

                      {/* Draft step progress */}
                      {isDraft && (
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                            {draftSteps.map((s, i) => (
                              <div key={i} style={{ flex: 1 }}>
                                <div style={{
                                  height: '4px', borderRadius: '4px',
                                  background: s.done ? '#10b981' : i === draftStep ? '#f59e0b' : '#e2e8f0'
                                }} />
                                <div style={{
                                  fontSize: '12px', marginTop: '3px', fontWeight: 700, textAlign: 'center',
                                  color: s.done ? '#10b981' : i === draftStep ? '#f59e0b' : '#94a3b8'
                                }}>
                                  {s.done ? '✓' : i === draftStep ? '→' : '○'} {s.label}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Agent results pills */}
                      {app.agentResults && app.agentResults.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                          {app.agentResults.map(r => {
                            const agentColor = r.status === 'PASSED' ? '#10b981'
                              : r.status === 'FAILED' ? '#ef4444'
                              : r.status === 'MANUAL_REVIEW_REQUIRED' ? '#f59e0b'
                              : '#94a3b8';
                            return (
                              <span key={r.agentType} style={{
                                fontSize: '12px', fontWeight: 700,
                                padding: '3px 10px', borderRadius: '12px',
                                background: agentColor + '18', color: agentColor,
                                border: `1px solid ${agentColor}40`
                              }}>
                                {r.agentType} {r.score != null ? `${r.score}%` : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* CTA */}
                      <div style={{
                        borderTop: '1px solid #f1f5f9', paddingTop: '12px',
                        display: 'flex', justifyContent: isDraft ? 'center' : 'flex-end'
                      }}>
                        {isDraft ? (
                          <div style={{
                            width: '100%', padding: '10px',
                            background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                            color: 'white', borderRadius: '8px',
                            fontSize: '13px', fontWeight: 700, textAlign: 'center',
                            boxShadow: '0 3px 10px rgba(37,99,235,0.3)',
                            letterSpacing: '0.02em',
                          }}>
                            ▶ Resume Application
                          </div>
                        ) : (
                          <div style={{
                            padding: '8px 16px',
                            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                            color: '#1d4ed8',
                            borderRadius: '8px',
                            fontSize: '13px', fontWeight: 700,
                            border: '1px solid #bfdbfe',
                            cursor: 'pointer',
                            letterSpacing: '0.01em',
                          }}>
                            View Details →
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

