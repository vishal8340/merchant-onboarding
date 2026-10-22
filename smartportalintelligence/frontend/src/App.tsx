import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { ApplicationForm } from './components/ApplicationForm';
import { DocumentUpload } from './components/DocumentUpload';
import { ApplicationStatus } from './components/ApplicationStatus';
import { ReviewConsole } from './components/ReviewConsole';
import { TestPage } from './components/TestPage';
import { DocumentIntelligence } from './components/DocumentIntelligence';
import { TelemetryDashboard } from './components/TelemetryDashboard';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginScreen />} />

          {/* Admin-only */}
          <Route path="/" element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/review" element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <ReviewConsole />
            </ProtectedRoute>
          } />

          {/* Application Manager — AI cost & telemetry */}
          <Route path="/telemetry" element={
            <ProtectedRoute allowedRoles={['APP_MANAGER', 'ADMIN']}>
              <TelemetryDashboard />
            </ProtectedRoute>
          } />

          {/* User (merchant) */}
          <Route path="/application/new" element={
            <ProtectedRoute allowedRoles={['USER', 'ADMIN']}>
              <ApplicationForm />
            </ProtectedRoute>
          } />
          <Route path="/application/:id/documents" element={
            <ProtectedRoute allowedRoles={['USER', 'ADMIN']}>
              <DocumentUpload />
            </ProtectedRoute>
          } />
          <Route path="/application/:id/intelligence" element={
            <ProtectedRoute allowedRoles={['USER', 'ADMIN']}>
              <DocumentIntelligence />
            </ProtectedRoute>
          } />
          <Route path="/application/:id/status" element={
            <ProtectedRoute allowedRoles={['USER', 'ADMIN']}>
              <ApplicationStatus />
            </ProtectedRoute>
          } />

          {/* Dev */}
          <Route path="/test" element={<TestPage />} />

          {/* Catch-all → login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
