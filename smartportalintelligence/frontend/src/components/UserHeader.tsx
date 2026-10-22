import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Persistent top bar shown on every authenticated page.
 * Displays: portal name · current page breadcrumb · user info · logout
 */
export const UserHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const PAGE_LABELS: Record<string, string> = {
    '/':            'Dashboard',
    '/application/new': 'New Application',
    '/review':      'Review Console',
    '/telemetry':   'AI Cost & Telemetry',
  };
  const label =
    PAGE_LABELS[location.pathname] ??
    (location.pathname.includes('/intelligence') ? 'Document Intelligence' :
     location.pathname.includes('/documents')    ? 'Upload Documents' :
     location.pathname.includes('/status')       ? 'Application Status' : '');

  const roleColor =
    user.role === 'ADMIN'       ? 'linear-gradient(135deg, #1d4ed8, #3b82f6)' :
    user.role === 'APP_MANAGER' ? 'linear-gradient(135deg, #0369a1, #0ea5e9)' : 'linear-gradient(135deg, #047857, #10b981)';
  const roleLabel =
    user.role === 'ADMIN'       ? '🛡️ Admin' :
    user.role === 'APP_MANAGER' ? '📊 App Manager' : '👤 User';

  // Quick nav links per role
  const navLinks: Array<{ label: string; path: string }> =
    user.role === 'ADMIN'
      ? [{ label: 'Dashboard', path: '/' }, { label: 'Review', path: '/review' }, { label: 'Telemetry', path: '/telemetry' }]
      : user.role === 'APP_MANAGER'
      ? [{ label: 'AI Cost', path: '/telemetry' }]
      : [];

  return (
    <div style={s.bar}>
      {/* Left — portal brand + breadcrumb */}
      <div style={s.left}>
        <span style={s.brandIcon}>🏦</span>
        <span style={s.brand}>Unified Merchant Portal</span>
        {label && (
          <>
            <span style={s.sep}>›</span>
            <span style={s.page}>{label}</span>
          </>
        )}
      </div>

      {/* Centre — role-based nav shortcuts */}
      {navLinks.length > 0 && (
        <div style={s.nav}>
          {navLinks.map(link => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              style={{
                ...s.navBtn,
                background: location.pathname === link.path ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: location.pathname === link.path ? '#ffffff' : '#bfdbfe',
              }}
            >
              {link.label}
            </button>
          ))}
        </div>
      )}

      {/* Right — user pill + logout */}
      <div style={s.right}>
        <div style={s.userPill}>
          <span style={{ ...s.roleBadge, background: roleColor }}>{roleLabel}</span>
          <span style={s.userId}>{user.userId}</span>
        </div>
        <button onClick={handleLogout} style={s.logoutBtn} title="Sign out">
          ⏻ Logout
        </button>
      </div>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    height: '70px',
    background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
    borderBottom: '1px solid rgba(96,165,250,0.25)',
    backdropFilter: 'blur(12px)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 2px 16px rgba(30,58,138,0.4)',
    flexShrink: 0,
  },
  left: {
    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
  },
  nav: {
    display: 'flex', alignItems: 'center', gap: '4px',
    position: 'absolute' as const, left: '50%', transform: 'translateX(-50%)',
  },
  navBtn: {
    border: 'none', cursor: 'pointer', padding: '7px 16px',
    borderRadius: '8px', fontSize: '14px', fontWeight: 600,
    transition: 'background 0.15s, color 0.15s', whiteSpace: 'nowrap' as const,
  },
  brandIcon: { fontSize: '28px' },
  brand: {
    fontSize: '18px', fontWeight: 700, color: '#bfdbfe',
    letterSpacing: '0.01em', whiteSpace: 'nowrap',
  },
  sep: { color: '#60a5fa', fontSize: '20px' },
  page: {
    fontSize: '15px', color: '#93c5fd', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  right: {
    display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
  },
  userPill: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '20px',
    padding: '4px 14px 4px 4px',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  roleBadge: {
    fontSize: '13px', fontWeight: 700, color: '#fff',
    borderRadius: '12px', padding: '4px 12px',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    letterSpacing: '0.02em',
  },
  userId: {
    fontSize: '14px', fontWeight: 700, color: '#ffffff',
    fontFamily: 'monospace',
    letterSpacing: '0.03em',
  },
  userName: {
    fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap',
  },
  logoutBtn: {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.28)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    padding: '8px 18px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.2s, border-color 0.2s',
    backdropFilter: 'blur(8px)',
    letterSpacing: '0.02em',
  },
};
