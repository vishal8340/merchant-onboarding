import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MerchantApplication, AgentType, AgentStatus } from '../types';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { UserHeader } from './UserHeader';

export const DocumentUpload: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [application, setApplication] = useState<MerchantApplication | null>(null);
  const [selectedType, setSelectedType] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'textract' | 'structuring' | 'agents' | ''>('');
  const [docMsgTick, setDocMsgTick] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const [pulseSubmit, setPulseSubmit] = useState(false);
  const [uploadError, setUploadError] = useState<{ message: string; detectedLabel?: string; detectedType?: string; expectedLabel?: string } | null>(null);
  const [duplicateBlock, setDuplicateBlock] = useState<{ message: string; fields: string[] } | null>(null);
  // Agent monitoring phase state
  const [agentData, setAgentData] = useState<MerchantApplication | null>(null);
  const [agentSubStepTick, setAgentSubStepTick] = useState(0);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const agentPollRef = useRef<NodeJS.Timeout | null>(null);
  const logIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const agentsDoneRef = useRef(false);

  // Dismiss mismatch modal on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUploadError(null); };
    if (uploadError) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploadError]);
  useEffect(() => {
    const hasAllRequired = ['BUSINESS_LICENSE', 'TAX_CERTIFICATE'].every(t =>
      application?.documents?.some((d: any) => d.type === t)
    );
    if (hasAllRequired) {
      setPulseSubmit(true);
      setTimeout(() => submitBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
      const t = setTimeout(() => setPulseSubmit(false), 3000);
      return () => clearTimeout(t);
    }
  }, [application?.documents?.length]);
  // Drive the per-document status message cycling while Textract is scanning
  useEffect(() => {
    if (!isSubmitting || submitPhase !== 'textract') return;
    setDocMsgTick(0);
    const t = setInterval(() => setDocMsgTick(n => n + 1), 1800);
    return () => clearInterval(t);
  }, [isSubmitting, submitPhase]);

  // Poll agent status once in 'agents' phase — auto-redirect when all done
  useEffect(() => {
    if (!isSubmitting || submitPhase !== 'agents' || !id) return;
    agentsDoneRef.current = false;
    const isTerminal = (s: AgentStatus) =>
      s === AgentStatus.PASSED || s === AgentStatus.FAILED || s === AgentStatus.MANUAL_REVIEW_REQUIRED;
    const poll = async () => {
      try {
        const app = await api.getApplication(id);
        setAgentData(app);
        const allDone = [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(type => {
          const r = app.agentResults.find((a: any) => a.agentType === type);
          return r && isTerminal(r.status);
        });
        if (allDone && !agentsDoneRef.current) {
          agentsDoneRef.current = true;
          clearInterval(agentPollRef.current!);
          agentPollRef.current = null;
        }
      } catch {}
    };
    poll();
    agentPollRef.current = setInterval(poll, 2500);
    return () => {
      if (agentPollRef.current) { clearInterval(agentPollRef.current); agentPollRef.current = null; }
      if (logIntervalRef.current) { clearInterval(logIntervalRef.current); logIntervalRef.current = null; }
    };
  }, [isSubmitting, submitPhase, id]);

  // Sub-step tick for agent cards
  useEffect(() => {
    if (!isSubmitting || submitPhase !== 'agents') return;
    const t = setInterval(() => setAgentSubStepTick(n => n + 1), 2000);
    return () => clearInterval(t);
  }, [isSubmitting, submitPhase]);

  // Live log cycling during agents phase
  useEffect(() => {
    if (!isSubmitting || submitPhase !== 'agents') return;
    const msgs = [
      '🪪 [KYC] Extracting identity fields from uploaded documents…',
      '📋 [KYC] Cross-referencing business name with Tax ID records…',
      '🔐 [KYC] Running AML & sanctions compliance checks…',
      '🤖 [KYC] Calling EPAM AI DIAL (gpt-4o) for compliance analysis…',
      '🏷️ [MCC] Embedding business description via text-embedding-3-small-1…',
      '📚 [MCC] Searching MCC Handbook using LangChain4j RAG lookup…',
      '🤖 [MCC] GPT-4o classifying 4-digit merchant category code…',
      '⚖️ [RISK] Running Weka RandomForest model on merchant features…',
      '📈 [RISK] Computing LIME explainability feature importance scores…',
      '🌍 [RISK] Evaluating country risk & regulatory exposure…',
      '🔍 [RISK] Scanning documents for fraud signals & keywords…',
      '📡 [RISK] Querying Smart Risk Scoring service (port 8080)…',
      '🔄 All 3 agents running in parallel via RabbitMQ event bus…',
      '⏱️ Awaiting KYC · MCC · RISK results from agent pipeline…',
    ];
    let idx = 0;
    setLiveLog([msgs[0]]);
    logIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % msgs.length;
      setLiveLog(prev => [msgs[idx], ...prev].slice(0, 7));
    }, 2200);
    return () => { if (logIntervalRef.current) { clearInterval(logIntervalRef.current); logIntervalRef.current = null; } };
  }, [isSubmitting, submitPhase]);

  const documentTypes = [
    { value: 'BUSINESS_LICENSE',        label: 'Business License',                    icon: '📄', required: true,  color: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
    { value: 'TAX_CERTIFICATE',         label: 'Tax Certificate',                     icon: '📋', required: true,  color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
    { value: 'BENEFICIAL_OWNERSHIP',    label: 'Beneficial Ownership',                icon: '👥', required: false, color: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
    { value: 'BANK_STATEMENT',          label: 'Bank Statement',                      icon: '🏦', required: false, color: '#0891b2', bg: '#ecfeff', border: '#67e8f9' },
    { value: 'ID_DOCUMENT',             label: 'ID Document',                         icon: '🪪', required: false, color: '#db2777', bg: '#fdf2f8', border: '#f9a8d4' },
    { value: 'BANK_ACCOUNT_INFO',       label: 'Bank Account Info',                   icon: '💳', required: false, color: '#059669', bg: '#ecfdf5', border: '#6ee7b7' },
    { value: 'BUSINESS_WEBSITE',        label: 'Website & Online Presence',           icon: '🌐', required: false, color: '#0284c7', bg: '#f0f9ff', border: '#7dd3fc' },
    { value: 'BUSINESS_PLAN',           label: 'Business Plan & Projections',         icon: '📈', required: false, color: '#be123c', bg: '#fff1f2', border: '#fda4af' },
    { value: 'COMPLIANCE_DOCUMENTATION',label: 'Compliance Documentation',            icon: '🛡️', required: false, color: '#6d28d9', bg: '#faf5ff', border: '#ddd6fe' }
  ];

  useEffect(() => { loadApplication(); }, [id]);

  const loadApplication = async () => {
    if (!id) return;
    try {
      const app = await api.getApplication(id);
      setApplication(app);
      // Check for duplicate merchant on every load
      const dupResult = await api.checkDuplicate(id);
      if (dupResult.isDuplicate) {
        setDuplicateBlock({ message: dupResult.message, fields: dupResult.conflictingFields });
      } else {
        setDuplicateBlock(null);
      }
    } catch (error) {
      console.error('Failed to load application:', error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) uploadFile(event.target.files[0]);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  };

  const uploadFile = async (file: File) => {
    if (!id || !selectedType) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('type', selectedType);
      const response = await axios.post(
        `http://localhost:3001/api/applications/${id}/documents`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setApplication(response.data);
      setSelectedType('');
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error: any) {
      const data = error?.response?.data;
      if (error?.response?.status === 422 && data?.error) {
        setUploadError({
          message: data.error,
          detectedLabel: data.detectedLabel,
          detectedType: data.detectedType,
          expectedLabel: data.expectedLabel,
        });
      } else {
        setUploadError({ message: 'Upload failed. Please try again.' });
      }
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } finally {
      setIsUploading(false);
    }
  };



  const handleSubmit = async () => {
    if (!id || !application) return;

    if (application.documents.length === 0) {
      alert('Please upload at least one document');
      return;
    }

    const requiredDocs = documentTypes.filter(t => t.required);
    const uploadedTypes = application.documents.map(d => d.type);
    const missingRequired = requiredDocs.filter(t => !uploadedTypes.includes(t.value));
    if (missingRequired.length > 0) {
      alert(`Missing required documents: ${missingRequired.map(d => d.label).join(', ')}`);
      return;
    }

    setIsSubmitting(true);
    setSubmitPhase('textract');
    setDocMsgTick(0);
    try {
      await api.submitApplication(id);
      setSubmitPhase('structuring');
      await new Promise(r => setTimeout(r, 600));
      setSubmitPhase('agents');
    } catch (error) {
      alert('Failed to submit application');
      setIsSubmitting(false);
      setSubmitPhase('');
    }
  };

  if (!application) {
    return (
      <div style={{ height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f1f5f9' }}>
        <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <div style={{ textAlign:'center',animation:'fadeIn 0.5s ease' }}>
          <div style={{ width:'52px',height:'52px',border:'3px solid rgba(37,99,235,0.15)',borderTop:'3px solid #2563eb',borderRadius:'50%',animation:'spin 0.9s linear infinite',margin:'0 auto 20px' }} />
          <p style={{ margin:0,fontSize:'14px',color:'#94a3b8',letterSpacing:'0.05em' }}>Loading application…</p>
        </div>
      </div>
    );
  }

  const uploadedTypes = application.documents.map(d => d.type);
  const allRequiredUploaded = documentTypes.filter(t => t.required).every(t => uploadedTypes.includes(t.value));

  if (isSubmitting) {
    const docMsgs = [
      'Uploading to AWS S3…',
      'AWS Textract analyzing…',
      'Extracting form fields…',
      'Reading text blocks…',
      'Parsing key-value pairs…',
      'Cross-referencing data…',
    ];
    const agentDefs = [
      { type: AgentType.KYC,  emoji: '🪪', label: 'KYC Verification',   color: '#60a5fa', subSteps: ['Extracting identity fields from documents…', 'Cross-referencing business name & Tax ID…', 'Running AML & sanctions checks…', 'Calling EPAM AI DIAL for compliance…'] },
      { type: AgentType.MCC,  emoji: '🏷️', label: 'MCC Classification',  color: '#a78bfa', subSteps: ['Embedding description via RAG…', 'Searching MCC Handbook (LangChain4j)…', 'GPT-4o classifying merchant category…', 'Validating MCC code with handbook…'] },
      { type: AgentType.RISK, emoji: '⚖️', label: 'Risk Assessment',     color: '#34d399', subSteps: ['Running Weka RandomForest model…', 'Computing LIME feature importance…', 'Checking fraud signals in documents…', 'Querying Smart Risk Scoring API…'] },
    ];
    const docsComplete = submitPhase !== 'textract';
    const agentsActive = submitPhase === 'agents';
    const isTerminalStatus = (s: AgentStatus) =>
      s === AgentStatus.PASSED || s === AgentStatus.FAILED || s === AgentStatus.MANUAL_REVIEW_REQUIRED;
    const getAgentResult = (type: AgentType) => agentData?.agentResults?.find((r: any) => r.agentType === type);
    const getAgentStatus = (type: AgentType): AgentStatus =>
      (getAgentResult(type)?.status as AgentStatus) ?? AgentStatus.PENDING;
    const allAgentsDone = agentsDoneRef.current || (agentsActive && [AgentType.KYC, AgentType.MCC, AgentType.RISK].every(t => isTerminalStatus(getAgentStatus(t))));

    const phaseSteps = [
      { key: 'textract',    emoji: '☁️', label: 'Document Analysis', sub: 'AWS Textract' },
      { key: 'structuring', emoji: '⚙️', label: 'Data Processing',   sub: 'Merge & normalize' },
      { key: 'agents',      emoji: '🤖', label: 'AI Agent Pipeline', sub: 'KYC · MCC · RISK' },
    ];
    const phaseOrder = ['textract', 'structuring', 'agents'] as const;
    const phaseIdx = phaseOrder.indexOf(submitPhase as any);

    const statusConfig: Record<AgentStatus, { label: string; badgeBg: string; badgeColor: string; border: string; bg: string }> = {
      [AgentStatus.PENDING]:                  { label: 'Queued',   bg: '#f8fafc',  border: '#e2e8f0',  badgeBg: '#f1f5f9',  badgeColor: '#94a3b8' },
      [AgentStatus.IN_PROGRESS]:              { label: 'Running…', bg: '#eef2ff',  border: '#c7d2fe',  badgeBg: '#e0e7ff',  badgeColor: '#4338ca' },
      [AgentStatus.PASSED]:                   { label: 'Passed',   bg: '#f0fdf4',  border: '#86efac',  badgeBg: '#dcfce7',  badgeColor: '#16a34a' },
      [AgentStatus.FAILED]:                   { label: 'Failed',   bg: '#fef2f2',  border: '#fca5a5',  badgeBg: '#fee2e2',  badgeColor: '#dc2626' },
      [AgentStatus.MANUAL_REVIEW_REQUIRED]:   { label: 'Review',   bg: '#fffbeb',  border: '#fde68a',  badgeBg: '#fef3c7',  badgeColor: '#d97706' },
    };

    return (
      <div style={{ position:'fixed', inset:0, background:'#f1f5f9', display:'flex', flexDirection:'column', zIndex:9999, overflowY:'auto', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
        <UserHeader overrideLabel="AI Agent Processing" />
        <style>{`
          @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
          @keyframes fadeInFast{from{opacity:0}to{opacity:1}}
          @keyframes fillDocProg{from{width:0%}to{width:88%}}
          @keyframes completeProg{from{width:0%}to{width:100%}}
          @keyframes blink{0%,100%{opacity:1}50%{opacity:0.25}}
          @keyframes msgSlide{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
          @keyframes logSlide{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
          @keyframes agentPing{0%{transform:scale(1);opacity:0.6}100%{transform:scale(1.7);opacity:0}}
          @keyframes shimmerBar{0%{background-position:200% 0}100%{background-position:-200% 0}}
          @keyframes successPop{0%{transform:scale(0.6);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
          @keyframes redirectBar{from{width:0%}to{width:100%}}
        `}</style>

        {/* ═══ PIPELINE STEPPER ═══ */}
        <div style={{ background:'#ffffff', borderBottom:'1px solid #e2e8f0', padding:'10px 28px', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'24px', maxWidth:'640px', margin:'0 auto' }}>
            <div style={{ display:'flex', alignItems:'center', gap:0, flex:1 }}>
            {phaseSteps.map((ph, i) => {
              const isDone = i < phaseIdx || (ph.key === 'agents' && allAgentsDone);
              const isActive = i === phaseIdx;
              return (
                <React.Fragment key={ph.key}>
                  <div style={{ flex:1, textAlign:'center' }}>
                    <div style={{ width:'40px', height:'40px', borderRadius:'50%', margin:'0 auto 6px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', background: isDone ? '#10b981' : isActive ? '#6366f1' : '#e2e8f0', color: isDone || isActive ? '#fff' : '#94a3b8', boxShadow: isActive && !allAgentsDone ? '0 0 0 4px rgba(99,102,241,0.2)' : 'none', transition:'all 0.4s' }}>
                      {isDone ? '✅' : isActive && i < 2 ? <span style={{ width:'16px', height:'16px', border:'2px solid rgba(255,255,255,0.3)', borderTop:'2px solid #fff', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite' }} /> : ph.emoji}
                    </div>
                    <p style={{ margin:0, fontSize:'13px', fontWeight: isActive ? 800 : 600, color: isActive ? '#4338ca' : isDone ? '#059669' : '#94a3b8' }}>{ph.label}</p>
                    <p style={{ margin:0, fontSize:'11px', color:'#94a3b8' }}>{ph.sub}</p>
                  </div>
                  {i < phaseSteps.length - 1 && <div style={{ width:'28px', height:'2px', background: i < phaseIdx ? '#10b981' : '#e2e8f0', transition:'background 0.6s', flexShrink:0, marginBottom:'22px' }} />}
                </React.Fragment>
              );
            })}
            </div>
            {/* LIVE badge beside the stepper */}
            {!allAgentsDone && (
              <div style={{ display:'flex', alignItems:'center', gap:'6px', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:'20px', padding:'5px 13px', flexShrink:0 }}>
                <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#6366f1', display:'inline-block', animation:'blink 1s infinite' }} />
                <span style={{ fontSize:'12px', fontWeight:900, color:'#4338ca', letterSpacing:'0.08em' }}>⚡ LIVE</span>
              </div>
            )}
          </div>
        </div>

        {/* ═══ MAIN CONTENT ═══ */}
        <div style={{ flex:1, padding:'20px 28px', display:'flex', gap:'20px', alignItems:'flex-start', maxWidth:'1080px', margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

          {/* LEFT: Document Analysis + Live Log */}
          <div style={{ flex:1, minWidth:0 }}>

            {/* Document Analysis Card */}
            <div style={{ background:'#ffffff', border:`1px solid ${docsComplete ? '#86efac' : '#fde68a'}`, borderRadius:'16px', padding:'16px', marginBottom:'14px', transition:'border-color 0.5s', boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'13px' }}>
                <div style={{ width:'36px', height:'36px', borderRadius:'10px', background: docsComplete ? '#dcfce7' : '#fef3c7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'20px' }}>{docsComplete ? '✅' : '☁️'}</div>
                <div style={{ flex:1 }}>
                  <p style={{ margin:0, fontSize:'15px', fontWeight:800, color:'#0f172a' }}>Document Analysis</p>
                  <p style={{ margin:0, fontSize:'13px', color:'#64748b' }}>{docsComplete ? 'Text extracted and structured successfully' : `AWS Textract · ${application.documents.length} document${application.documents.length > 1 ? 's' : ''} queued`}</p>
                </div>
                {!docsComplete && <span style={{ fontSize:'12px', fontWeight:900, color:'#d97706', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:'6px', padding:'2px 8px', animation:'blink 1.5s infinite', flexShrink:0 }}>SCANNING</span>}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {application.documents.map((doc: any, i: number) => {
                  const dt = documentTypes.find(t => t.value === doc.type);
                  const msgIdx = (docMsgTick + i * 3) % docMsgs.length;
                  const dur = 7 + i * 1.4;
                  return (
                    <div key={doc.id} style={{ background:'#f8fafc', border:`1px solid ${docsComplete ? '#86efac' : '#e2e8f0'}`, borderRadius:'10px', padding:'10px 12px', transition:'border-color 0.4s' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
                        <span style={{ fontSize:'17px', flexShrink:0 }}>{dt?.icon || '📄'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ margin:0, fontSize:'11px', fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.filename}</p>
                          <span style={{ fontSize:'11px', background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:'4px', padding:'1px 6px', fontWeight:700 }}>{dt?.label || doc.type}</span>
                        </div>
                        {docsComplete
                          ? <span style={{ fontSize:'18px', animation:'fadeInFast 0.3s ease' }}>✅</span>
                          : <span style={{ width:'14px', height:'14px', border:'2px solid #fde68a', borderTop:'2px solid #f59e0b', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite', flexShrink:0 }} />}
                      </div>
                      <div style={{ height:'4px', background:'#e2e8f0', borderRadius:'999px', overflow:'hidden', marginBottom:'5px' }}>
                        <div style={{ height:'100%', borderRadius:'999px', background: docsComplete ? 'linear-gradient(90deg,#10b981,#059669)' : 'linear-gradient(90deg,#f59e0b,#f97316)', animationName: docsComplete ? 'completeProg' : 'fillDocProg', animationDuration: docsComplete ? '0.5s' : `${dur}s`, animationTimingFunction: docsComplete ? 'ease-out' : 'cubic-bezier(0.05,0.5,0.7,1.0)', animationFillMode:'forwards', animationDelay: docsComplete ? '0s' : `${i * 0.3}s` } as React.CSSProperties} />
                      </div>
                      {!docsComplete
                        ? <p style={{ margin:0, fontSize:'12px', color:'#94a3b8', animation:'msgSlide 0.3s ease' }}>{docMsgs[msgIdx]}</p>
                        : <p style={{ margin:0, fontSize:'12px', color:'#059669', fontWeight:600 }}>✅ Text extracted · ready for AI</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Processing Feed — shown once agents start */}
            {agentsActive && (
              <div style={{ background:'#0d1117', border:'1px solid rgba(99,102,241,0.18)', borderRadius:'16px', padding:'14px 16px', animation:'fadeIn 0.4s ease' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
                  <span style={{ fontSize:'14px', fontWeight:800, color:'#6366f1', letterSpacing:'0.02em' }}>⚡ Live Processing Feed</span>
                  <span style={{ fontSize:'11px', background:'rgba(99,102,241,0.14)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.2)', borderRadius:'10px', padding:'1px 9px', fontWeight:800, letterSpacing:'0.08em', animation: allAgentsDone ? 'none' : 'blink 1.5s infinite' }}>{allAgentsDone ? 'DONE' : 'LIVE'}</span>
                </div>
                <div style={{ fontFamily:'"Courier New",monospace', fontSize:'13px', lineHeight:1.8 }}>
                  {liveLog.map((msg, i) => (
                    <div key={i} style={{ color: i === 0 ? '#a5f3fc' : `rgba(148,163,184,${Math.max(0.18, 0.85 - i * 0.12)})`, animation: i === 0 ? 'logSlide 0.3s ease' : 'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{msg}</div>
                  ))}
                  {allAgentsDone && <div style={{ color:'#10b981', marginTop:'4px', fontWeight:700, fontSize:'13px' }}>✅ All agents completed successfully · click Proceed to view results</div>}
                </div>
              </div>
            )}

            {/* Footer tip */}
            <p style={{ margin:'14px 0 0', fontSize:'13px', color:'#94a3b8', display:'flex', alignItems:'center', gap:'6px' }}>
              <span>⏱️</span>
              <span>Powered by EPAM AI DIAL · GPT-4o · LangChain4j RAG · Weka · AWS Textract · Do not close this window</span>
            </p>
          </div>

          {/* RIGHT: AI Agent Cards */}
          <div style={{ width:'320px', flexShrink:0 }}>
            <p style={{ margin:'0 0 10px', fontSize:'13px', fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.09em' }}>AI Agent Pipeline</p>
            {agentDefs.map((agent, i) => {
              const status = agentsActive ? getAgentStatus(agent.type) : AgentStatus.PENDING;
              const isPending = agentsActive && status === AgentStatus.PENDING;
              const isRunning = status === AgentStatus.IN_PROGRESS;
              const isDone = isTerminalStatus(status);
              const result = agentsActive ? getAgentResult(agent.type) : undefined;
              const subStep = agent.subSteps[agentSubStepTick % agent.subSteps.length];
              const sc = statusConfig[status];
              return (
                <div key={agent.type} style={{ background: isPending ? '#f8fafc' : sc.bg, border:`1px solid ${isPending ? '#e2e8f0' : sc.border}`, borderRadius:'14px', padding:'13px', marginBottom:'10px', transition:'all 0.4s', animation:`fadeIn ${0.25 + i * 0.1}s ease`, position:'relative', overflow:'hidden' }}>
                  {isRunning && <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg,transparent,rgba(99,102,241,0.04),transparent)', backgroundSize:'200% 100%', animation:'shimmerBar 2.2s linear infinite' }} />}
                  <div style={{ display:'flex', alignItems:'center', gap:'10px', position:'relative', marginBottom: (isRunning || isDone) ? '6px' : 0 }}>
                    <div style={{ position:'relative', flexShrink:0 }}>
                      {isRunning && <div style={{ position:'absolute', inset:'-5px', borderRadius:'50%', border:`1.5px solid ${sc.border}`, animation:'agentPing 1.5s ease-out infinite' }} />}
                      <div style={{ width:'44px', height:'44px', borderRadius:'50%', background: isRunning ? '#eef2ff' : isDone ? sc.badgeBg : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px' }}>{agent.emoji}</div>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:'15px', fontWeight:800, color: isDone || isRunning ? '#0f172a' : isPending ? '#475569' : '#94a3b8' }}>{agent.label}</p>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px', marginTop:'2px', flexWrap:'wrap' }}>
                        {isPending ? (
                          <span style={{ fontSize:'12px', background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'2px 9px', fontWeight:700, display:'inline-flex', alignItems:'center', gap:'5px' }}>
                            <span style={{ width:'7px', height:'7px', borderRadius:'50%', border:'1.5px solid #94a3b8', borderTop:'1.5px solid #475569', display:'inline-block', animation:'spin 1.4s linear infinite' }} />
                            In queue…
                          </span>
                        ) : (
                          <span style={{ fontSize:'12px', background:sc.badgeBg, color:sc.badgeColor, border:`1px solid ${sc.border}`, borderRadius:'8px', padding:'2px 9px', fontWeight:800, display:'inline-flex', alignItems:'center', gap:'4px' }}>
                            {isRunning && <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:sc.badgeColor, display:'inline-block', animation:'blink 0.8s infinite' }} />}
                            {sc.label}
                          </span>
                        )}
                        {isDone && (result as any)?.score !== undefined && (
                          <span style={{ fontSize:'12px', color:'#64748b', fontWeight:600 }}>Score: {(result as any).score}</span>
                        )}
                      </div>
                    </div>
                    {!agentsActive && <span style={{ fontSize:'16px', flexShrink:0, opacity:0.3 }}>⏳</span>}
                    {isPending && <span style={{ width:'20px', height:'20px', border:'2.5px solid #e2e8f0', borderTop:'2.5px solid #64748b', borderRadius:'50%', display:'inline-block', animation:'spin 1.4s linear infinite', flexShrink:0 }} />}
                    {isRunning && <span style={{ width:'17px', height:'17px', border:'2.5px solid #c7d2fe', borderTop:'2.5px solid #6366f1', borderRadius:'50%', display:'inline-block', animation:'spin 0.8s linear infinite', flexShrink:0 }} />}
                    {status === AgentStatus.PASSED && <span style={{ fontSize:'22px', flexShrink:0, animation:'fadeInFast 0.4s ease' }}>✅</span>}
                    {status === AgentStatus.FAILED && <span style={{ fontSize:'22px', flexShrink:0 }}>❌</span>}
                    {status === AgentStatus.MANUAL_REVIEW_REQUIRED && <span style={{ fontSize:'22px', flexShrink:0 }}>🔍</span>}
                  </div>
                  {isRunning && (
                    <p style={{ margin:0, fontSize:'12px', color:agent.color, fontStyle:'italic', animation:'msgSlide 0.3s ease', paddingLeft:'54px' }}>{subStep}</p>
                  )}
                  {isDone && (result as any)?.findings?.[0] && (
                    <p style={{ margin:0, fontSize:'12px', color:'#64748b', paddingLeft:'54px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(result as any).findings[0]}</p>
                  )}
                </div>
              );
            })}

            {/* All-done: Proceed button */}
            {allAgentsDone && (
              <div style={{ background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', border:'1px solid #86efac', borderRadius:'16px', padding:'20px 20px', animation:'successPop 0.5s ease', boxShadow:'0 4px 20px rgba(16,185,129,0.15)' }}>
                <button
                  onClick={() => navigate(`/application/${id}/intelligence`)}
                  style={{ width:'100%', padding:'16px 24px', background:'linear-gradient(135deg,#059669,#047857)', border:'none', borderRadius:'12px', color:'#ffffff', fontSize:'17px', fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', boxShadow:'0 4px 16px rgba(5,150,105,0.4)', transition:'all 0.2s', letterSpacing:'0.01em' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(5,150,105,0.5)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(5,150,105,0.4)'; }}
                >
                  <span>View Full Intelligence Report</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                </button>
              </div>
            )}

            {/* Waiting for agents to start */}
            {!agentsActive && (
              <div style={{ background:'#ffffff', border:'1px solid #e2e8f0', borderRadius:'14px', padding:'14px', textAlign:'center', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
                <div style={{ width:'18px', height:'18px', border:'2px solid #e2e8f0', borderTop:'2px solid #94a3b8', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 8px' }} />
                <p style={{ margin:0, fontSize:'13px', color:'#94a3b8' }}>Preparing agent pipeline…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const selType = documentTypes.find(t => t.value === selectedType);

  return (
    <>
      {/* ── Document Mismatch Modal Overlay ── */}
      {uploadError && (
        <div
          onClick={() => setUploadError(null)}
          style={{
            position:'fixed',inset:0,zIndex:9999,
            display:'flex',alignItems:'center',justifyContent:'center',
            background:'rgba(15,23,42,0.65)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',
            animation:'fadeIn 0.18s ease',padding:'16px',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:'#fff',borderRadius:'24px',overflow:'hidden',
              width:'480px',maxWidth:'100%',
              boxShadow:'0 40px 100px rgba(0,0,0,0.4),0 0 0 1px rgba(220,38,38,0.12)',
              animation:'scaleIn 0.24s cubic-bezier(0.34,1.56,0.64,1)',
            }}>

            {/* ─ Header with pulsing icon ─ */}
            <div style={{ background:'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)',padding:'20px 22px 18px',position:'relative',overflow:'hidden' }}>
              {/* decorative circles */}
              <div style={{ position:'absolute',top:'-20px',right:'-20px',width:'100px',height:'100px',background:'rgba(255,255,255,0.06)',borderRadius:'50%' }} />
              <div style={{ position:'absolute',bottom:'-30px',right:'40px',width:'70px',height:'70px',background:'rgba(255,255,255,0.04)',borderRadius:'50%' }} />
              <div style={{ display:'flex',alignItems:'center',gap:'14px',position:'relative' }}>
                <div style={{ width:'48px',height:'48px',background:'rgba(255,255,255,0.18)',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:'1.5px solid rgba(255,255,255,0.25)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
                <div style={{ flex:1 }}>
                  <p style={{ margin:'0 0 4px',fontWeight:900,color:'white',fontSize:'17px',letterSpacing:'-0.3px' }}>Wrong Document Uploaded</p>
                  <p style={{ margin:0,fontSize:'12.5px',color:'rgba(255,255,255,0.82)',lineHeight:1.45 }}>Our AI scanned your file and found a type mismatch</p>
                </div>
                <button
                  onClick={() => setUploadError(null)}
                  style={{ background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:'8px',width:'32px',height:'32px',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'white',fontSize:'17px',flexShrink:0,lineHeight:1,transition:'background 0.15s' }}
                  onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.28)')}
                  onMouseLeave={e=>(e.currentTarget.style.background='rgba(255,255,255,0.15)')}
                  title="Dismiss">
                  ✕
                </button>
              </div>
            </div>

            <div style={{ padding:'20px 22px 22px' }}>

              {/* ─ AI scan flow: uploaded → AI → mismatch ─ */}
              <div style={{ display:'flex',alignItems:'center',gap:0,marginBottom:'18px' }}>

                {/* File uploaded card */}
                <div style={{ flex:1,background:'#fef2f2',border:'2px solid #fca5a5',borderRadius:'16px',padding:'14px 10px 12px',textAlign:'center',display:'flex',flexDirection:'column' as const,alignItems:'center',gap:'5px' }}>
                  <div style={{ fontSize:'11px',fontWeight:800,color:'#ef4444',textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:'2px' }}>You Uploaded</div>
                  <div style={{ fontSize:'36px',lineHeight:1,marginBottom:'2px' }}>{documentTypes.find(d=>d.value===uploadError.detectedType)?.icon ?? '📄'}</div>
                  <div style={{ fontSize:'12.5px',fontWeight:800,color:'#7f1d1d',lineHeight:1.3 }}>{uploadError.detectedLabel ?? '—'}</div>
                  <div style={{ marginTop:'2px',background:'#fecaca',border:'1px solid #f87171',borderRadius:'20px',padding:'2px 10px',fontSize:'10px',fontWeight:800,color:'#b91c1c',letterSpacing:'0.05em' }}>DETECTED</div>
                </div>

                {/* Arrow + AI badge */}
                <div style={{ display:'flex',flexDirection:'column' as const,alignItems:'center',gap:'4px',padding:'0 6px',flexShrink:0 }}>
                  <div style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)',borderRadius:'10px',padding:'5px 8px',display:'flex',flexDirection:'column' as const,alignItems:'center',gap:'2px',boxShadow:'0 3px 10px rgba(124,58,237,0.35)' }}>
                    <span style={{ fontSize:'14px' }}>🤖</span>
                    <span style={{ fontSize:'8px',fontWeight:800,color:'rgba(255,255,255,0.9)',letterSpacing:'0.04em',textTransform:'uppercase' as const }}>AI</span>
                  </div>
                  <svg width="28" height="10" viewBox="0 0 28 10">
                    <path d="M0 5 L20 5 M15 1 L20 5 L15 9" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                </div>

                {/* Expected card */}
                <div style={{ flex:1,background:'#f0fdf4',border:'2px solid #86efac',borderRadius:'16px',padding:'14px 10px 12px',textAlign:'center',display:'flex',flexDirection:'column' as const,alignItems:'center',gap:'5px' }}>
                  <div style={{ fontSize:'11px',fontWeight:800,color:'#16a34a',textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:'2px' }}>You Selected</div>
                  <div style={{ fontSize:'36px',lineHeight:1,marginBottom:'2px' }}>{selType?.icon ?? '📋'}</div>
                  <div style={{ fontSize:'12.5px',fontWeight:800,color:'#14532d',lineHeight:1.3 }}>{uploadError.expectedLabel ?? selType?.label ?? '—'}</div>
                  <div style={{ marginTop:'2px',background:'#bbf7d0',border:'1px solid #4ade80',borderRadius:'20px',padding:'2px 10px',fontSize:'10px',fontWeight:800,color:'#15803d',letterSpacing:'0.05em' }}>EXPECTED</div>
                </div>
              </div>

              {/* ─ What went wrong ─ */}
              <div style={{ background:'linear-gradient(135deg,#fff7ed,#fffbeb)',border:'1.5px solid #fcd34d',borderRadius:'12px',padding:'12px 14px',marginBottom:'18px' }}>
                <div style={{ display:'flex',gap:'10px',alignItems:'flex-start' }}>
                  <div style={{ fontSize:'20px',flexShrink:0,lineHeight:1 }}>💡</div>
                  <div>
                    <p style={{ margin:'0 0 3px',fontSize:'12px',fontWeight:800,color:'#92400e' }}>What happened?</p>
                    <p style={{ margin:0,fontSize:'12px',color:'#78350f',lineHeight:1.6 }}>The file you uploaded looks like a <strong style={{ color:'#dc2626' }}>{uploadError.detectedLabel}</strong>, but you selected <strong style={{ color:'#16a34a' }}>{uploadError.expectedLabel ?? selType?.label}</strong> as the document type. Please upload the right file.</p>
                  </div>
                </div>
              </div>

              {/* ─ What to do (numbered steps) ─ */}
              <div style={{ marginBottom:'18px' }}>
                <p style={{ margin:'0 0 8px',fontSize:'11px',fontWeight:800,color:'#64748b',textTransform:'uppercase' as const,letterSpacing:'0.08em' }}>What you can do</p>
                <div style={{ display:'flex',flexDirection:'column' as const,gap:'6px' }}>
                  <div style={{ display:'flex',gap:'10px',alignItems:'flex-start',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'9px 12px' }}>
                    <div style={{ width:'22px',height:'22px',background:'linear-gradient(135deg,#3b82f6,#2563eb)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800,color:'white',flexShrink:0 }}>1</div>
                    <div>
                      <p style={{ margin:'0 0 1px',fontSize:'12px',fontWeight:700,color:'#1e293b' }}>Upload the correct file</p>
                      <p style={{ margin:0,fontSize:'11px',color:'#64748b' }}>Keep <strong>{uploadError.expectedLabel ?? selType?.label}</strong> selected and pick the right document</p>
                    </div>
                  </div>
                  {uploadError.detectedType && documentTypes.find(d => d.value === uploadError.detectedType) && (
                    <div style={{ display:'flex',gap:'10px',alignItems:'flex-start',background:'#fdf4ff',border:'1px solid #e9d5ff',borderRadius:'10px',padding:'9px 12px' }}>
                      <div style={{ width:'22px',height:'22px',background:'linear-gradient(135deg,#a855f7,#7c3aed)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800,color:'white',flexShrink:0 }}>2</div>
                      <div>
                        <p style={{ margin:'0 0 1px',fontSize:'12px',fontWeight:700,color:'#1e293b' }}>Or switch the document type</p>
                        <p style={{ margin:0,fontSize:'11px',color:'#64748b' }}>Change selection to <strong>{uploadError.detectedLabel}</strong> — then re-upload the same file</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ─ Action buttons ─ */}
              <div style={{ display:'flex',gap:'10px' }}>
                <button
                  onClick={() => { setUploadError(null); setTimeout(() => (document.getElementById('file-input') as HTMLInputElement)?.click(), 80); }}
                  style={{ flex:1,padding:'12px 14px',background:'white',border:'2px solid #fca5a5',borderRadius:'12px',color:'#dc2626',fontSize:'13px',fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'7px',transition:'all 0.15s',letterSpacing:'0.01em' }}
                  onMouseEnter={e=>{ e.currentTarget.style.background='#fef2f2'; e.currentTarget.style.borderColor='#f87171'; e.currentTarget.style.transform='translateY(-1px)'; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background='white'; e.currentTarget.style.borderColor='#fca5a5'; e.currentTarget.style.transform='none'; }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.75"/></svg>
                  Upload Correct File
                </button>
                {uploadError.detectedType && documentTypes.find(d => d.value === uploadError.detectedType) && (
                  <button
                    onClick={() => { setSelectedType(uploadError.detectedType!); setUploadError(null); }}
                    style={{ flex:1,padding:'12px 14px',background:'linear-gradient(135deg,#7c3aed,#6d28d9)',border:'none',borderRadius:'12px',color:'white',fontSize:'13px',fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'7px',boxShadow:'0 4px 16px rgba(124,58,237,0.4)',transition:'all 0.15s',letterSpacing:'0.01em' }}
                    onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 8px 24px rgba(124,58,237,0.5)'; }}
                    onMouseLeave={e=>{ e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 4px 16px rgba(124,58,237,0.4)'; }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                    Switch to {uploadError.detectedLabel}
                  </button>
                )}
              </div>

              {/* ─ Dismiss hint ─ */}
              <p style={{ textAlign:'center',margin:'12px 0 0',fontSize:'11px',color:'#94a3b8' }}>Press <kbd style={{ background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:'4px',padding:'1px 5px',fontSize:'10px',fontFamily:'monospace',color:'#475569' }}>Esc</kbd> or click outside to dismiss</p>
            </div>
          </div>
        </div>
      )}
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        /* ── Page shell ── */
        .up-page{
          height:100vh;display:flex;flex-direction:column;overflow:hidden;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          background:#f1f5f9;
        }

        /* ── Light Portal Header ── */
        .up-header{
          background:#ffffff;
          border-bottom:1px solid #e2e8f0;
          padding:14px 28px;flex-shrink:0;
          box-shadow:0 1px 4px rgba(0,0,0,0.04);
          display:flex;align-items:center;justify-content:center;gap:16px;position:relative;
        }

        /* ── Layout ── */
        .up-main{flex:1;display:grid;grid-template-columns:1fr 360px;gap:16px;padding:16px 24px;overflow:hidden;min-height:0;}
        .up-col{display:flex;flex-direction:column;gap:12px;overflow:hidden;min-height:0;}

        /* ── Cards ── */
        .card{background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 4px 16px rgba(37,99,235,0.07);border:1px solid #e2e8f0;}

        /* ── Doc grid ── */
        .doc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .doc-tile{
          border:1.5px solid #e2e8f0;border-radius:11px;padding:8px 4px 7px;cursor:pointer;
          background:white;display:flex;flex-direction:column;align-items:center;gap:4px;
          position:relative;min-height:80px;justify-content:center;
          transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);
          box-shadow:0 1px 3px rgba(0,0,0,0.04);
        }
        .doc-tile:hover:not([disabled]){transform:translateY(-3px) scale(1.03);box-shadow:0 8px 20px rgba(37,99,235,0.15)}
        .doc-tile:active:not([disabled]){transform:translateY(0) scale(0.97)}
        .t-icon-wrap{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
        .t-label{font-size:12px;text-align:center;font-weight:700;line-height:1.3;padding:0 3px;letter-spacing:0.01em}
        .req-badge{position:absolute;top:4px;left:4px;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;background:#fee2e2;color:#dc2626;letter-spacing:0.03em;text-transform:uppercase}
        .upl-badge{position:absolute;top:4px;right:4px;width:20px;height:20px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 2px 6px rgba(16,185,129,0.4)}

        /* ── Drop zone ── */
        .drop-zone{
          border:2px dashed #cbd5e1;border-radius:13px;cursor:pointer;
          transition:all 0.25s ease;background:#f8fafc;
          flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
          min-height:0;padding:24px;
        }
        .drop-zone:hover{border-color:#2563eb;background:#eff6ff;}
        .drop-zone.dz-active{border-color:#2563eb;border-style:solid;background:#eff6ff;box-shadow:inset 0 0 0 4px rgba(37,99,235,0.1)}

        /* ── Buttons ── */
        .btn-submit{
          padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;
          background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);color:white;
          box-shadow:0 4px 16px rgba(37,99,235,0.35);
          display:flex;align-items:center;justify-content:center;gap:8px;flex-shrink:0;
          letter-spacing:0.03em;transition:all 0.2s;width:100%;
        }
        .btn-submit:hover:not(:disabled){box-shadow:0 8px 28px rgba(37,99,235,0.45);transform:translateY(-2px)}
        .btn-submit:active:not(:disabled){transform:translateY(0)}
        @keyframes submitPulse{
          0%,100%{box-shadow:0 4px 18px rgba(37,99,235,0.35),0 0 0 0 rgba(37,99,235,0.5)}
          50%{box-shadow:0 4px 18px rgba(37,99,235,0.35),0 0 0 10px rgba(37,99,235,0)}
        }
        @keyframes bounceArrow{
          0%,100%{transform:translateY(0)}
          50%{transform:translateY(5px)}
        }
        .btn-submit-pulse{animation:submitPulse 1s ease-in-out 3!}

        /* ── Docs list ── */
        .docs-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:7px;min-height:0;padding-right:2px}
        .docs-list::-webkit-scrollbar{width:3px}
        .docs-list::-webkit-scrollbar-thumb{background:#bfdbfe;border-radius:3px}
        .doc-row{
          display:flex;align-items:center;gap:10px;padding:10px 12px;
          background:#f8fafc;border:1px solid #e2e8f0;
          border-radius:11px;flex-shrink:0;transition:all 0.18s;
        }
        .doc-row:hover{background:#eff6ff;border-color:#bfdbfe}
        .dr-icon-wrap{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
        .dr-info{flex:1;min-width:0}
        .dr-name{font-size:13px;color:#1e293b;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dr-file{font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
        .dr-check{width:26px;height:26px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;color:white;flex-shrink:0;box-shadow:0 2px 6px rgba(16,185,129,0.3)}

        .sec-title{font-size:13px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.07em}

        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      `}</style>

      <div className="up-page">

        {/* ══ DUPLICATE MERCHANT BLOCKING MODAL ══ */}
        {duplicateBlock && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(15,23,42,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
            animation: 'fadeIn 0.2s ease',
          }}>
            <div style={{
              background: '#fff',
              borderRadius: '20px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'scaleIn 0.22s ease',
            }}>
              {/* Red top strip */}
              <div style={{ height: '6px', background: 'linear-gradient(90deg, #f59e0b, #ef4444)' }} />
              <div style={{ padding: '32px 32px 28px' }}>
                {/* Icon */}
                <div style={{
                  width: '64px', height: '64px', borderRadius: '16px',
                  background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                  border: '2px solid #fbbf24',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '30px', margin: '0 auto 20px',
                }}>⚠️</div>

                <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 900, color: '#0f172a', textAlign: 'center', letterSpacing: '-0.3px' }}>
                  Merchant Already Active
                </h2>
                <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#475569', textAlign: 'center', lineHeight: 1.6 }}>
                  {duplicateBlock.message}
                </p>

                {/* Conflicting fields pills */}
                {duplicateBlock.fields.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '24px' }}>
                    {duplicateBlock.fields.map(f => (
                      <span key={f} style={{
                        background: '#fff7ed', border: '1.5px solid #fbbf24',
                        color: '#92400e', borderRadius: '999px',
                        fontSize: '12px', fontWeight: 700, padding: '3px 12px',
                      }}>
                        {{ businessName: '🏢 Business Name', contactEmail: '📧 Email', contactPhone: '📱 Phone' }[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', marginBottom: '24px' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#78350f', lineHeight: 1.5 }}>
                    <strong>To proceed:</strong> Go back and resubmit the application with a different business name, email address, or phone number.
                  </p>
                </div>

                <button
                  onClick={() => navigate('/apply')}
                  style={{
                    width: '100%', padding: '13px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
                    color: '#fff', border: 'none', cursor: 'pointer',
                    fontSize: '14px', fontWeight: 800, letterSpacing: '0.02em',
                    boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
                  }}
                >
                  ← Go Back &amp; Resubmit with Alternate Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ LIGHT PORTAL HEADER ══ */}
        <div className="up-header">
          <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
            <div style={{
              width:'46px',height:'46px',borderRadius:'12px',
              background:'#eff6ff',border:'1.5px solid #bfdbfe',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',
              flexShrink:0,
            }}>📤</div>
            <div>
              <h1 style={{fontSize:'22px',fontWeight:800,margin:'0 0 2px',letterSpacing:'-0.3px',color:'#0f172a'}}>Upload Documents</h1>
              <p style={{fontSize:'13px',margin:0,color:'#94a3b8'}}>
                Select a document type, then drag &amp; drop or click to upload
              </p>
            </div>
          </div>
          <div style={{
            position:'absolute',right:'28px',
            background:'#eff6ff',border:'1.5px solid #bfdbfe',
            borderRadius:'12px',padding:'8px 16px',textAlign:'center',
          }}>
            <div style={{fontSize:'20px',fontWeight:800,color:'#1d4ed8'}}>{uploadedTypes.length}<span style={{fontSize:'13px',fontWeight:500,color:'#64748b'}}>/{documentTypes.length}</span></div>
            <div style={{fontSize:'10px',fontWeight:600,color:'#64748b',letterSpacing:'0.04em'}}>DOCS UPLOADED</div>
          </div>
        </div>

        {/* ══ MAIN GRID ══ */}
        <div className="up-main">

          {/* ── LEFT COLUMN ── */}
          <div className="up-col">

            {/* Document type picker */}
            <div className="card" style={{ flexShrink:0 }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px' }}>
                <p className="sec-title" style={{ margin:0 }}>Choose Document Type</p>
                <div style={{ display:'flex',alignItems:'center',gap:'10px',fontSize:'13px',color:'#64748b' }}>
                  <span><span style={{ display:'inline-block',width:'6px',height:'6px',background:'#ef4444',borderRadius:'50%',verticalAlign:'middle',marginRight:'3px' }}/>Required</span>
                  <span style={{ color:'#10b981',fontWeight:700 }}>✓ Uploaded</span>
                </div>
              </div>

              <div className="doc-grid">
                {documentTypes.map(type => {
                  const isUploaded = uploadedTypes.includes(type.value);
                  const isSelected = selectedType === type.value;
                  const tileStyle: React.CSSProperties = isUploaded
                    ? isSelected
                      ? { borderColor:type.color, background:type.bg, boxShadow:`0 0 0 3px ${type.color}22, 0 8px 24px ${type.color}18`, cursor:'pointer' }
                      : { borderColor:'#6ee7b7', background:'linear-gradient(135deg,#ecfdf5,#d1fae5)', cursor:'pointer' }
                    : isSelected
                    ? { borderColor:type.color, background:type.bg, boxShadow:`0 0 0 3px ${type.color}22, 0 8px 24px ${type.color}18` }
                    : { background:`linear-gradient(145deg, #ffffff 0%, ${type.bg} 100%)`, borderColor: type.border };
                  const iconWrapStyle: React.CSSProperties = {
                    background: isUploaded ? '#dcfce7' : isSelected ? `${type.color}22` : type.bg,
                    border: `2px solid ${isUploaded ? '#6ee7b7' : type.border}`,
                    boxShadow: isUploaded ? 'none' : `0 2px 8px ${type.color}28`,
                  };
                  return (
                    <button key={type.value} onClick={() => { setSelectedType(isSelected ? '' : type.value); setUploadError(null); }}
                      className="doc-tile" style={tileStyle}>
                      {type.required && !isUploaded && <span className="req-badge">Req</span>}
                      {isUploaded && !isSelected && <span className="upl-badge">✓</span>}
                      {isUploaded && isSelected && (
                        <span style={{ position:'absolute',top:'4px',right:'4px',fontSize:'9px',fontWeight:800,background:'#2563eb',color:'white',padding:'2px 5px',borderRadius:'4px',letterSpacing:'0.04em' }}>RE-UPLOAD</span>
                      )}
                      <div className="t-icon-wrap" style={iconWrapStyle}>{type.icon}</div>
                      <span className="t-label" style={{ color: isUploaded ? '#059669' : isSelected ? type.color : '#374151' }}>
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* File drop + upload */}
            <div className="card" style={{ flex:1,display:'flex',flexDirection:'column',gap:'10px',minHeight:0 }}>
              {selType ? (
                <>
                  {/* Selected type header row */}
                  <div style={{ display:'flex',alignItems:'center',gap:'10px',flexShrink:0,paddingBottom:'10px',borderBottom:'1px solid #f1f5f9' }}>
                    <div style={{ width:'36px',height:'36px',borderRadius:'9px',background:selType.bg,border:`1.5px solid ${selType.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0 }}>
                      {selType.icon}
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ margin:0,fontSize:'14px',fontWeight:700,color:'#0f172a' }}>{selType.label}</p>
                      <p style={{ margin:0,fontSize:'12px',color: uploadedTypes.includes(selType.value) ? '#2563eb' : selType.required ? '#b45309' : '#64748b' }}>
                        {uploadedTypes.includes(selType.value) ? '↺ Re-uploading — will replace existing file' : selType.required ? '⚠ Required document' : 'Optional document'}
                      </p>
                    </div>
                    <button onClick={() => { setSelectedType(''); setUploadError(null); }}
                      style={{ background:'#f1f5f9',border:'none',borderRadius:'8px',padding:'6px 12px',fontSize:'13px',color:'#64748b',cursor:'pointer',fontWeight:600,flexShrink:0 }}>
                      ✕ Change
                    </button>
                  </div>

                  {/* Drop area */}
                  <div className={`drop-zone${dragActive?' dz-active':''}`}
                    onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                    onClick={() => !isUploading && document.getElementById('file-input')?.click()}
                    style={{ cursor: isUploading ? 'default' : 'pointer' }}>
                    {isUploading ? (
                      <div style={{ textAlign:'center',animation:'fadeUp 0.3s ease' }}>
                        <div style={{ width:'52px',height:'52px',border:'4px solid rgba(37,99,235,0.15)',borderTop:'4px solid #2563eb',borderRadius:'50%',margin:'0 auto 14px',animation:'spin 0.8s linear infinite' }} />
                        <p style={{ fontWeight:700,color:'#1d4ed8',fontSize:'15px',margin:'0 0 4px' }}>Validating & uploading…</p>
                        <p style={{ fontSize:'12px',color:'#94a3b8',margin:0 }}>AI is verifying document type</p>
                      </div>
                    ) : (
                      <div style={{ textAlign:'center' }}>
                        <div style={{ width:'64px',height:'64px',background:'linear-gradient(135deg,#dbeafe,#bfdbfe)',borderRadius:'18px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'30px',margin:'0 auto 14px',border:'1.5px solid #93c5fd' }}>☁️</div>
                        <p style={{ fontWeight:700,color:'#1e293b',fontSize:'15px',margin:'0 0 6px' }}>Drag & drop your file here</p>
                        <p style={{ fontSize:'13px',color:'#94a3b8',margin:'0 0 14px' }}>or click to browse — AI validates document type instantly</p>
                        <div style={{ display:'inline-flex',gap:'6px',flexWrap:'wrap' as const,justifyContent:'center' }}>
                          {['PDF','JPG','PNG','DOCX'].map(ext => (
                            <span key={ext} style={{ fontSize:'11px',fontWeight:700,padding:'3px 9px',borderRadius:'5px',background:'#f1f5f9',color:'#475569',border:'1px solid #e2e8f0',letterSpacing:'0.04em' }}>{ext}</span>
                          ))}
                          <span style={{ fontSize:'11px',fontWeight:700,padding:'3px 9px',borderRadius:'5px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe' }}>Max 5 MB</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <input id="file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={handleFileSelect} style={{ display:'none' }}/>
                </>
              ) : (
                <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center' }}>
                  <div style={{ width:'68px',height:'68px',background:'linear-gradient(135deg,#eff6ff,#dbeafe)',borderRadius:'18px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'34px',marginBottom:'14px',border:'1.5px dashed #93c5fd' }}>☝️</div>
                  <p style={{ fontWeight:700,fontSize:'15px',color:'#1e293b',margin:'0 0 6px' }}>Select a document type above</p>
                  <p style={{ fontSize:'13px',color:'#94a3b8',margin:0 }}>Click any tile in the grid to activate the upload zone</p>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: uploaded list + progress + CTA ── */}
          <div className="up-col">

            {/* Uploaded docs list */}
            <div className="card" style={{ flex:1,display:'flex',flexDirection:'column',minHeight:0 }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',flexShrink:0 }}>
                <p className="sec-title" style={{ margin:0 }}>Uploaded Documents</p>
                {application.documents.length > 0 && (
                  <span style={{ fontSize:'12px',fontWeight:700,padding:'3px 10px',borderRadius:'20px',background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe' }}>
                    {application.documents.length} file{application.documents.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {application.documents.length === 0 ? (
                <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center' }}>
                  <div style={{ width:'52px',height:'52px',background:'#f8fafc',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'24px',marginBottom:'12px',border:'1px dashed #cbd5e1' }}>📭</div>
                  <p style={{ fontSize:'14px',color:'#64748b',fontWeight:600,margin:'0 0 4px' }}>No documents yet</p>
                  <p style={{ fontSize:'13px',color:'#94a3b8',margin:0 }}>Choose a document type on the left</p>
                </div>
              ) : (
                <div className="docs-list">
                  {application.documents.map(doc => {
                    const dt = documentTypes.find(t => t.value === doc.type);
                    return (
                      <div key={doc.id} className="doc-row" style={{ borderLeft:`3px solid ${dt?.color||'#2563eb'}` }}>
                        <div className="dr-icon-wrap" style={{ background: dt?.bg || '#eff6ff', border:`1.5px solid ${dt?.border||'#bfdbfe'}` }}>
                          {dt?.icon || '📄'}
                        </div>
                        <div className="dr-info">
                          <p className="dr-name">{dt?.label || doc.type.replace(/_/g,' ')}</p>
                          <p className="dr-file">{doc.filename}</p>
                        </div>
                        <button
                          title="Re-upload"
                          onClick={() => setSelectedType(doc.type)}
                          style={{ background:'none',border:'1px solid #e2e8f0',borderRadius:'7px',padding:'4px 8px',cursor:'pointer',fontSize:'13px',color:'#64748b',flexShrink:0,transition:'all 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background='#eff6ff'; (e.currentTarget as HTMLButtonElement).style.borderColor='#93c5fd'; (e.currentTarget as HTMLButtonElement).style.color='#2563eb'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background='none'; (e.currentTarget as HTMLButtonElement).style.borderColor='#e2e8f0'; (e.currentTarget as HTMLButtonElement).style.color='#64748b'; }}
                        >↺</button>
                        <div className="dr-check">✓</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Required doc warning */}
            {!allRequiredUploaded && (
              <div style={{ background:'linear-gradient(135deg,#fff7ed,#fef3c7)',borderRadius:'12px',padding:'12px 16px',border:'1px solid #fcd34d',flexShrink:0,display:'flex',flexDirection:'column' as const,gap:'4px' }}>
                {documentTypes.filter(t => t.required && !uploadedTypes.includes(t.value)).map(t => (
                  <p key={t.value} style={{ fontSize:'13px',color:'#92400e',margin:0,textAlign:'center' as const,lineHeight:1.6 }}>
                    {t.icon} Upload <strong style={{ color:'#b45309' }}>{t.label}</strong> to enable submission
                  </p>
                ))}
              </div>
            )}

            {/* Ready-to-submit nudge */}
            {allRequiredUploaded && (
              <div style={{ background:'linear-gradient(135deg,#ecfdf5,#d1fae5)',border:'1.5px solid #6ee7b7',borderRadius:'12px',padding:'10px 16px',flexShrink:0,textAlign:'center' as const }}>
                <div style={{ fontSize:'11px',fontWeight:700,color:'#059669',textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:'4px' }}>✓ All required documents uploaded</div>
                <div style={{ fontSize:'13px',color:'#065f46',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px' }}>
                  <span style={{ animation:'bounceArrow 0.8s ease-in-out infinite',display:'inline-block' }}>👇</span>
                  Click the button below to proceed
                </div>
              </div>
            )}

            {/* Submit CTA */}
            <button
              ref={submitBtnRef}
              onClick={handleSubmit}
              disabled={isSubmitting || !allRequiredUploaded || !!duplicateBlock}
              className={`btn-submit${pulseSubmit && !duplicateBlock ? ' btn-submit-pulse' : ''}`}
            >
              <span style={{ fontSize:'16px' }}>🚀</span>
              {duplicateBlock ? 'Merchant Already Active — Cannot Proceed' : allRequiredUploaded ? 'Submit for Onboarding Review' : `${documentTypes.filter(t => t.required && !uploadedTypes.includes(t.value)).map(t => t.label).join(' & ')} Required`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

