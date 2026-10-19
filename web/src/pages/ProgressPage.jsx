import React from 'react';
import { useNavigate } from 'react-router-dom';
import ProgressDashboard from '../components/ProgressDashboard.jsx';

export default function ProgressPage() {
  const navigate = useNavigate();

  return (
    <main className="page">
      <ProgressDashboard
        onBack={() => navigate('/')}
        onOpenTranscript={() => navigate('/transcript')}
      />
    </main>
  );
}

