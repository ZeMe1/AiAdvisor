import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function ProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile, updateProfile } = useAuthStore();

  const [name, setName] = useState(profile?.display_name || '');
  const [avatar, setAvatar] = useState(profile?.avatar_url || '');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Пожалуйста, выберите изображение');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Размер файла не должен превышать 5 MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 250;
        const MAX_HEIGHT = 250;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Сжатие до гарантированно легкого Data URL (~30-60 КБ)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        setAvatar(dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateProfile({ display_name: name, avatar_url: avatar });
      toast.success('Профиль успешно обновлен!');
    } catch (e) {
      toast.error('Ошибка сохранения профиля: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 640, margin: '2rem auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <button className="btn" onClick={() => navigate('/')}>← Назад</button>
          <h2 style={{ margin: 0 }}>Мой профиль</h2>
        </div>

        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {/* Аватар */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                backgroundColor: '#eee',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                border: '2px solid #ddd',
              }}
            >
              {avatar ? (
                <img src={avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: '3rem', color: '#999' }}>
                  {(name || profile?.username || '?')[0].toUpperCase()}
                </span>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                Загрузить фото
              </button>
              {avatar && (
                <button className="btn btn-danger" onClick={() => setAvatar('')}>
                  Удалить фото
                </button>
              )}
            </div>
          </div>

          {/* Данные */}
          <div style={{ flex: 1, minWidth: 250 }}>
            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">SDU Login (username)</label>
              <input value={profile?.username || ''} disabled style={{ width: '100%', marginTop: '0.5rem' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">Роль</label>
              <input value={profile?.role || 'Student'} disabled style={{ width: '100%', marginTop: '0.5rem' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">Отображаемое имя</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Введите ваше имя"
                style={{ width: '100%', marginTop: '0.5rem' }}
              />
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={handleSave}>
                {busy ? 'Сохранение...' : 'Сохранить изменения'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
