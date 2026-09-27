import React, { useState } from 'react';

export default function TwoFa({ onSubmit }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
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
        <h1>Двухфакторная аутентификация</h1>
        <p className="auth-sub">Введите 6-значный код, отправленный на вашу почту SDU</p>
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoFocus
        />
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy || code.length !== 6}>
          {busy ? 'Проверяем…' : 'Подтвердить'}
        </button>
      </form>
    </div>
  );
}
