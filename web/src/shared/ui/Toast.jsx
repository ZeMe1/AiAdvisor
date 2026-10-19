import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    setToasts((prev) => {
      // Защита от спама одинаковыми сообщениями
      if (prev.some((t) => t.message === message)) return prev;

      const id = Date.now() + Math.random().toString(36).substring(2, 6);
      if (duration > 0) {
        setTimeout(() => {
          setToasts((current) => current.filter((t) => t.id !== id));
        }, duration);
      }
      return [...prev, { id, message, type }];
    });
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useMemo(
    () => ({
      info: (msg, dur) => addToast(msg, 'info', dur),
      success: (msg, dur) => addToast(msg, 'success', dur),
      warn: (msg, dur) => addToast(msg, 'warn', dur),
      error: (msg, dur) => addToast(msg, 'error', dur),
    }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="toast-container"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '380px',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              animation: 'fadeIn 0.2s ease-in-out',
              backgroundColor:
                t.type === 'error'
                  ? '#c0392b'
                  : t.type === 'success'
                    ? '#27ae60'
                    : t.type === 'warn'
                      ? '#d35400'
                      : '#2980b9',
              color: '#ffffff',
            }}
          >
            <span>{t.message}</span>
            <span style={{ opacity: 0.7, fontSize: '11px' }}>✕</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
