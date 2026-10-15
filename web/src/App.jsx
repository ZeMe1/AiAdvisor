import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore.js';
import { ToastProvider } from './shared/ui/Toast.jsx';
import Navbar from './shared/ui/Navbar.jsx';

import Login from './components/Login.jsx';
import TwoFa from './components/TwoFa.jsx';
import HomePage from './pages/HomePage.jsx';
import CoursePage from './pages/CoursePage.jsx';
import ElectivesPage from './pages/ElectivesPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  const { stage, loginNotice, error, setError, checkAuth, login, submit2fa } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (stage === 'boot') {
    return <div className="boot">Загрузка…</div>;
  }

  if (stage === 'login') {
    return <Login onLogin={login} notice={loginNotice} />;
  }

  if (stage === '2fa') {
    return <TwoFa onSubmit={submit2fa} />;
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="app">
          <Navbar />
          {error && (
            <div className="banner-error" onClick={() => setError(null)}>
              {error} ✕
            </div>
          )}
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/courses/:code" element={<CoursePage />} />
            <Route path="/electives/:code" element={<ElectivesPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ToastProvider>
  );
}
