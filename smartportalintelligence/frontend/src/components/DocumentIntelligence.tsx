import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MerchantApplication, AgentType, AgentStatus } from '../types';

export const DocumentIntelligence: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [application, setApplication] = useState<MerchantApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDocs, setExpandedDocs] = useState<Set<number>>(new Set());
  const autoRetriedRef = useRef(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  // Per-agent timing: record when each agent first becomes active / completes
  const agentStartMsRef = useRef<Partial<Record<AgentType, number>>>({});
  const agentEndMsRef   = useRef<Partial<Record<AgentType, number>>>({});
  // Updating this forces re-renders so live elapsed timers stay fresh
  const [, setTick] = useState(0);
  const proceedBtnRef = useRef<HTMLButtonElement>(null);
  const [pulseStatus, setPulseStatus] = useState(false);
  const allDoneNotifiedRef = useRef(false);
  // Parallel-feel staggered reveal: holds agents still "animating" as running
  const [simulatedRunning, setSimulatedRunning] = useState<Set<AgentType>>(new Set());
  const simDidRunRef = useRef(false);

  const loadApplication = async () => {
    if (!id) return;
    try {
      const app = await api.getApplication(id);
      setApplication(app);
      setLoading(false);
      // Stop polling once all 3 agents are done
      const allDone = [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(type => {
        const r = app.agentResults.find(a => a.agentType === type);
        return r && r.status !== AgentStatus.PENDING && r.status !== AgentStatus.IN_PROGRESS;
      });
      if (allDone && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        // Nudge user to proceed when agents finish
        if (!allDoneNotifiedRef.current) {
          allDoneNotifiedRef.current = true;
          setPulseStatus(true);
          setTimeout(() => proceedBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
          setTimeout(() => setPulseStatus(false), 4000);
        }
      }
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplication();
    pollRef.current = setInterval(loadApplication, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  // Auto-retry risk if service was unavailable (once per mount)
  useEffect(() => {
    if (!id || !application || autoRetriedRef.current) return;
    const riskResult = application.agentResults.find(r => r.agentType === AgentType.RISK);
    const needsRetry = riskResult?.findings?.some((f: string) => f.includes('smart-risk-scoring service unavailable'));
    if (needsRetry) {
      autoRetriedRef.current = true;
      api.retryRiskAssessment(id)
        .then(() => loadApplication())
        .catch(err => console.error('[AutoRetry] Risk retry failed:', err));
    }
  }, [application, id]);

  // Track per-agent start/end timestamps for live elapsed timers
  useEffect(() => {
    if (!application) return;
    // Use server timestamps so timing is accurate even when the page loads
    // after agents have already finished (avoids start≈end → 0.0s display).
    const pipelineStart = new Date(application.createdAt).getTime();
    const isTerminal = (s?: AgentStatus) =>
      s === AgentStatus.PASSED || s === AgentStatus.FAILED || s === AgentStatus.MANUAL_REVIEW_REQUIRED;
    application.agentResults.forEach(r => {
      const type = r.agentType;
      if (!type) return;
      if (!agentStartMsRef.current[type] &&
          (r.status === AgentStatus.IN_PROGRESS || isTerminal(r.status))) {
        agentStartMsRef.current[type] = pipelineStart;
      }
      if (!agentEndMsRef.current[type] && isTerminal(r.status)) {
        agentEndMsRef.current[type] = r.completedAt
          ? new Date(r.completedAt).getTime()
          : Date.now();
      }
    });
  }, [application]);

  // Tick every second while any agent is still active (drives live elapsed timers)
  useEffect(() => {
    const hasActive = application?.agentResults.some(
      r => r.status === AgentStatus.IN_PROGRESS || r.status === AgentStatus.PENDING
    );
    if (!hasActive) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [application]);

  // Staggered parallel-feel reveal: if all 3 agents are already done on first load,
  // briefly show all as "Running…" simultaneously, then reveal each result at a
  // different random offset so it looks like independent parallel completion.
  useEffect(() => {
    if (!application || simDidRunRef.current) return;
    const types = [AgentType.KYC, AgentType.MCC, AgentType.RISK];
    const allDone = types.every(type => {
      const r = application.agentResults.find(a => a.agentType === type);
      return r && r.status !== AgentStatus.PENDING && r.status !== AgentStatus.IN_PROGRESS;
    });
    if (!allDone) return;
    simDidRunRef.current = true;
    // Show all 3 as running simultaneously
    setSimulatedRunning(new Set(types));
    // Stagger reveals: pick 3 different windows so each feels independent
    const baseDelays = [700, 1500, 2300];
    const shuffled = [...types].sort(() => Math.random() - 0.5); // random order
    shuffled.forEach((type, i) => {
      const delay = baseDelays[i] + Math.floor(Math.random() * 400);
      setTimeout(() => {
        setSimulatedRunning(prev => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, delay);
    });
  }, [application]);

  const toggleDoc = (i: number) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // Build merged KV across all textractResults
  const textractResults: any[] = (application as any)?.textractResults || [];
  const mergedKV: Record<string, string> = {};
  textractResults.forEach((r: any) => Object.assign(mergedKV, r.keyValues || {}));
  const mergedEntries = Object.entries(mergedKV);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', color: '#6366f1' }}>
          <div style={{ width: '56px', height: '56px', border: '4px solid #e0e7ff', borderTop: '4px solid #6366f1', borderRadius: '50%', animation: 'spin 0.9s linear infinite', margin: '0 auto 20px' }} />
          <p style={{ fontSize: '16px', color: '#64748b' }}>Loading intelligence data…</p>
          <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', color: '#0f172a' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <p style={{ color: '#64748b' }}>Application not found.</p>
        </div>
      </div>
    );
  }

  const docTypeLabels: Record<string, string> = {
    BUSINESS_LICENSE: 'Business License',
    TAX_CERTIFICATE: 'Tax Certificate',
    BENEFICIAL_OWNERSHIP: 'Beneficial Ownership',
    BANK_STATEMENT: 'Bank Statement',
    ID_DOCUMENT: 'ID Document'
  };

  const docTypeIcons: Record<string, string> = {
    BUSINESS_LICENSE: '🏛️',
    TAX_CERTIFICATE: '📋',
    BENEFICIAL_OWNERSHIP: '👥',
    BANK_STATEMENT: '🏦',
    ID_DOCUMENT: '🪪'
  };

  // Compute overall pipeline status (factor in simulated running state)
  const allDoneGlobal = simulatedRunning.size === 0 && [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(type => {
    const r = application.agentResults.find(x => x.agentType === type);
    return r && r.status !== AgentStatus.PENDING && r.status !== AgentStatus.IN_PROGRESS;
  });
  const anyRunning = simulatedRunning.size > 0 || application.agentResults.some(r => r.status === AgentStatus.IN_PROGRESS || r.status === AgentStatus.PENDING);
  const overallScore = allDoneGlobal
    ? Math.round(application.agentResults.filter(r => r.score !== undefined).reduce((s, r) => s + (r.score ?? 0), 0) /
        (application.agentResults.filter(r => r.score !== undefined).length || 1))
    : null;

  return (
    <>
      <style>{`
        *{box-sizing:border-box}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeInFast{from{opacity:0}to{opacity:1}}
        @keyframes dotBounce{0%,80%,100%{transform:translateY(0);opacity:0.35}40%{transform:translateY(-5px);opacity:1}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-8px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes parallelBeam{0%{offset-distance:0%;opacity:0}10%{opacity:1}85%{opacity:1}100%{offset-distance:100%;opacity:0}}
        @keyframes dispatchGlow{0%,100%{box-shadow:0 0 0 4px rgba(99,102,241,0.2),0 0 0 10px rgba(99,102,241,0.08),0 4px 20px rgba(99,102,241,0.4)}50%{box-shadow:0 0 0 8px rgba(99,102,241,0.3),0 0 0 18px rgba(99,102,241,0.12),0 4px 28px rgba(99,102,241,0.5)}}
        @keyframes parallelPing{0%{transform:scale(1);opacity:0.7}100%{transform:scale(1.12);opacity:0}}
        @keyframes scorePop{0%{transform:scale(0.4);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        @keyframes progressFill{from{width:0%}to{width:var(--score-w)}}
        @keyframes pulseRing{0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0.45)}50%{box-shadow:0 0 0 10px rgba(99,102,241,0)}}
        @keyframes bounceArrow{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
        @keyframes statusPulse{0%,100%{box-shadow:0 4px 20px rgba(99,102,241,0.3),0 0 0 0 rgba(99,102,241,0.5)}50%{box-shadow:0 4px 20px rgba(99,102,241,0.3),0 0 0 12px rgba(99,102,241,0)}}
        @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        @keyframes scoreCount{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}

        .di-page{height:100vh;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;}

        /* Header */
        .di-header{flex-shrink:0;background:#ffffff;border-bottom:1px solid #e2e8f0;padding:14px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);}

        /* Body */
        .di-body{flex:1;overflow-y:auto;background:#f1f5f9;padding:16px 20px 32px;display:flex;gap:16px;align-items:flex-start;}
        .di-sidebar{width:310px;flex-shrink:0;position:sticky;top:0;max-height:calc(100vh - 120px);overflow-y:auto;}
        .di-main{flex:1;min-width:0;}

        /* Cards */
        .di-card{background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:18px 20px;margin-bottom:14px;animation:fadeIn 0.35s ease;box-shadow:0 2px 12px rgba(0,0,0,0.06),0 1px 3px rgba(0,0,0,0.04);transition:box-shadow 0.2s,border-color 0.2s;}
        .di-card:hover{box-shadow:0 6px 24px rgba(99,102,241,0.12),0 2px 6px rgba(0,0,0,0.06);border-color:#c7d2fe;}
        .di-card-title{display:flex;align-items:center;gap:9px;margin-bottom:14px;}

        /* Profile fields */
        .prof-field{display:flex;flex-direction:column;gap:2px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;}
        .prof-key{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;}
        .prof-val{font-size:12.5px;font-weight:600;color:#0f172a;word-break:break-all;}

        /* Agent cards */
        .agent-card{border-radius:14px;padding:12px 14px;transition:all 0.3s ease;position:relative;overflow:hidden;}
        .agent-card:hover{transform:translateY(-1px);}

        /* Parallel fork connector */
        .fork-branch-dot{offset-path:none;animation:parallelBeam 1.3s linear infinite;}
        .parallel-ping{position:absolute;inset:-3px;border-radius:14px;animation:parallelPing 1.6s ease-out infinite;pointer-events:none;}

        /* KV pairs */
        .kv-row{display:flex;flex-direction:column;gap:2px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;border-radius:9px;padding:8px 11px;border-left:3px solid #7c3aed;}
        .kv-key{font-size:10px;color:#6d28d9;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;}
        .kv-val{font-size:12px;color:#1e293b;word-break:break-word;font-family:'Courier New',monospace;font-weight:500;}

        /* Doc expand */
        .doc-toggle-btn{background:none;border:none;cursor:pointer;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;color:#6366f1;transition:background 0.15s;}
        .doc-toggle-btn:hover{background:#eef2ff;}

        /* Search input */
        .kv-search{width:100%;padding:7px 12px;border:1px solid #e2e8f0;border-radius:9px;font-size:12px;color:#0f172a;outline:none;background:#f8fafc;margin-bottom:10px;}
        .kv-search:focus{border-color:#818cf8;background:#fff;box-shadow:0 0 0 3px rgba(99,102,241,0.12);}

        /* Verdict banner */
        .verdict-banner{border-radius:16px;padding:20px 24px;margin-bottom:14px;animation:slideIn 0.5s ease;}

        /* Proceed btn */
        .btn-proceed{border:none;border-radius:12px;padding:14px 36px;font-size:15px;font-weight:800;cursor:pointer;transition:all 0.2s;letter-spacing:0.01em;}
        .btn-proceed:hover:not(:disabled){transform:translateY(-2px);}
        .btn-status-pulse{animation:statusPulse 1s ease-in-out 4;}

        /* Score ring text */
        .score-ring-text{font-size:18px;font-weight:900;line-height:1;}
        .score-ring-sub{font-size:9px;font-weight:700;opacity:0.7;text-transform:uppercase;letter-spacing:0.05em;}

        .json-raw{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:'Courier New',monospace;font-size:11px;color:#475569;overflow-x:auto;max-height:220px;overflow-y:auto;white-space:pre;}
        .badge{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
      `}</style>
      <div className="di-page">

        {/* ════════════ HEADER ════════════ */}
        <div className="di-header">
          <div style={{ display:'flex',alignItems:'center',justifyContent:'center',width:'100%' }}>
            {/* Center: logo + title */}
            <div style={{ display:'flex',alignItems:'center',gap:'12px' }}>
              <span style={{ fontSize:'36px' }}>🧠</span>
              <div>
                <h1 style={{ margin:0,fontSize:'28px',fontWeight:800,color:'#0f172a',letterSpacing:'-0.5px' }}>Document Intelligence</h1>
              </div>
            </div>

          </div>
        </div>

        {/* ════════════ BODY (sidebar + main) ════════════ */}
        <div className="di-body">

          {/* ── SIDEBAR: Pipeline + Merchant Profile ── */}
          <div className="di-sidebar">

            {/* ── AI Pipeline Panel (top of sidebar) ── */}
            <div className="di-card" style={{ marginBottom:'14px',padding:'14px 16px',overflow:'visible' }}>
              {/* Card header */}
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px' }}>
                <div style={{ display:'flex',alignItems:'center',gap:'7px' }}>
                  <div style={{ width:'28px',height:'28px',borderRadius:'8px',background:'linear-gradient(135deg,#6366f1,#7c3aed)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                    <span style={{ fontSize:'14px' }}>🤖</span>
                  </div>
                  <span style={{ fontSize:'12px',fontWeight:800,color:'#0f172a' }}>AI Agent Pipeline</span>
                </div>
                <div style={{ display:'inline-flex',alignItems:'center',gap:'5px',background: anyRunning ? '#eef2ff' : allDoneGlobal ? '#f0fdf4' : '#f8fafc', border:`1px solid ${anyRunning?'#c7d2fe':allDoneGlobal?'#86efac':'#e2e8f0'}`, borderRadius:'16px',padding:'2px 9px' }}>
                  <span style={{ fontSize:'10px' }}>{anyRunning ? '⚡' : allDoneGlobal ? '✅' : '⏳'}</span>
                  <span style={{ fontSize:'9.5px',fontWeight:800,color: anyRunning?'#4338ca':allDoneGlobal?'#059669':'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em' }}>
                    {anyRunning ? 'Running' : allDoneGlobal ? 'Completed' : 'Queued'}
                  </span>
                </div>
              </div>

              {/* Fan-out: dispatcher → fork → 3 compact cards */}
              <div style={{ display:'flex',alignItems:'center',gap:0 }}>

                {/* Dispatcher node */}
                <div style={{ position:'relative',flexShrink:0 }}>
                  {anyRunning && <div style={{ position:'absolute',inset:'-6px',borderRadius:'50%',border:'2px solid rgba(99,102,241,0.2)',animation:'parallelPing 1.8s ease-out infinite' }} />}
                  {anyRunning && <div style={{ position:'absolute',inset:'-3px',borderRadius:'50%',border:'2px solid rgba(99,102,241,0.12)',animation:'parallelPing 1.8s 0.6s ease-out infinite' }} />}
                  <div style={{ width:'46px',height:'46px',borderRadius:'50%',background:'linear-gradient(135deg,#6366f1,#7c3aed,#a21caf)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:anyRunning?'0 0 0 3px rgba(99,102,241,0.15),0 4px 16px rgba(99,102,241,0.4)':'0 3px 10px rgba(99,102,241,0.3)',animation:anyRunning?'dispatchGlow 2s ease-in-out infinite':'none',position:'relative',zIndex:2 }}>
                    <span style={{ fontSize:'18px',lineHeight:1 }}>🤖</span>
                    <span style={{ fontSize:'6px',fontWeight:900,color:'#e0e7ff',letterSpacing:'0.06em',marginTop:'1px' }}>ENGINE</span>
                  </div>
                </div>

                {/* SVG fork */}
                {(() => {
                  const cardH = 64; const gap = 8;
                  const totalH = 3 * cardH + 2 * gap;
                  const b1 = cardH / 2;
                  const b2 = cardH + gap + cardH / 2;
                  const b3 = 2 * (cardH + gap) + cardH / 2;
                  const W = 50; const jx = 16;
                  const branches = [
                    {y:b1,color:'#3b82f6'},{y:b2,color:'#10b981'},{y:b3,color:'#f59e0b'},
                  ] as {y:number;color:string}[];
                  return (
                    <svg width={W} height={totalH} style={{ flexShrink:0,overflow:'visible' }}>
                      <defs>
                        <filter id="glow-b"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                        <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6"/><stop offset="50%" stopColor="#6366f1" stopOpacity="0.8"/><stop offset="100%" stopColor="#f59e0b" stopOpacity="0.6"/></linearGradient>
                      </defs>
                      <line x1={0} y1={b2} x2={jx} y2={b2} stroke="#c7d2fe" strokeWidth="2"/>
                      <line x1={jx} y1={b1} x2={jx} y2={b3} stroke="url(#sg2)" strokeWidth="2"/>
                      <circle cx={jx} cy={b2} r="3.5" fill="#6366f1" opacity="0.9"/>
                      {branches.map(({y,color},i) => (
                        <g key={i}>
                          <line x1={jx} y1={y} x2={W} y2={y} stroke={color} strokeWidth="2" opacity="0.5"/>
                          <polygon points={`${W},${y} ${W-6},${y-3.5} ${W-6},${y+3.5}`} fill={color} opacity="0.85"/>
                          {anyRunning && (
                            <circle r="4.5" fill={color} filter="url(#glow-b)">
                              <animateMotion dur="1.1s" begin="0s" repeatCount="indefinite" path={`M${jx},${y} L${W-6},${y}`}/>
                              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.88;1" dur="1.1s" begin="0s" repeatCount="indefinite"/>
                            </circle>
                          )}
                          {allDoneGlobal && !anyRunning && (
                            <circle cx={W-9} cy={y} r="4" fill={color} opacity="0.9"/>
                          )}
                        </g>
                      ))}
                    </svg>
                  );
                })()}

                {/* 3 compact agent cards */}
                <div style={{ display:'flex',flexDirection:'column',gap:'8px',flex:1,minWidth:0 }}>
                  {([
                    { type: AgentType.KYC,  label:'KYC Verification',  icon:'🪪', accent:'#3b82f6', accentDark:'#1d4ed8' },
                    { type: AgentType.MCC,  label:'MCC Classification', icon:'🏷️', accent:'#10b981', accentDark:'#047857' },
                    { type: AgentType.RISK, label:'Risk Assessment',    icon:'⚖️', accent:'#f59e0b', accentDark:'#b45309' },
                  ] as { type: AgentType; label: string; icon: string; accent: string; accentDark: string }[]).map(({ type, label, icon, accent, accentDark }) => {
                    const result     = application.agentResults.find(r => r.agentType === type);
                    const rawStatus  = result?.status;
                    const simRunning = simulatedRunning.has(type);
                    const status     = simRunning ? AgentStatus.IN_PROGRESS : rawStatus;
                    const isPassed   = !simRunning && status === AgentStatus.PASSED;
                    const isFailed   = !simRunning && status === AgentStatus.FAILED;
                    const isManual   = !simRunning && status === AgentStatus.MANUAL_REVIEW_REQUIRED;
                    const isRunning  = simRunning || status === AgentStatus.IN_PROGRESS;
                    const isDone     = isPassed || isFailed || isManual;
                    const startMs    = agentStartMsRef.current[type];
                    const endMs      = agentEndMsRef.current[type];
                    const elapsedS   = !simRunning && startMs ? ((isDone && endMs ? endMs - startMs : Date.now() - startMs) / 1000).toFixed(1) : null;
                    const score      = !simRunning ? result?.score : undefined;

                    const statusColor  = isPassed ? '#059669' : isFailed ? '#dc2626' : isManual ? '#d97706' : isRunning ? '#4338ca' : '#94a3b8';
                    const statusBg     = isPassed ? '#dcfce7' : isFailed ? '#fee2e2' : isManual ? '#fef9c3' : isRunning ? '#e0e7ff' : '#f1f5f9';
                    const statusBorder = isPassed ? '#86efac' : isFailed ? '#fca5a5' : isManual ? '#fde047' : isRunning ? '#c7d2fe' : '#e2e8f0';
                    const cardBg       = isDone
                      ? (isPassed ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)' : isFailed ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : 'linear-gradient(135deg,#fffbeb,#fef9c3)')
                      : isRunning ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)' : '#fafafa';
                    const accentBar    = isPassed ? '#10b981' : isFailed ? '#ef4444' : isManual ? '#f59e0b' : isRunning ? accent : '#e2e8f0';
                    const stIcon       = isPassed ? '✅' : isFailed ? '❌' : isManual ? '⚠️' : null;
                    const stText       = isPassed ? 'Passed' : isFailed ? 'Failed' : isManual ? 'Review' : isRunning ? 'Running…' : 'Queued';

                    return (
                      <div key={type} style={{ position:'relative',background:cardBg,border:`1px solid ${statusBorder}`,borderLeft:`3px solid ${accentBar}`,borderRadius:'10px',padding:'7px 10px',overflow:'hidden',transition:'all 0.3s ease',animation:isDone?'slideIn 0.4s ease':'none',boxShadow:isRunning?`0 0 0 2px ${accent}15`:'0 1px 4px rgba(0,0,0,0.05)' }}>
                        {isRunning && <div style={{ position:'absolute',inset:0,background:`linear-gradient(105deg,transparent 40%,${accent}0a 50%,transparent 60%)`,backgroundSize:'200% 100%',animation:'shimmer 2s linear infinite',pointerEvents:'none' }} />}
                        <div style={{ display:'flex',alignItems:'center',gap:'6px',position:'relative' }}>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ display:'flex',alignItems:'center',gap:'5px',marginBottom:'3px' }}>
                              {isRunning ? <div style={{ width:'14px',height:'14px',border:`2px solid ${accent}30`,borderTop:`2px solid ${accent}`,borderRadius:'50%',animation:'spin 0.85s linear infinite',flexShrink:0 }} /> : <span style={{ fontSize:'13px',flexShrink:0 }}>{icon}</span>}
                              <span style={{ fontSize:'10.5px',fontWeight:800,color:'#0f172a',lineHeight:1.2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{label}</span>
                            </div>
                            <div style={{ display:'flex',alignItems:'center',gap:'5px' }}>
                              <div style={{ display:'inline-flex',alignItems:'center',gap:'3px',background:statusBg,border:`1px solid ${statusBorder}`,borderRadius:'10px',padding:'1px 6px' }}>
                                {isRunning && [0,0.12,0.24].map((d,i) => (<span key={i} style={{ width:'3px',height:'3px',borderRadius:'50%',background:accent,display:'inline-block',animation:`dotBounce 0.9s ${d}s ease-in-out infinite` }} />))}
                                {stIcon && <span style={{ fontSize:'9px' }}>{stIcon}</span>}
                                <span style={{ fontSize:'9.5px',fontWeight:700,color:statusColor }}>{stText}</span>
                              </div>
                              {elapsedS && <span style={{ fontSize:'9px',color:'#94a3b8',fontFamily:'monospace' }}>{elapsedS}s</span>}
                            </div>
                            {score !== undefined && isDone && (
                              <div style={{ marginTop:'4px',height:'3px',background:'rgba(0,0,0,0.06)',borderRadius:'999px',overflow:'hidden' }}>
                                <div style={{ height:'100%',width:`${score}%`,background:`linear-gradient(90deg,${accent},${accentDark})`,borderRadius:'999px',transition:'width 1s ease' }} />
                              </div>
                            )}
                          </div>
                          {score !== undefined && isDone && (
                            <div style={{ flexShrink:0,width:'36px',height:'36px',borderRadius:'50%',background:`conic-gradient(${accentBar} ${score*3.6}deg,rgba(0,0,0,0.07) 0deg)`,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:`0 0 0 2px #fff,0 0 8px ${accent}30`,animation:'scorePop 0.5s ease' }}>
                              <div style={{ width:'26px',height:'26px',borderRadius:'50%',background:isPassed?'#f0fdf4':isFailed?'#fef2f2':'#fffbeb',display:'flex',alignItems:'center',justifyContent:'center' }}>
                                <span style={{ fontSize:'10px',fontWeight:900,color:statusColor,fontFamily:'monospace' }}>{score}</span>
                              </div>
                            </div>
                          )}
                          {isRunning && (
                            <div style={{ flexShrink:0,width:'36px',height:'36px',borderRadius:'50%',background:`conic-gradient(${accent}35 180deg,rgba(0,0,0,0.04) 0deg)`,display:'flex',alignItems:'center',justifyContent:'center',animation:'spin 2s linear infinite' }}>
                              <div style={{ width:'26px',height:'26px',borderRadius:'50%',background:'#eef2ff',display:'flex',alignItems:'center',justifyContent:'center' }}><span style={{ fontSize:'9px',color:'#6366f1',fontWeight:800 }}>…</span></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="di-card" style={{ marginBottom:'14px' }}>
              <div className="di-card-title">
                <div style={{ width:'34px',height:'34px',background:'linear-gradient(135deg,#6366f1,#7c3aed)',borderRadius:'10px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                  <span style={{ fontSize:'18px' }}>🏢</span>
                </div>
                <div>
                  <p style={{ margin:0,fontSize:'13px',fontWeight:800,color:'#0f172a',lineHeight:1.1 }}>Merchant Profile</p>
                  <p style={{ margin:0,fontSize:'10px',color:'#94a3b8',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em' }}>Verified Details</p>
                </div>
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:'7px' }}>
                {[
                  { icon:'🏷️', k:'Business Name', v: application.businessName },
                  { icon:'🗂️', k:'Business Type', v: application.businessType },
                  { icon:'🌍', k:'Country', v: application.country },
                  { icon:'🔢', k:'Tax ID', v: application.taxId },
                  { icon:'📧', k:'Email', v: application.contactEmail },
                  { icon:'🌐', k:'Website', v: (application as any).website || '—' },
                ].map(({ icon, k, v }) => (
                  <div key={k} className="prof-field">
                    <span className="prof-key">{icon} {k}</span>
                    <span className="prof-val">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── MAIN: Documents + Proceed ── */}
          <div className="di-main">

            {/* ── Section header ── */}
            <div style={{ display:'flex',alignItems:'center',gap:'10px',marginBottom:'14px' }}>
              <div style={{ width:'36px',height:'36px',background:'linear-gradient(135deg,#6366f1,#7c3aed)',borderRadius:'10px',display:'flex',alignItems:'center',justifyContent:'center' }}>
                <span style={{ fontSize:'18px' }}>🔍</span>
              </div>
              <div>
                <p style={{ margin:0,fontSize:'15px',fontWeight:800,color:'#0f172a' }}>Extracted Document Intelligence</p>
                <p style={{ margin:0,fontSize:'11px',color:'#64748b' }}>AI-parsed fields from uploaded documents · Click to expand</p>
              </div>
              {mergedEntries.length > 0 && (
                <div style={{ marginLeft:'auto' }}>
                  <span style={{ background:'#ede9fe',color:'#7c3aed',border:'1px solid #ddd6fe',borderRadius:'20px',padding:'3px 10px',fontSize:'11px',fontWeight:700 }}>
                    {mergedEntries.length} total fields
                  </span>
                </div>
              )}
            </div>

            {/* ── No docs state ── */}
            {textractResults.length === 0 && (
              <div className="di-card" style={{ textAlign:'center',padding:'48px 20px' }}>
                <span style={{ fontSize:'48px',display:'block',marginBottom:'12px' }}>📭</span>
                <p style={{ fontSize:'15px',fontWeight:700,color:'#0f172a',marginBottom:'6px' }}>No Document Data</p>
                <p style={{ fontSize:'13px',color:'#64748b',margin:0 }}>Textract has not processed any documents for this application yet.</p>
              </div>
            )}

            {/* ── Document KV cards ── */}
            {textractResults.map((r: any, i: number) => {
              const kvEntries = Object.entries(r.keyValues || {} as Record<string,string>);
              const isExpanded = expandedDocs.has(i);
              return (
                <div key={i} className="di-card" style={{ marginBottom:'12px' }}>
                  {/* Header row */}
                  <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer' }} onClick={() => toggleDoc(i)}>
                    <div style={{ display:'flex',alignItems:'center',gap:'12px' }}>
                      <div style={{ width:'42px',height:'42px',background:'linear-gradient(135deg,#ede9fe,#ddd6fe)',borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid #c4b5fd',flexShrink:0 }}>
                        <span style={{ fontSize:'22px' }}>{docTypeIcons[r.documentType] || '📄'}</span>
                      </div>
                      <div>
                        <p style={{ margin:'0 0 3px',fontSize:'14px',fontWeight:800,color:'#0f172a' }}>{docTypeLabels[r.documentType] || r.documentType}</p>
                        <div style={{ display:'flex',alignItems:'center',gap:'8px' }}>
                          <span style={{ fontSize:'11px',background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'1px 7px',fontWeight:600 }}>{r.lineCount ?? 0} lines</span>
                          <span style={{ fontSize:'11px',background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'1px 7px',fontWeight:600 }}>{r.wordCount ?? 0} words</span>
                          <span style={{ fontSize:'11px',background:'#ede9fe',color:'#7c3aed',border:'1px solid #ddd6fe',borderRadius:'6px',padding:'1px 7px',fontWeight:700 }}>{kvEntries.length} KV pairs</span>
                        </div>
                      </div>
                    </div>
                    <button className="doc-toggle-btn" style={{ display:'flex',alignItems:'center',gap:'5px' }}>
                      <span style={{ fontSize:'13px',transform:isExpanded?'rotate(90deg)':'none',display:'inline-block',transition:'transform 0.2s' }}>▶</span>
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{ marginTop:'14px',animation:'fadeIn 0.2s ease' }}>
                      {kvEntries.length === 0 ? (
                        <p style={{ color:'#94a3b8',fontSize:'12px',fontStyle:'italic',margin:0 }}>No key-value pairs extracted from this document.</p>
                      ) : (
                        <>
                          {/* KV grid */}
                          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'6px',marginBottom:'12px' }}>
                            {kvEntries.map(([k, v]) => (
                              <div key={k} className="kv-row">
                                <span className="kv-key">{k}</span>
                                <span className="kv-val">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                          {/* Raw JSON */}
                          <details>
                            <summary style={{ color:'#6366f1',cursor:'pointer',fontSize:'12px',fontWeight:700,padding:'4px 0',userSelect:'none' }}>{'{ } View raw JSON'}</summary>
                            <pre className="json-raw">{JSON.stringify(r.keyValues || {}, null, 2)}</pre>
                          </details>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Verdict + Proceed ── */}
            {(() => {
              const allDone2 = [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(type => {
                const r = application.agentResults.find(x => x.agentType === type);
                return r && r.status !== AgentStatus.PENDING && r.status !== AgentStatus.IN_PROGRESS;
              });
              const allGreen = allDone2 && [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(type => {
                const r = application.agentResults.find(x => x.agentType === type);
                return r && (r.score ?? 0) >= 85;
              });
              const hasFailure = allDone2 && [AgentType.KYC, AgentType.MCC, AgentType.RISK].some(type => {
                const r = application.agentResults.find(x => x.agentType === type);
                return r && r.status === AgentStatus.FAILED;
              });

              const bannerBg    = allGreen ? 'linear-gradient(135deg,#ecfdf5,#d1fae5)' : hasFailure ? 'linear-gradient(135deg,#fff1f2,#ffe4e6)' : 'linear-gradient(135deg,#fff7ed,#fef3c7)';
              const bannerBorder= allGreen ? '1.5px solid #6ee7b7'   : hasFailure ? '1.5px solid #fca5a5'   : '1.5px solid #fcd34d';
              const iconBg      = allGreen ? 'linear-gradient(135deg,#10b981,#059669)' : hasFailure ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#f59e0b,#d97706)';
              const iconShadow  = allGreen ? '0 4px 14px rgba(16,185,129,0.35)' : hasFailure ? '0 4px 14px rgba(239,68,68,0.35)' : '0 4px 14px rgba(245,158,11,0.35)';
              const titleColor  = allGreen ? '#064e3b' : hasFailure ? '#7f1d1d' : '#78350f';
              const subColor    = allGreen ? '#065f46' : hasFailure ? '#991b1b' : '#92400e';
              const scoreColor  = allGreen ? '#059669' : hasFailure ? '#ef4444' : '#d97706';
              const scoreBadge  = allGreen ? '#6ee7b7' : hasFailure ? '#fca5a5' : '#fcd34d';
              const emoji       = allGreen ? '🎉' : hasFailure ? '🚫' : '🔍';
              const title       = allGreen ? 'All Checks Passed — Ready to Activate!' : hasFailure ? 'Application Rejected' : 'Manual Review Required';
              const subtitle    = allGreen
                ? `All 3 AI agents returned high scores. Average score: ${overallScore ?? '—'}`
                : hasFailure
                  ? 'One or more agents have failed verification. Review the findings below for details.'
                  : 'Agents have flagged items that need manual review before this application can proceed.';

              return (
                <div style={{ marginTop:'8px' }}>
                  {/* Verdict banner */}
                  {allDone2 && (
                    <div className="verdict-banner" style={{ background: bannerBg, border: bannerBorder, marginBottom:'14px' }}>
                      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',gap:'16px' }}>
                        <div style={{ display:'flex',alignItems:'center',gap:'14px' }}>
                          <div style={{ width:'48px',height:'48px',borderRadius:'14px',background: iconBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow: iconShadow }}>
                            <span style={{ fontSize:'26px' }}>{emoji}</span>
                          </div>
                          <div>
                            <p style={{ margin:'0 0 3px',fontSize:'15px',fontWeight:900,color: titleColor }}>{title}</p>
                            <p style={{ margin:0,fontSize:'12px',color: subColor }}>{subtitle}</p>
                          </div>
                        </div>
                        {overallScore !== null && (
                          <div style={{ textAlign:'center',flexShrink:0 }}>
                            <div style={{ fontSize:'32px',fontWeight:900,color: scoreColor,lineHeight:1,fontFamily:'monospace' }}>{overallScore}</div>
                            <div style={{ fontSize:'10px',fontWeight:700,color: scoreBadge,textTransform:'uppercase',letterSpacing:'0.05em' }}>avg score</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Waiting state banner */}
                  {!allDone2 && (
                    <div style={{ background:'#f8fafc',border:'1.5px dashed #cbd5e1',borderRadius:'14px',padding:'18px 20px',marginBottom:'14px',display:'flex',alignItems:'center',gap:'14px' }}>
                      <div style={{ width:'40px',height:'40px',border:'4px solid #e0e7ff',borderTop:'4px solid #6366f1',borderRadius:'50%',animation:'spin 0.9s linear infinite',flexShrink:0 }} />
                      <div>
                        <p style={{ margin:'0 0 2px',fontSize:'13px',fontWeight:700,color:'#0f172a' }}>AI Agents Processing…</p>
                        <p style={{ margin:0,fontSize:'11px',color:'#64748b' }}>All three agents must complete before you can proceed. Results auto-update every 2.5s.</p>
                      </div>
                    </div>
                  )}

                  {/* Proceed button */}
                  <div style={{ textAlign:'center',paddingBottom:'8px' }}>
                    {pulseStatus && allDone2 && (
                      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',marginBottom:'10px' }}>
                        <span style={{ animation:'bounceArrow 0.8s ease-in-out infinite',display:'inline-block',fontSize:'16px' }}>👇</span>
                        <span style={{ fontSize:'12px',fontWeight:700,color: allGreen ? '#059669' : '#d97706' }}>Ready! Click to proceed</span>
                      </div>
                    )}
                    <button
                      ref={proceedBtnRef}
                      className={`btn-proceed${pulseStatus && allDone2 ? ' btn-status-pulse' : ''}`}
                      style={{
                        opacity: allDone2 ? 1 : 0.5,
                        cursor: allDone2 ? 'pointer' : 'not-allowed',
                        background: allDone2
                          ? allGreen
                            ? 'linear-gradient(135deg,#10b981,#059669)'
                            : 'linear-gradient(135deg,#f59e0b,#d97706)'
                          : '#94a3b8',
                        color:'white',
                        boxShadow: allDone2
                          ? allGreen
                            ? '0 6px 24px rgba(16,185,129,0.4)'
                            : '0 6px 24px rgba(245,158,11,0.4)'
                          : 'none',
                      }}
                      disabled={!allDone2}
                      onClick={() => navigate(`/application/${id}/status`)}
                    >
                      {allDone2
                        ? allGreen ? '🚀 Proceed to Merchant Activation →' : '🔍 View Compliance Review Findings →'
                        : '⏳ Waiting for AI agents…'
                      }
                    </button>
                    {!allDone2 && (
                      <p style={{ marginTop:'8px',fontSize:'11px',color:'#94a3b8' }}>Button unlocks automatically when all agents complete</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
};
