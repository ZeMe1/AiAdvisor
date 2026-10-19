import React from 'react';
import { useNavigate } from 'react-router-dom';
import Transcript from '../components/Transcript.jsx';
import { useAuthStore } from '../stores/authStore.js';

export default function TranscriptPage() {
  const navigate = useNavigate();
  const { profile } = useAuthStore();

  return (
    <main className="page">
      <Transcript
        onBack={() => navigate('/')}
        onOpenProgress={() => navigate('/progress')}
        profile={profile}
      />
    </main>
  );
}

