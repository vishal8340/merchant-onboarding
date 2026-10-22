import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MerchantApplication, AgentStatus } from '../types';
import { useAuth } from '../context/AuthContext';
export const ReviewConsole: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [applications, setApplications] = useState<MerchantApplication[]>([]);
  const [selectedApp, setSelectedApp] = useState<MerchantApplication | null>(null);
  const [comments, setComments] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const toggleAgent = (agentType: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentType)) { next.delete(agentType); } else { next.add(agentType); }
      return next;
    });
  };

  const getAgentStatusColor = (status: AgentStatus): string => {
    const colors: Record<string, string> = {
      PASSED: '#10b981', FAILED: '#ef4444',
      MANUAL_REVIEW_REQUIRED: '#f59e0b', PENDING: '#9ca3af', IN_PROGRESS: '#3b82f6'
    };
    return colors[status] || '#9ca3af';
  };

  useEffect(() => {
    loadPendingReviews();
  }, []);

  const loadPendingReviews = async () => {
    try {
      const apps = await api.getPendingReviews();
      setApplications(apps);
      if (apps.length > 0 && !selectedApp) {
        setSelectedApp(apps[0]);
      }
    } catch (error) {
      console.error('Failed to load pending reviews:', error);
    }
  };

  const handleDecision = async (decision: 'APPROVE' | 'REJECT') => {
    if (!selectedApp || !reviewerName.trim()) {
      showToast('Please enter reviewer name before submitting.', 'warning');
      return;
    }

    setIsSubmitting(true);
    const appName = selectedApp.businessName;
    try {
      await api.submitReviewDecision(selectedApp.id, decision, comments, reviewerName);
      const remaining = applications.filter(app => app.id !== selectedApp.id);
      setApplications(remaining);
      setSelectedApp(remaining.length > 0 ? remaining[0] : null);
      setComments('');
      if (decision === 'APPROVE') {
        showToast(`✅ "${appName}" has been approved successfully.`, 'success');
      } else {
        showToast(`🚫 "${appName}" has been rejected.`, 'error');
      }
    } catch (error) {
      showToast('Failed to submit decision. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toastColors = {
    success: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '✅' },
    error:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '🚫' },
    warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '⚠️' },
  };

  if (applications.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '40px 20px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{
            background: 'white', borderRadius: '20px', padding: '80px 40px',
            textAlign: 'center', boxShadow: '0 8px 32px rgba(37,99,235,0.08)',
            border: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: '80px', marginBottom: '24px' }}>✅</div>
            <h2 style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginBottom: '12px' }}>All Clear!</h2>
            <p style={{ fontSize: '16px', color: '#64748b', marginBottom: '36px' }}>No applications pending manual review at this time</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', background: '#f1f5f9', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastIn { from { opacity:0; transform:translateX(60px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(60px); } }
        .queue-item:hover { background: #eff6ff !important; border-color: #93c5fd !important; }
        .rc-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
      `}</style>

      {/* ── Toast Notification ── */}
      {toast && (() => {
        const t = toastColors[toast.type];
        return (
          <div style={{
            position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
            background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: '14px',
            padding: '16px 20px', minWidth: '320px', maxWidth: '420px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            display: 'flex', alignItems: 'flex-start', gap: '12px',
            animation: 'toastIn 0.3s ease',
          }}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>{t.icon}</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: t.text, lineHeight: 1.5 }}>{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text, fontSize: '18px', lineHeight: 1, padding: 0, opacity: 0.6 }}>✕</button>
          </div>
        );
      })()}

      {/* ── Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #2563eb 100%)',
        color: 'white', padding: '18px 32px',
        boxShadow: '0 4px 20px rgba(30,58,138,0.35)', flexShrink: 0,
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px',
              backdropFilter: 'blur(8px)',
            }}>👨‍⚖️</div>
            <div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 3px', letterSpacing: '-0.3px' }}>Review Console</h1>
              <p style={{ fontSize: '14px', margin: 0, color: '#bfdbfe' }}>Manual review queue · Human oversight decisions</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{
              background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.3)',
              borderRadius: '12px', padding: '10px 20px', textAlign: 'center', backdropFilter: 'blur(8px)',
            }}>
              <div style={{ fontSize: '26px', fontWeight: 800 }}>{applications.length}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#bfdbfe', letterSpacing: '0.04em' }}>PENDING</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' as const }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px 24px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>

          {/* ── Queue Panel ── */}
          <div style={{
            background: 'white', borderRadius: '14px', padding: '16px',
            boxShadow: '0 4px 16px rgba(37,99,235,0.08)', border: '1px solid #e2e8f0',
            maxHeight: '75vh', overflow: 'auto', alignSelf: 'start',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 800, margin: 0, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Review Queue
              </h2>
              <span style={{
                fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
              }}>{applications.length} pending</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {applications.map(app => {
                const isSelected = selectedApp?.id === app.id;

                // Collect scores from all agents that flagged for manual review
                const agentLabels: Record<string, string> = { KYC: 'KYC', MCC: 'MCC', RISK: 'Risk' };
                const agentScores = (app.agentResults ?? [])
                  .filter(r => r.score != null)
                  .map(r => ({
                    label: agentLabels[r.agentType] ?? r.agentType,
                    score: r.score as number,
                    flagged: r.status === 'MANUAL_REVIEW_REQUIRED' || r.status === 'FAILED',
                  }));

                return (
                  <div key={app.id} className="queue-item"
                    onClick={() => setSelectedApp(app)}
                    style={{
                      padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                      background: isSelected ? '#eff6ff' : '#f8fafc',
                      border: `1.5px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}`,
                      transition: 'all 0.18s',
                      boxShadow: isSelected ? '0 0 0 3px rgba(59,130,246,0.12)' : 'none',
                      animation: 'fadeIn 0.3s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <p style={{ fontWeight: 700, fontSize: '14px', margin: 0, color: '#0f172a' }}>{app.businessName}</p>
                    </div>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 8px' }}>{app.businessType} · {app.country}</p>
                    {/* Agent score pills */}
                    {agentScores.length > 0 && (
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        {agentScores.map(({ label, score, flagged }) => {
                          const bg = flagged
                            ? (score >= 70 ? '#fef9c3' : score >= 40 ? '#fff7ed' : '#fef2f2')
                            : '#f0fdf4';
                          const textColor = flagged
                            ? (score >= 70 ? '#a16207' : score >= 40 ? '#c2410c' : '#dc2626')
                            : '#15803d';
                          const border = flagged
                            ? (score >= 70 ? '#fde047' : score >= 40 ? '#fdba74' : '#fca5a5')
                            : '#86efac';
                          return (
                            <span key={label} style={{
                              fontSize: '11px', fontWeight: 700, padding: '2px 7px',
                              borderRadius: '6px', background: bg, color: textColor,
                              border: `1px solid ${border}`,
                              display: 'inline-flex', alignItems: 'center', gap: '3px',
                            }}>
                              <span style={{ fontSize: '10px', opacity: 0.7 }}>{label}</span>
                              {score}
                              {flagged && <span style={{ fontSize: '9px' }}>⚠</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {isSelected && <div style={{ marginTop: '8px', height: '3px', borderRadius: '3px', background: 'linear-gradient(90deg, #1d4ed8, #60a5fa)' }} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Detail Panel ── */}
          {selectedApp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'fadeIn 0.3s ease' }}>

              {/* Business Info Card */}
              <div style={{
                background: 'white', borderRadius: '14px', padding: '18px 22px',
                boxShadow: '0 4px 16px rgba(37,99,235,0.08)', border: '1px solid #e2e8f0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{
                    width: '44px', height: '44px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: '1.5px solid #bfdbfe',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px',
                  }}>🏢</div>
                  <div>
                    <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#0f172a' }}>{selectedApp.businessName}</h2>
                    <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>{selectedApp.businessType} · {selectedApp.country}</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  {[
                    { label: 'Tax ID', value: selectedApp.taxId, icon: '🪪' },
                    { label: 'Phone', value: selectedApp.contactPhone, icon: '📞' },
                    { label: 'Email', value: selectedApp.contactEmail, icon: '📧' },
                  ].map((item, idx) => (
                    <div key={idx} style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 14px', border: '1px solid #f1f5f9' }}>
                      <p style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {item.icon} {item.label}
                      </p>
                      <p style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#1e293b', wordBreak: 'break-all' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Results */}
              <div style={{
                background: 'white', borderRadius: '14px', padding: '18px 22px',
                boxShadow: '0 4px 16px rgba(37,99,235,0.08)', border: '1px solid #e2e8f0',
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 14px' }}>AI Agent Results</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px,1fr))', gap: '12px', alignItems: 'start' }}>
                  {selectedApp.agentResults.map(result => {
                    const agentColor = getAgentStatusColor(result.status);
                    const cardBorderColor = result.status === 'PASSED' ? '#bbf7d0'
                      : result.status === 'FAILED' ? '#fecaca'
                      : result.status === 'MANUAL_REVIEW_REQUIRED' ? '#fde68a'
                      : '#e5e7eb';
                    const cardBg = result.status === 'PASSED' ? '#f0fdf4'
                      : result.status === 'FAILED' ? '#fff5f5'
                      : result.status === 'MANUAL_REVIEW_REQUIRED' ? '#fffbeb'
                      : 'white';

                    const categoriseFinding = (finding: string) => {
                      if (/Total words extracted by Textract|Textract processed \d+ document/i.test(finding)) return null;
                      if (finding.includes('smart-risk-scoring service unavailable')) return null;
                      const clean = finding.replace(/^(✅|❌|⚠️|⚠|⚡)\s*/u, '');
                      const isPositive = /^✅/.test(finding) || /^⚡/.test(finding) || /passed|verified|valid|found|extracted|processed|success|approved|complete/i.test(finding);
                      const isWarning  = /^⚠️|^⚠/.test(finding);
                      const isNegative = /^❌/.test(finding) || /fail|invalid|rejected|error|not found|unable|cannot|denied/i.test(finding);
                      if (isNegative) return { clean, icon: '✗', iconColor: '#ef4444', bg: '#fef2f2', border: '#fecaca' };
                      if (isWarning)  return { clean, icon: '⚠', iconColor: '#d97706', bg: '#fffbeb', border: '#fde68a' };
                      if (isPositive) return { clean, icon: '✓', iconColor: '#10b981', bg: '#f0fdf4', border: '#bbf7d0' };
                      return { clean, icon: '·', iconColor: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' };
                    };

                    const visibleFindings = result.findings.map(categoriseFinding).filter(Boolean) as {
                      clean: string; icon: string; iconColor: string; bg: string; border: string;
                    }[];
                    const successCount = visibleFindings.filter(f => f.icon === '✓').length;
                    const failCount    = visibleFindings.filter(f => f.icon === '✗').length;
                    const warnCount    = visibleFindings.filter(f => f.icon === '⚠').length;
                    const isExpanded   = expandedAgents.has(result.agentType);

                    return (
                      <div key={result.agentType} style={{ border: `2px solid ${cardBorderColor}`, borderRadius: '10px', background: cardBg, overflow: 'hidden' }}>
                        {/* Clickable header */}
                        <div onClick={() => toggleAgent(result.agentType)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer', userSelect: 'none' as const }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${agentColor}20`, color: agentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 'bold', flexShrink: 0 }}>
                              {result.status === 'PASSED' ? '✓' : result.status === 'FAILED' ? '✗' : result.status === 'MANUAL_REVIEW_REQUIRED' ? '⚠' : '⏱'}
                            </div>
                            <div>
                              <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 2px 0' }}>{result.agentType}</h3>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: agentColor }}>{result.status.replace(/_/g, ' ')}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {result.score !== undefined && (
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '28px', fontWeight: 'bold', color: agentColor, lineHeight: 1 }}>{result.score}</div>
                                <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>/ 100</div>
                              </div>
                            )}
                            {!isExpanded && visibleFindings.length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                                {successCount > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: '#10b981', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '1px 6px' }}>✓ {successCount}</span>}
                                {warnCount > 0    && <span style={{ fontSize: '10px', fontWeight: 700, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '999px', padding: '1px 6px' }}>⚠ {warnCount}</span>}
                                {failCount > 0    && <span style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '999px', padding: '1px 6px' }}>✗ {failCount}</span>}
                              </div>
                            )}
                            <span style={{ fontSize: '16px', color: '#6b7280', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease', display: 'inline-block' }}>▾</span>
                          </div>
                        </div>

                        {/* Collapsible body */}
                        <div style={{ maxHeight: isExpanded ? '1200px' : '0', overflow: 'hidden', transition: 'max-height 0.4s ease' }}>
                          <div style={{ padding: '0 14px 12px 14px', borderTop: `1px solid ${cardBorderColor}` }}>
                            {result.score !== undefined && (
                              <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                                <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', background: agentColor, width: isExpanded ? `${result.score}%` : '0%', transition: 'width 0.8s ease 0.2s', borderRadius: '999px' }} />
                                </div>
                              </div>
                            )}
                            {visibleFindings.length > 0 && (
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', marginTop: '10px' }}>
                                  <h4 style={{ fontWeight: 'bold', color: '#374151', margin: 0, fontSize: '13px' }}>📋 Findings</h4>
                                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '1px 7px' }}>✓ {successCount} passed</span>
                                  {warnCount > 0 && <span style={{ fontSize: '11px', fontWeight: 700, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '999px', padding: '1px 7px' }}>⚠ {warnCount} warning</span>}
                                  {failCount > 0  && <span style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '999px', padding: '1px 7px' }}>✗ {failCount} failed</span>}
                                </div>
                                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {visibleFindings.map((f, idx) => (
                                    <li key={idx} style={{ display: 'flex', gap: '10px', padding: '7px 11px', background: f.bg, border: `1px solid ${f.border}`, borderRadius: '8px', fontSize: '12px', color: '#374151', alignItems: 'flex-start' }}>
                                      <span style={{ color: f.iconColor, fontWeight: 'bold', fontSize: '13px', flexShrink: 0, lineHeight: 1.5 }}>{f.icon}</span>
                                      <span style={{ lineHeight: 1.5 }}>{f.clean}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Decision Form ── */}
              <div style={{
                background: 'white', borderRadius: '14px', padding: '18px 22px',
                boxShadow: '0 4px 16px rgba(37,99,235,0.08)',
                border: '1.5px solid #bfdbfe',
                borderTop: '3px solid #1d4ed8',
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 16px' }}>
                  ⚖️ Make Decision
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '13px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Reviewer Name *
                    </label>
                    <input
                      type="text"
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="Your name"
                      style={{
                        width: '100%', padding: '11px 14px',
                        border: '1.5px solid #e2e8f0', borderRadius: '9px',
                        fontSize: '15px', boxSizing: 'border-box' as const,
                        outline: 'none', fontFamily: 'inherit', color: '#1e293b',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontWeight: 700, marginBottom: '6px', fontSize: '13px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Comments
                    </label>
                    <textarea
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Add review comments..."
                      rows={2}
                      style={{
                        width: '100%', padding: '11px 14px',
                        border: '1.5px solid #e2e8f0', borderRadius: '9px',
                        fontSize: '15px', fontFamily: 'inherit', boxSizing: 'border-box' as const,
                        resize: 'vertical' as const, outline: 'none', color: '#1e293b',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <button className="rc-btn"
                    onClick={() => handleDecision('REJECT')}
                    disabled={isSubmitting}
                    style={{
                      padding: '14px', background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: 'white', border: 'none', borderRadius: '12px',
                      fontSize: '15px', fontWeight: 700, cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting ? 0.5 : 1, transition: 'all 0.2s',
                      boxShadow: '0 4px 14px rgba(239,68,68,0.3)', letterSpacing: '0.02em',
                    }}
                  >
                    ✗ Reject Application
                  </button>
                  <button className="rc-btn"
                    onClick={() => handleDecision('APPROVE')}
                    disabled={isSubmitting}
                    style={{
                      padding: '14px', background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: 'white', border: 'none', borderRadius: '12px',
                      fontSize: '15px', fontWeight: 700, cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting ? 0.5 : 1, transition: 'all 0.2s',
                      boxShadow: '0 4px 14px rgba(16,185,129,0.3)', letterSpacing: '0.02em',
                    }}
                  >
                    ✓ Approve Application
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};