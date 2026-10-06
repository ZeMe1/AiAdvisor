import React, { useState } from 'react';
import { api } from '../api.js';

export default function SduReconnectModal({ username, isOpen, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needs2fa) {
        await api.sduReconnect2fa(twoFaCode);
        onSuccess?.();
        onClose();
      } else {
        const res = await api.sduReconnect(password);
        if (res.status === '2fa_required') {
          setNeeds2fa(true);
        } else {
          onSuccess?.();
          onClose();
        }
      }
    } catch (err) {
      setError(err.message || 'Ошибка обновления сессии SDU');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '1rem'
    }}>
      <div className="card modal-card" style={{
        maxWidth: '440px', width: '100%', padding: '1.75rem',
        background: '#fff', borderRadius: '14px',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {needs2fa ? 'Подтверждение 2FA SDU' : 'Подключение к SDU'}
          </h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            style={{ fontSize: '1.2rem', padding: '0.2rem 0.5rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <p className="muted small" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
          {needs2fa
            ? 'Портал SDU запросил код двухфакторной аутентификации. Введите полученный код:'
            : 'Сессия связи с порталом my.sdu.edu.kz истекла. Введите пароль для загрузки актуальных секций и квот:'}
        </p>

        {error && (
          <div className="banner error-banner" style={{ marginBottom: '1rem', padding: '0.75rem', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {!needs2fa ? (
            <>
              {username && (
                <div style={{ marginBottom: '0.85rem' }}>
                  <label className="small muted" style={{ display: 'block', marginBottom: '0.35rem' }}>Студенческий ID</label>
                  <input
                    type="text"
                    value={username}
                    disabled
                    style={{ width: '100%', opacity: 0.75, cursor: 'not-allowed' }}
                  />
                </div>
              )}

              <div style={{ marginBottom: '1.25rem' }}>
                <label className="small muted" style={{ display: 'block', marginBottom: '0.35rem' }}>Пароль от портала SDU</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль..."
                  autoFocus
                  required
                  style={{ width: '100%' }}
                />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '1.25rem' }}>
              <label className="small muted" style={{ display: 'block', marginBottom: '0.35rem' }}>Код из СМС / Telegram</label>
              <input
                type="text"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value)}
                placeholder="000000"
                autoFocus
                required
                style={{ width: '100%', letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || (!needs2fa && !password) || (needs2fa && !twoFaCode)}
            >
              {busy ? 'Подключение…' : needs2fa ? 'Подтвердить' : 'Подключить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
