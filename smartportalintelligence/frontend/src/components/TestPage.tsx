import React from 'react';

export const TestPage: React.FC = () => {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white'
    }}>
      <div style={{
        background: 'white',
        color: '#1f2937',
        padding: '60px',
        borderRadius: '20px',
        textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <h1 style={{ fontSize: '48px', marginBottom: '20px' }}>✅ Test Page Works!</h1>
        <p style={{ fontSize: '18px', color: '#6b7280' }}>
          If you can see this with purple background and styling, React Router is working.
        </p>
      </div>
    </div>
  );
};