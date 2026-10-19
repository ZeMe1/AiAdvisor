import React, { useState } from 'react';

export default function Login({ onLogin, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await onLogin(username, password);
      if (r?.status === '2fa_required' || r?.needs2fa) return;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">SDU · ZeMe</div>
        <h1>Student Information System</h1>
        <p className="auth-sub">Sign in with your my.sdu.edu.kz portal credentials</p>
        <label>
          Username / SDU Login
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {notice && <div className="banner-warn">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <p className="auth-note">Password is sent directly to SDU portal and is not stored insecurely.</p>
      </form>
    </div>
  );
}
