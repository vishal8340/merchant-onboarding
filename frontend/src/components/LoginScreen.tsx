import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [userId, setUserId]         = useState('');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]           = useState('');
  const [isLoading, setIsLoading]   = useState(false);
  const [focusedField, setFocused]  = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) { setError('Please enter both User ID and password.'); return; }
    setError(''); setIsLoading(true);
    const result = await login(userId.trim(), password);
    setIsLoading(false);
    if (!result.success) { setError(result.error || 'Login failed'); return; }
    const saved = sessionStorage.getItem('auth_user');
    const role = saved ? JSON.parse(saved).role : 'USER';
    if (role === 'ADMIN') navigate('/');
    else if (role === 'APP_MANAGER') navigate('/telemetry');
    else navigate('/application/new');
  };

  const fill = (uid: string, pw: string) => { setUserId(uid); setPassword(pw); setError(''); };

  const inputStyle = (name: string): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: '#fff',
    border: `1.5px solid ${focusedField === name ? '#6366f1' : '#e2e8f0'}`,
    borderRadius: '10px',
    color: '#1e293b', fontSize: '15px',
    padding: '13px 14px 13px 44px',
    outline: 'none',
    boxShadow: focusedField === name ? '0 0 0 3px rgba(99,102,241,0.12)' : 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  });

  return (
    <div style={s.page}>
      <style>{`
        @keyframes loginSpin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideIn { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:translateX(0); } }
        .demo-card:hover { border-color: #6366f1 !important; box-shadow: 0 4px 12px rgba(99,102,241,0.15) !important; }
        .submit-btn:hover:not(:disabled) { background: linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%) !important; box-shadow: 0 8px 24px rgba(99,102,241,0.35) !important; transform: translateY(-1px); }
        .submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      `}</style>

      {/* ── Left accent strip ── */}
      <div style={s.strip} />

      {/* ── Main card ── */}
      <div style={s.card}>

        {/* Left panel — branding */}
        <div style={s.leftPanel}>
          <div style={s.leftContent}>
            <div style={s.bigIcon}>🏦</div>
            <h1 style={s.portalName}>Unified Merchant Portal</h1>
            <p style={s.tagline}>Secure · Intelligent · End-to-End<br />Merchant Onboarding</p>

            <div style={s.featureList}>
              {[
                { icon: '🤖', text: 'AI-Powered KYC & Risk Scoring' },
                { icon: '📄', text: 'Smart Document Analysis' },
                { icon: '⚡', text: 'Real-Time MCC Classification' },
                { icon: '🛡️', text: 'Compliance-First Processing' },
              ].map((f, i) => (
                <div key={i} style={s.featureItem}>
                  <span style={s.featureIcon}>{f.icon}</span>
                  <span style={s.featureText}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel — form */}
        <div style={s.rightPanel}>
          <div style={s.formWrap}>
            <div style={s.formHeader}>
              <div style={s.welcomeBadge}>BFSI Hackathon 2026</div>
              <h2 style={s.formTitle}>Welcome back</h2>
              <p style={s.formSub}>Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleSubmit} autoComplete="off">
              {/* User ID */}
              <div style={s.field}>
                <label style={s.label}>User ID</label>
                <div style={{ position: 'relative' }}>
                  <span style={s.fieldIcon}>👤</span>
                  <input
                    type="text"
                    placeholder="User ID"
                    value={userId}
                    onChange={e => { setUserId(e.target.value); setError(''); }}
                    onFocus={() => setFocused('userId')}
                    onBlur={() => setFocused(null)}
                    style={inputStyle('userId')}
                    autoFocus
                  />
                </div>
              </div>

              {/* Password */}
              <div style={s.field}>
                <label style={s.label}>Password</label>
                <div style={{ position: 'relative' }}>
                  <span style={s.fieldIcon}>🔑</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    style={{ ...inputStyle('password'), paddingRight: '44px' }}
                  />
                  <button type="button" onClick={() => setShowPassword(p => !p)} style={s.eyeBtn}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {/* Fixed-height slot — prevents layout shift when error appears */}
              <div style={{ minHeight: '64px' }}>
                {error && (
                  <div style={s.errorBox}>
                    <span style={s.errorIcon}>⚠️</span>
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <button type="submit" className="submit-btn" disabled={isLoading} style={s.submitBtn}>
                {isLoading
                  ? <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
                      <span style={s.spinner} /> Signing in…
                    </span>
                  : '→  Sign In'}
              </button>
            </form>

            <p style={s.formSub}>Demo accounts must be configured securely by the deployment owner.</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p style={s.footer}>© 2026 Unified Merchant Portal · BFSI Hackathon 2026</p>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    position: 'relative',
    overflow: 'hidden',
  },
  strip: {
    position: 'fixed', left: 0, top: 0, bottom: 0, width: '5px',
    background: 'linear-gradient(180deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
    zIndex: 10,
  },
  card: {
    display: 'flex',
    width: '100%',
    maxWidth: '960px',
    background: '#ffffff',
    borderRadius: '20px',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(99,102,241,0.12), 0 4px 16px rgba(0,0,0,0.06)',
    border: '1px solid #e2e8f0',
    animation: 'fadeUp 0.5s ease',
    minHeight: '540px',
  },
  leftPanel: {
    flex: '0 0 40%',
    background: 'linear-gradient(160deg, #6366f1 0%, #4f46e5 40%, #7c3aed 100%)',
    padding: '48px 36px',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  leftContent: {
    position: 'relative', zIndex: 1, color: '#fff',
  },
  bigIcon: {
    fontSize: '52px', marginBottom: '20px',
    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.2))',
  },
  portalName: {
    fontSize: '24px', fontWeight: 800, color: '#fff',
    margin: '0 0 10px', lineHeight: 1.2,
  },
  tagline: {
    fontSize: '15px', color: 'rgba(255,255,255,0.8)',
    margin: '0 0 32px', lineHeight: 1.7,
  },
  featureList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  featureItem: {
    display: 'flex', alignItems: 'center', gap: '12px',
    background: 'rgba(255,255,255,0.12)',
    borderRadius: '10px', padding: '11px 16px',
    backdropFilter: 'blur(4px)',
  },
  featureIcon: { fontSize: '22px' },
  featureText: { fontSize: '15px', color: 'rgba(255,255,255,0.95)', fontWeight: 500 },
  rightPanel: {
    flex: 1,
    padding: '48px 44px',
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
  },
  formWrap: { width: '100%' },
  formHeader: { marginBottom: '28px' },
  welcomeBadge: {
    display: 'inline-block',
    fontSize: '13px', fontWeight: 700,
    color: '#6366f1', background: '#ede9fe',
    borderRadius: '20px', padding: '4px 14px',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    marginBottom: '12px',
  },
  formTitle: {
    fontSize: '28px', fontWeight: 800, color: '#0f172a',
    margin: '0 0 6px',
  },
  formSub: { fontSize: '15px', color: '#64748b', margin: 0 },
  field: { marginBottom: '20px' },
  label: {
    display: 'block', fontSize: '13px', fontWeight: 700,
    color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em',
    marginBottom: '8px',
  },
  fieldIcon: {
    position: 'absolute', left: '13px', top: '50%',
    transform: 'translateY(-50%)', fontSize: '18px', pointerEvents: 'none',
    zIndex: 1,
  },
  eyeBtn: {
    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px',
    color: '#94a3b8', padding: '4px', lineHeight: 1,
  },
  errorBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: '#fff1f2', border: '1px solid #fecdd3',
    borderRadius: '8px', padding: '11px 16px',
    color: '#be123c', fontSize: '14px', marginBottom: '16px',
  },
  errorIcon: { fontSize: '18px', flexShrink: 0 },
  submitBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
    color: '#fff', border: 'none', borderRadius: '12px',
    fontSize: '16px', fontWeight: 700, padding: '14px',
    cursor: 'pointer', letterSpacing: '0.03em',
    boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
    transition: 'all 0.2s',
  },
  spinner: {
    display: 'inline-block', width: '15px', height: '15px',
    border: '2px solid rgba(255,255,255,0.35)',
    borderTop: '2px solid #fff', borderRadius: '50%',
    animation: 'loginSpin 0.7s linear infinite',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: '12px',
    margin: '22px 0 16px',
  },
  dividerText: {
    fontSize: '13px', fontWeight: 600, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '0.07em',
    whiteSpace: 'nowrap',
    padding: '0 4px',
    borderBottom: '1px solid #e2e8f0',
    width: '100%', textAlign: 'center',
  },
  demoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' },
  demoCard: {
    background: '#fafafa', border: '1.5px solid #e2e8f0',
    borderRadius: '12px', padding: '14px 16px',
    cursor: 'pointer', transition: 'all 0.2s',
  },
  demoRolePill: {
    display: 'inline-block', fontSize: '13px', fontWeight: 700,
    borderRadius: '20px', padding: '3px 12px', marginBottom: '8px',
  },
  demoCredLine: { marginBottom: '4px' },
  demoCode: {
    fontSize: '13px', color: '#334155', background: '#f1f5f9',
    borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace',
  },
  demoAccess: { fontSize: '13px', color: '#64748b', marginTop: '6px' },
  demoHint: {
    fontSize: '11px', color: '#cbd5e1', textAlign: 'center',
    margin: '10px 0 0',
  },
  footer: {
    marginTop: '20px', fontSize: '12px', color: '#cbd5e1', textAlign: 'center',
  },
};

