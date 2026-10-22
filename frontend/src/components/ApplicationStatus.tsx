import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MerchantApplication, AgentStatus } from '../types';
import { useAuth } from '../context/AuthContext';

export const ApplicationStatus: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [application, setApplication] = useState<MerchantApplication | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const toggleAgent = (agentType: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentType)) { next.delete(agentType); } else { next.add(agentType); }
      return next;
    });
  };
  const autoRetriedRef = useRef(false);

  useEffect(() => {
    if (!id || !application || autoRetriedRef.current) return;
    const riskResult = application.agentResults.find((r: any) => r.agentType === 'RISK');
    const needsRetry = riskResult?.findings?.some((f: string) => f.includes('smart-risk-scoring service unavailable'));
    if (needsRetry) {
      autoRetriedRef.current = true;
      api.retryRiskAssessment(id)
        .then(() => loadApplication())
        .catch(err => console.error('[AutoRetry] Risk retry failed:', err));
    }
  }, [application, id]);

  useEffect(() => {
    loadApplication();
    const interval = setInterval(loadApplication, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [id]);

  // Auto-generate password when newly approved and password not yet assigned
  useEffect(() => {
    if (!application || application.status !== 'APPROVED') return;
    if (application.merchantPassword) return; // already has password
    setCredentialsLoading(true);
    api.generateCredentials(application.id)
      .then(creds => {
        setApplication(prev => prev ? { ...prev, merchantId: creds.merchantId, merchantPassword: creds.merchantPassword } : prev);
      })
      .catch(err => console.error('Failed to generate credentials:', err))
      .finally(() => setCredentialsLoading(false));
  }, [application?.status, application?.merchantPassword]);

  const loadApplication = async () => {
    if (!id) return;
    try {
      const app = await api.getApplication(id);
      setApplication(app);
    } catch (error) {
      console.error('Failed to load application:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{
            width: '80px',
            height: '80px',
            border: '6px solid rgba(255,255,255,0.3)',
            borderTop: '6px solid white',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 24px'
          }}></div>
          <p style={{ fontSize: '20px', fontWeight: '600' }}>Loading application status...</p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }}`}</style>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f4f6',
        padding: '20px'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '16px',
          padding: '60px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: '80px', marginBottom: '20px' }}>❌</div>
          <h2 style={{ fontSize: '32px', fontWeight: 'bold', color: '#1f2937', marginBottom: '12px' }}>
            Application Not Found
          </h2>
          <p style={{ color: '#6b7280', marginBottom: '30px', fontSize: '16px' }}>
            The application you're looking for doesn't exist
          </p>
          {isAdmin && (
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '16px 32px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'
              }}
            >
              ← Back to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  const getStatusGradient = (status: string): string => {
    const gradients: Record<string, string> = {
      DRAFT: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
      SUBMITTED: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
      PROCESSING: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
      MANUAL_REVIEW: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      APPROVED: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      REJECTED: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
    };
    return gradients[status] || gradients.PROCESSING;
  };

  const getStatusIcon = (status: string): string => {
    const icons: Record<string, string> = {
      DRAFT: '📝',
      SUBMITTED: '📤',
      PROCESSING: '⚙️',
      MANUAL_REVIEW: '👀',
      APPROVED: '✓',
      REJECTED: '✗'
    };
    return icons[status] || '⏳';
  };

  const getAgentStatusColor = (status: AgentStatus): string => {
    const colors: Record<string, string> = {
      PASSED: '#10b981',
      FAILED: '#ef4444',
      MANUAL_REVIEW_REQUIRED: '#f59e0b',
      PENDING: '#9ca3af',
      IN_PROGRESS: '#3b82f6'
    };
    return colors[status] || '#9ca3af';
  };

  return (
    <div style={{ height: '100%', background: '#f8fafc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header — matches DocumentIntelligence / DocumentUpload style */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 28px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '36px' }}>📋</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.5px' }}>Application Status</h1>
            <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Track your merchant onboarding progress</p>
          </div>
        </div>

      </div>

      <div style={{ flex: 1, overflowY: 'auto' as const }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '10px 20px 16px' }}>
        {/* Hero Status Card — hidden for APPROVED (banner below replaces it) */}
        {application.status !== 'APPROVED' && (
        <div style={{
          background: getStatusGradient(application.status),
          borderRadius: '12px',
          padding: '10px 16px',
          color: 'white',
          marginBottom: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '26px' }}>{getStatusIcon(application.status)}</div>
              <div>
                <h1 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 2px 0' }}>
                  {application.status.replace(/_/g, ' ')}
                </h1>
                <p style={{ fontSize: '12px', margin: 0, opacity: 0.85 }}>
                  {application.status === 'REJECTED' ? 'Unfortunately, your application was not approved' :
                   application.status === 'MANUAL_REVIEW' ? 'Our team is reviewing your application' :
                   application.status === 'PROCESSING' ? 'Your application is being verified by our agents' :
                   'Application submitted successfully'}
                </p>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── APPROVED: Premium Onboarding Card ── */}
        {application.status === 'APPROVED' && (
          <div style={{ marginBottom: '16px' }}>
            <style>{`
              @keyframes apvFadeUp { 0%{opacity:0;transform:translateY(20px)} 100%{opacity:1;transform:translateY(0)} }
              @keyframes checkPop { 0%{transform:scale(0.4);opacity:0} 65%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
              @keyframes ringPulse { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0.3)} 60%{box-shadow:0 0 0 12px rgba(16,185,129,0)} }
              @keyframes apvSpin { to{transform:rotate(360deg)} }
              .apv-wrap { animation: apvFadeUp 0.5s cubic-bezier(.22,.68,0,1.1) both; }
              .apv-row { transition: background 0.15s ease; }
              .apv-row:hover { background: #f8fafc !important; }
              .apv-cpbtn { transition: all 0.15s ease; }
              .apv-cpbtn:hover { filter: brightness(1.08); transform: scale(1.03); }
              .apv-cpbtn:active { transform: scale(0.97); }
              .apv-step:hover { background: #f0fdf4; transform: translateX(3px); }
              .apv-step { transition: all 0.18s ease; border-radius: 10px; padding: 10px 12px; }
            `}</style>

            <div className="apv-wrap" style={{ background:'white', borderRadius:'20px', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.09)', border:'1px solid #e2e8f0' }}>

              {/* ── Dark header strip ── */}
              <div style={{ background:'linear-gradient(135deg,#065f46 0%,#047857 45%,#059669 100%)', padding:'26px 28px', position:'relative', overflow:'hidden' }}>
                <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0.035 }} xmlns="http://www.w3.org/2000/svg"><defs><pattern id="apvg" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="white" strokeWidth="0.6"/></pattern></defs><rect width="100%" height="100%" fill="url(#apvg)"/></svg>
                <div style={{ position:'absolute', top:'-50px', right:'-50px', width:'180px', height:'180px', borderRadius:'50%', background:'radial-gradient(circle,rgba(52,211,153,0.15),transparent 70%)' }} />
                <div style={{ position:'absolute', bottom:'-30px', left:'20%', width:'130px', height:'130px', borderRadius:'50%', background:'radial-gradient(circle,rgba(16,185,129,0.1),transparent 70%)' }} />

                <div style={{ position:'relative', display:'flex', alignItems:'center', gap:'18px' }}>
                  <div style={{ width:'56px', height:'56px', borderRadius:'50%', background:'linear-gradient(135deg,#10b981,#34d399)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, animation:'checkPop 0.55s cubic-bezier(.22,.68,0,1.2) 0.15s both, ringPulse 3s 0.7s infinite' }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'5px' }}>
                      <span style={{ background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#6ee7b7', fontSize:'10px', fontWeight:'800', padding:'2px 9px', borderRadius:'20px', letterSpacing:'0.1em', textTransform:'uppercase' }}>● Live</span>
                      <span style={{ color:'rgba(255,255,255,0.35)', fontSize:'11px' }}>·</span>
                      <span style={{ color:'rgba(255,255,255,0.4)', fontSize:'11px' }}>Onboarded {new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>
                    </div>
                    <h2 style={{ margin:'0 0 4px', fontSize:'20px', fontWeight:'900', color:'#fff', letterSpacing:'-0.3px', lineHeight:1.2 }}>
                      {application.businessName} is now live!
                    </h2>
                    <p style={{ margin:0, fontSize:'12px', color:'rgba(167,243,208,0.8)', lineHeight:1.5 }}>
                      Your merchant account is active and ready to accept payments.
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Credentials ── */}
              {credentialsLoading ? (
                <div style={{ padding:'40px', textAlign:'center' }}>
                  <div style={{ width:'40px', height:'40px', border:'3px solid #e2e8f0', borderTop:'3px solid #10b981', borderRadius:'50%', animation:'apvSpin 0.8s linear infinite', margin:'0 auto 14px' }} />
                  <p style={{ margin:0, fontSize:'14px', fontWeight:'700', color:'#047857' }}>Generating your credentials…</p>
                  <p style={{ margin:'3px 0 0', fontSize:'12px', color:'#9ca3af' }}>Just a moment</p>
                </div>
              ) : application.merchantId ? (<>

                {/* credential table */}
                <div style={{ padding:'6px 24px 2px' }}>
                  {/* MID row */}
                  <div className="apv-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 10px', gap:'12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', minWidth:0 }}>
                      <div style={{ width:'38px', height:'38px', borderRadius:'11px', background:'#ecfdf5', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                      </div>
                      <div style={{ minWidth:0 }}>
                        <p style={{ margin:'0 0 1px', fontSize:'10px', fontWeight:'800', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.1em' }}>Merchant ID</p>
                        <code style={{ fontSize:'14px', fontWeight:'800', color:'#0f172a', letterSpacing:'0.06em', fontFamily:'"SF Mono","Fira Code","Cascadia Code",monospace', wordBreak:'break-all' }}>{application.merchantId}</code>
                      </div>
                    </div>
                    <button className="apv-cpbtn" onClick={() => copyToClipboard(application.merchantId!, 'mid')} style={{ padding:'7px 14px', borderRadius:'8px', fontSize:'11px', fontWeight:'700', background: copiedField==='mid' ? '#10b981' : '#f0fdf4', color: copiedField==='mid' ? 'white' : '#059669', border:`1.5px solid ${copiedField==='mid' ? '#10b981' : '#a7f3d0'}`, cursor:'pointer', display:'flex', alignItems:'center', gap:'5px', whiteSpace:'nowrap', flexShrink:0 }}>
                      {copiedField==='mid'
                        ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                        : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                      }
                    </button>
                  </div>

                  <div style={{ height:'1px', background:'#f1f5f9' }} />

                  {/* Password row */}
                  <div className="apv-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 10px', gap:'12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'14px', minWidth:0 }}>
                      <div style={{ width:'38px', height:'38px', borderRadius:'11px', background:'#f5f3ff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </div>
                      <div style={{ minWidth:0 }}>
                        <p style={{ margin:'0 0 1px', fontSize:'10px', fontWeight:'800', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.1em' }}>Password</p>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                          <code style={{ fontSize:'14px', fontWeight:'800', color:'#0f172a', letterSpacing:'0.1em', fontFamily:'"SF Mono","Fira Code","Cascadia Code",monospace' }}>
                            {showPassword ? application.merchantPassword : '•'.repeat(12)}
                          </code>
                          <button onClick={() => setShowPassword(v => !v)} style={{ background:'none', border:'none', cursor:'pointer', padding:'2px', color:'#9ca3af', lineHeight:1, transition:'color 0.15s' }} title={showPassword ? 'Hide' : 'Show'}>
                            {showPassword
                              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            }
                          </button>
                        </div>
                      </div>
                    </div>
                    <button className="apv-cpbtn" onClick={() => copyToClipboard(application.merchantPassword!, 'pwd')} style={{ padding:'7px 14px', borderRadius:'8px', fontSize:'11px', fontWeight:'700', background: copiedField==='pwd' ? '#7c3aed' : '#f5f3ff', color: copiedField==='pwd' ? 'white' : '#7c3aed', border:`1.5px solid ${copiedField==='pwd' ? '#7c3aed' : '#c4b5fd'}`, cursor:'pointer', display:'flex', alignItems:'center', gap:'5px', whiteSpace:'nowrap', flexShrink:0 }}>
                      {copiedField==='pwd'
                        ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                        : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                      }
                    </button>
                  </div>
                </div>

                {/* security notice */}
                <div style={{ margin:'4px 16px 16px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'10px', padding:'10px 14px', display:'flex', alignItems:'flex-start', gap:'9px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:'1px' }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <p style={{ margin:0, fontSize:'12px', color:'#92400e', lineHeight:1.6 }}><strong>Save before leaving.</strong> Password is shown only once and cannot be recovered after this session.</p>
                </div>

                {/* what's next vertical stepper */}
                <div style={{ borderTop:'1px solid #f1f5f9', padding:'16px 24px 20px' }}>
                  <p style={{ margin:'0 0 12px', fontSize:'10px', fontWeight:'800', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.12em' }}>What happens next</p>
                  {[
                    { color:'#059669', bg:'#ecfdf5', path:<><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>, title:'Save your credentials', desc:'Copy both values to a password manager before leaving this page.' },
                    { color:'#2563eb', bg:'#eff6ff', path:<><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>, title:'Log in to merchant portal', desc:'Use your Merchant ID and password to access the payment portal.' },
                    { color:'#7c3aed', bg:'#f5f3ff', path:<><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>, title:'Start accepting payments', desc:'Your gateway is live. Configure your store and go live today.' },
                  ].map((s, i, arr) => (
                    <div key={i} className="apv-step" style={{ display:'flex', gap:'14px', alignItems:'flex-start' }}>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0, paddingTop:'2px' }}>
                        <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:s.bg, border:`2px solid ${s.color}30`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{s.path}</svg>
                        </div>
                        {i < arr.length - 1 && <div style={{ width:'2px', height:'16px', background:'#e2e8f0', marginTop:'3px' }} />}
                      </div>
                      <div style={{ paddingBottom: i < arr.length-1 ? '10px' : '0', paddingTop:'4px' }}>
                        <p style={{ margin:'0 0 2px', fontSize:'13px', fontWeight:'700', color:'#111827' }}>{s.title}</p>
                        <p style={{ margin:0, fontSize:'12px', color:'#6b7280', lineHeight:1.5 }}>{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

              </>) : null}
            </div>
          </div>
        )}

        {/* ── DRAFT: Resume banner ── */}
        {application.status === 'DRAFT' && (
          <div style={{
            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
            border: '2px solid #f59e0b',
            borderRadius: '14px',
            padding: '16px 20px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '32px' }}>✏️</span>
              <div>
                <p style={{ margin: '0 0 3px', fontSize: '15px', fontWeight: '800', color: '#92400e' }}>
                  Application In Draft — Continue Where You Left Off
                </p>
                <p style={{ margin: 0, fontSize: '13px', color: '#b45309' }}>
                  {(application.documents?.length ?? 0) === 0
                    ? 'No documents uploaded yet. Go to Step 2 to upload your required documents.'
                    : `${application.documents.length} document(s) uploaded. Review and submit when ready.`}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate(`/application/${id}/documents`)}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(245,158,11,0.4)',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              ▶ Resume — Upload Documents
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '30px' }}>
          {/* Agent Results */}
          {application.agentResults.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '14px 18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.07)'
              }}>
                <h2 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                  🤖 Agent Verification Results
                </h2>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px', alignItems: 'start' }}>
                  {application.agentResults.map((result) => {
                    const effectiveStatus: AgentStatus = result.status;
                    const agentColor = getAgentStatusColor(effectiveStatus);
                    const cardBorderColor = effectiveStatus === 'PASSED' ? '#bbf7d0'
                      : effectiveStatus === 'FAILED' ? '#fecaca'
                      : effectiveStatus === 'MANUAL_REVIEW_REQUIRED' ? '#fde68a'
                      : '#e5e7eb';
                    const cardBg = effectiveStatus === 'PASSED' ? '#f0fdf4'
                      : effectiveStatus === 'FAILED' ? '#fff5f5'
                      : effectiveStatus === 'MANUAL_REVIEW_REQUIRED' ? '#fffbeb'
                      : 'white';

                    // Detect service-unavailable fallback for RISK agent
                    const hasServiceUnavailable = result.agentType === 'RISK' &&
                      result.findings.some((f: string) => f.includes('smart-risk-scoring service unavailable'));

                    // Categorise each finding
                    const categoriseFinding = (finding: string) => {
                      if (/Total words extracted by Textract|Textract processed \d+ document/i.test(finding)) return null;
                      if (finding.includes('smart-risk-scoring service unavailable')) return null;
                      const clean = finding.replace(/^(✅|❌|⚠️|⚠|⚡)\s*/u, '');
                      const isPositive = /^✅/.test(finding) || finding.startsWith('✅') || /^⚡/.test(finding) || finding.startsWith('⚡') || /passed|verified|valid|found|extracted|processed|success|approved|complete/i.test(finding);
                      const isWarning  = /^⚠️|^⚠/.test(finding) || finding.startsWith('⚠');
                      const isNegative = /^❌/.test(finding) || finding.startsWith('❌') || /fail|invalid|rejected|error|not found|unable|cannot|denied/i.test(finding);
                      if (isNegative) return { clean, icon: '✗', iconColor: '#ef4444', bg: '#fef2f2', border: '#fecaca' };
                      if (isWarning)  return { clean, icon: '⚠', iconColor: '#d97706', bg: '#fffbeb', border: '#fde68a' };
                      if (isPositive) return { clean, icon: '✓', iconColor: '#10b981', bg: '#f0fdf4', border: '#bbf7d0' };
                      // neutral — show with grey styling
                      return { clean, icon: '·', iconColor: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' };
                    };

                    const visibleFindings = result.findings.map(categoriseFinding).filter(Boolean) as {
                      clean: string; icon: string; iconColor: string; bg: string; border: string;
                    }[];
                    const successCount = visibleFindings.filter(f => f.icon === '✓').length;
                    const failCount    = visibleFindings.filter(f => f.icon === '✗').length;
                    const warnCount    = visibleFindings.filter(f => f.icon === '⚠').length;

                    const isExpanded = expandedAgents.has(result.agentType);
                    return (
                    <div
                      key={result.agentType}
                      style={{
                        border: `2px solid ${cardBorderColor}`,
                        borderRadius: '10px',
                        background: cardBg,
                        overflow: 'hidden'
                      }}
                    >
                      {/* Clickable header — always visible */}
                      <div
                        onClick={() => toggleAgent(result.agentType)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer', userSelect: 'none' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            background: `${agentColor}20`,
                            color: agentColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            flexShrink: 0
                          }}>
                            {effectiveStatus === 'PASSED' ? '✓' : 
                             effectiveStatus === 'FAILED' ? '✗' : 
                             effectiveStatus === 'MANUAL_REVIEW_REQUIRED' ? '⚠' : '⏱'}
                          </div>
                          <div>
                            <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 2px 0' }}>
                              {result.agentType}
                            </h3>
                            <span style={{ fontSize: '13px', fontWeight: '700', color: agentColor }}>
                              {effectiveStatus.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {result.score !== undefined && (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '28px', fontWeight: 'bold', color: agentColor, lineHeight: 1 }}>
                                {result.score}
                              </div>
                              <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: '600' }}>/ 100</div>
                            </div>
                          )}
                          {/* summary pills when collapsed */}
                          {!isExpanded && visibleFindings.length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {successCount > 0 && <span style={{ fontSize: '10px', fontWeight: '700', color: '#10b981', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '1px 6px' }}>✓ {successCount}</span>}
                              {warnCount > 0 && <span style={{ fontSize: '10px', fontWeight: '700', color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '999px', padding: '1px 6px' }}>⚠ {warnCount}</span>}
                              {failCount > 0 && <span style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '999px', padding: '1px 6px' }}>✗ {failCount}</span>}
                            </div>
                          )}
                          {/* chevron */}
                          <span style={{ fontSize: '16px', color: '#6b7280', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease', display: 'inline-block' }}>▾</span>
                        </div>
                      </div>

                      {/* Collapsible body */}
                      <div style={{
                        maxHeight: isExpanded ? '1200px' : '0',
                        overflow: 'hidden',
                        transition: 'max-height 0.4s ease'
                      }}>
                        <div style={{ padding: '0 14px 12px 14px', borderTop: `1px solid ${cardBorderColor}` }}>

                          {result.score !== undefined && (
                            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                              <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  background: agentColor,
                                  width: isExpanded ? `${result.score}%` : '0%',
                                  transition: 'width 0.8s ease 0.2s',
                                  borderRadius: '999px'
                                }}></div>
                              </div>
                            </div>
                          )}

                          {hasServiceUnavailable && (
                            <div style={{ padding: '6px 12px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '8px', marginBottom: '10px', fontSize: '12px', color: '#6366f1', fontWeight: 600 }}>
                              🔄 Re-running AI risk scoring automatically…
                            </div>
                          )}

                          {visibleFindings.length > 0 && (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', marginTop: '10px' }}>
                                <h4 style={{ fontWeight: 'bold', color: '#374151', margin: 0, fontSize: '13px' }}>
                                  📋 Findings
                                </h4>
                                <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '1px 7px' }}>✓ {successCount} passed</span>
                                {warnCount > 0 && <span style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '999px', padding: '1px 7px' }}>⚠ {warnCount} warning</span>}
                                {failCount > 0  && <span style={{ fontSize: '11px', fontWeight: '700', color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '999px', padding: '1px 7px' }}>✗ {failCount} failed</span>}
                              </div>
                              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                {visibleFindings.map((f, idx) => (
                                  <li key={idx} style={{
                                    display: 'flex',
                                    gap: '10px',
                                    padding: '7px 11px',
                                    background: f.bg,
                                    border: `1px solid ${f.border}`,
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    color: '#374151',
                                    alignItems: 'flex-start'
                                  }}>
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
            </div>
          )}

          {/* Audit Log */}
          <div style={{
            gridColumn: '1 / -1',
            background: 'white',
            borderRadius: '12px',
            padding: '14px 18px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.07)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 'bold', margin: 0 }}>
                📜 Activity Timeline
              </h2>
              <button
                onClick={() => setShowAuditLog(!showAuditLog)}
                style={{
                  padding: '10px 20px',
                  background: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {showAuditLog ? 'Hide' : 'Show'} Details
              </button>
            </div>

            {showAuditLog && (
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute',
                  left: '12px',
                  top: '0',
                  bottom: '0',
                  width: '2px',
                  background: 'linear-gradient(to bottom, #667eea 0%, #764ba2 100%)'
                }}></div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {application.auditLog.slice().reverse().map((entry) => (
                    <div key={entry.id} style={{ paddingLeft: '50px', position: 'relative' }}>
                      <div style={{
                        position: 'absolute',
                        left: '4px',
                        top: '0',
                        width: '18px',
                        height: '18px',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: '50%',
                        border: '4px solid white',
                        boxShadow: '0 2px 8px rgba(102, 126, 234, 0.4)'
                      }}></div>

                      <div style={{
                        background: '#f9fafb',
                        borderRadius: '12px',
                        padding: '20px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <h4 style={{ fontWeight: 'bold', color: '#1f2937', margin: 0, fontSize: '16px' }}>
                            {entry.eventType.replace(/_/g, ' ')}
                          </h4>
                          <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                            {new Date(entry.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                          <strong>Actor:</strong> {entry.actor}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};