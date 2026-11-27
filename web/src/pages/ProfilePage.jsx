import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';
import MyAdvisorCard from '../components/MyAdvisorCard.jsx';

export default function ProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile, updateProfile } = useAuthStore();

  const [name, setName] = useState(profile?.display_name || '');
  const [avatar, setAvatar] = useState(profile?.avatar_url || '');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  // US30: Advisor Office Hours & Availability
  const isAdvisor = profile?.role === 'Advisor';
  const [officeHours, setOfficeHours] = useState('');
  const [responseTimeNote, setResponseTimeNote] = useState('');
  const [savingAvailability, setSavingAvailability] = useState(false);

  useEffect(() => {
    if (!isAdvisor) return;
    let mounted = true;
    api.getMyPresence()
      .then((res) => {
        if (!mounted || !res) return;
        setOfficeHours(res.officeHours || '');
        setResponseTimeNote(res.responseTimeNote || '');
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isAdvisor]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size cannot exceed 5 MB');
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
      toast.success('Profile successfully updated!');
    } catch (e) {
      toast.error('Failed to save profile: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAvailability = async (e) => {
    if (e) e.preventDefault();
    setSavingAvailability(true);
    try {
      const updated = await api.updateOfficeHours({
        office_hours: officeHours,
        response_time_note: responseTimeNote,
      });
      setOfficeHours(updated.officeHours || '');
      setResponseTimeNote(updated.responseTimeNote || '');
      toast.success('Office hours and availability saved!');
    } catch (err) {
      toast.error('Failed to update availability: ' + err.message);
    } finally {
      setSavingAvailability(false);
    }
  };

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 680, margin: '2rem auto', padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn" onClick={() => navigate('/')}>← Back</button>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#002B49' }}>My Profile</h2>
          </div>
          {isAdvisor && (
            <button className="btn btn-primary" onClick={() => navigate('/messages')}>
              Open Advisor Inbox →
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
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
                Upload photo
              </button>
              {avatar && (
                <button className="btn btn-danger" onClick={() => setAvatar('')}>
                  Delete photo
                </button>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 250 }}>
            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">SDU Login (username)</label>
              <input value={profile?.username || ''} disabled style={{ width: '100%', marginTop: '0.5rem' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">Role</label>
              <input value={profile?.role || 'Student'} disabled style={{ width: '100%', marginTop: '0.5rem' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">Display Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                style={{ width: '100%', marginTop: '0.5rem' }}
              />
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={handleSave}>
                {busy ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>

        {isAdvisor ? (
          <form
            onSubmit={handleSaveAvailability}
            style={{
              marginTop: '1.75rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid #D8E4F0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '15px', color: '#002B49' }}>
                🕒 Advisor Office Hours & Availability
              </h3>
              <span
                style={{
                  backgroundColor: '#E6F6EE',
                  color: '#0B6B3A',
                  border: '1px solid #B7E4CC',
                  borderRadius: '999px',
                  padding: '2px 9px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                }}
              >
                Visible to your assigned groups
              </span>
            </div>
            <p className="muted small" style={{ marginTop: 0, marginBottom: '1rem' }}>
              Set your consultation schedule and typical reply window so students know when to expect an answer.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted" style={{ fontWeight: 600, color: '#334155' }}>
                Office Hours
              </label>
              <input
                value={officeHours}
                onChange={(e) => setOfficeHours(e.target.value)}
                maxLength={200}
                placeholder="e.g. Mon, Wed 14:00-16:00 (Room F-302)"
                style={{ width: '100%', marginTop: '0.4rem' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label className="small muted" style={{ fontWeight: 600, color: '#334155' }}>
                Typical Answer Time
              </label>
              <input
                value={responseTimeNote}
                onChange={(e) => setResponseTimeNote(e.target.value)}
                maxLength={255}
                placeholder="e.g. Usually replies within 2 hours on weekdays"
                style={{ width: '100%', marginTop: '0.4rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={savingAvailability}>
                {savingAvailability ? 'Saving...' : 'Save Availability'}
              </button>
            </div>
          </form>
        ) : (
          profile?.role !== 'Administrator' && <MyAdvisorCard />
        )}
      </div>
    </main>
  );
}
