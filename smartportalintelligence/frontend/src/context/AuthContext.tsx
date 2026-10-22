import React, { createContext, useContext, useState, useCallback } from 'react';
import { auth } from '../api/client';

export type UserRole = 'ADMIN' | 'USER' | 'APP_MANAGER';

export interface AuthUser {
  userId: string;
  name: string;
  role: UserRole;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (userId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = sessionStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback(async (userId: string, password: string) => {
    try {
      const { token, user: apiUser } = await auth.login(userId, password);

      const authUser: AuthUser = {
        userId: apiUser.userId,
        name:   apiUser.name,
        role:   apiUser.role,
        email:  apiUser.email,
      };

      sessionStorage.setItem('auth_user', JSON.stringify(authUser));
      sessionStorage.setItem('auth_token', token);
      setUser(authUser);
      return { success: true };
    } catch (err: any) {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        'Login failed. Please check your credentials.';
      return { success: false, error: message };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('auth_user');
    sessionStorage.removeItem('auth_token');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
