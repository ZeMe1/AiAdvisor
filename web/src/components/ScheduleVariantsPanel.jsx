import React, { useState } from 'react';

export default function ScheduleVariantsPanel({
  variants = [],
  activeVariantId,
  onSelectVariant,
  onCreateVariant,
  onRenameVariant,
  onDeleteVariant,
  saving = false
}) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  function startEdit(v, e) {
    e?.stopPropagation();
    setEditingId(v.id);
    setEditName(v.name);
  }

  function saveEdit(v) {
    if (editName.trim() && editName.trim() !== v.name) {
      onRenameVariant(v.id, editName.trim());
    }
    setEditingId(null);
  }

  function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateVariant(newName.trim());
    setNewName('');
    setIsCreating(false);
  }

  return (
    <div className="schedule-variants-bar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      flexWrap: 'wrap',
      marginBottom: '1rem',
      padding: '0.4rem 0.6rem',
      background: 'rgba(241, 245, 249, 0.6)',
      borderRadius: '10px',
      border: '1px solid rgba(226, 232, 240, 0.8)'
    }}>
      <span className="small muted" style={{ fontWeight: 600, marginRight: '0.25rem' }}>
        Варианты:
      </span>

      {variants.map((v) => {
        const isActive = v.id === activeVariantId;
        const isEditing = editingId === v.id;

        return (
          <div
            key={v.id}
            onClick={() => !isEditing && onSelectVariant(v.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.3rem 0.75rem',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: isActive ? 600 : 500,
              cursor: isEditing ? 'default' : 'pointer',
              background: isActive ? '#0052cc' : '#fff',
              color: isActive ? '#fff' : '#334155',
              border: isActive ? '1px solid #0052cc' : '1px solid #cbd5e1',
              boxShadow: isActive ? '0 2px 6px rgba(0, 82, 204, 0.25)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {isEditing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => saveEdit(v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit(v);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                autoFocus
                maxLength={50}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: '0.85rem',
                  padding: '0.1rem 0.3rem',
                  borderRadius: '4px',
                  border: '1px solid #0052cc',
                  width: '90px',
                  color: '#1e293b'
                }}
              />
            ) : (
              <span onDoubleClick={(e) => startEdit(v, e)}>
                {v.name}
              </span>
            )}

            {!isEditing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <button
                  type="button"
                  title="Переименовать"
                  onClick={(e) => startEdit(v, e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: isActive ? 'rgba(255,255,255,0.8)' : '#94a3b8',
                    lineHeight: 1
                  }}
                >
                  ✎
                </button>
                {variants.length > 1 && (
                  <button
                    type="button"
                    title="Удалить вариант"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Удалить вариант "${v.name}"?`)) {
                        onDeleteVariant(v.id);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      color: isActive ? 'rgba(255,255,255,0.8)' : '#94a3b8',
                      lineHeight: 1
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {isCreating ? (
        <form onSubmit={handleCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название..."
            autoFocus
            maxLength={50}
            style={{
              fontSize: '0.85rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '20px',
              border: '1px solid #0052cc',
              width: '110px'
            }}
          />
          <button type="submit" className="btn btn-mini btn-primary">✓</button>
          <button
            type="button"
            className="btn btn-mini btn-ghost"
            onClick={() => setIsCreating(false)}
          >
            ✕
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="btn btn-ghost"
          style={{
            fontSize: '0.8rem',
            padding: '0.25rem 0.6rem',
            borderRadius: '20px',
            border: '1px dashed #94a3b8',
            color: '#475569'
          }}
        >
          + Новый вариант
        </button>
      )}

      {saving && (
        <span className="small muted" style={{ marginLeft: 'auto', fontStyle: 'italic', fontSize: '0.75rem' }}>
          Сохранение…
        </span>
      )}
    </div>
  );
}
