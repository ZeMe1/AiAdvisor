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
      if (r.needs2fa) return; // переход на 2FA делает App
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
        <p className="auth-sub">Войдите с учётными данными портала my.sdu.edu.kz</p>
        <label>
          Логин
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {notice && <div className="banner-warn">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? 'Входим…' : 'Log in'}
        </button>
        <p className="auth-note">Пароль отправляется только в SDU и не сохраняется.</p>
      </form>
    </div>
  );
}
