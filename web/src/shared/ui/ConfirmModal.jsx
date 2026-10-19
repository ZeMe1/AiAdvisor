import React from 'react';

export default function ConfirmModal({
  isOpen,
  title = 'Подтверждение',
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  isDanger = false,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9998,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          margin: '16px',
          padding: '20px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>{title}</h3>
        <p style={{ margin: '0 0 20px 0', color: 'var(--muted)', fontSize: '13.5px', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={isDanger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
