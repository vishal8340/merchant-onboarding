import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';
import { UserHeader } from '../components/UserHeader';

interface Props {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

/**
 * Wraps a page: redirects to /login if unauthenticated,
 * shows 403 if role not permitted, otherwise renders page with UserHeader.
 */
export const ProtectedRoute: React.FC<Props> = ({ children, allowedRoles }) => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return (
      <div style={s.page}>
        <UserHeader />
        <div style={s.center}>
          <div style={s.icon}>🚫</div>
          <h2 style={s.title}>Access Denied</h2>
          <p style={s.msg}>
            Your role <strong>{user.role}</strong> does not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <UserHeader />
      <div style={s.content}>{children}</div>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex', flexDirection: 'column', minHeight: '100vh',
    background: 'transparent',
  },
  content: {
    flex: 1, display: 'flex', flexDirection: 'column',
  },
  page: {
    display: 'flex', flexDirection: 'column', minHeight: '100vh',
    background: '#0f172a',
  },
  center: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  icon: { fontSize: '56px', marginBottom: '16px' },
  title: { fontSize: '24px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px' },
  msg:   { fontSize: '14px', color: '#64748b', textAlign: 'center', maxWidth: '360px' },
};
