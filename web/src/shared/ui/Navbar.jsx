import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore.js';

export default function Navbar() {
  const navigate = useNavigate();
  const { me, profile, logout } = useAuthStore();

  const handleSignOut = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="topbar">
      <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="brand">
          ZeMe <span className="brand-sub">· SDU schedule planner</span>
        </span>
      </Link>

      <span className="topbar-info">
        {me?.term && <b>{me.term}</b>}
        {me?.user?.name && <span>{me.user.name} · {me.user.program}</span>}
        {me?.demo && <span className="demo-badge">demo data</span>}
      </span>

      <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {profile?.role === 'Administrator' && (
          <button className="btn" onClick={() => navigate('/admin')}>
            Admin Panel
          </button>
        )}

        {profile && (
          <div
            className="profile-btn"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            onClick={() => navigate('/profile')}
          >
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: '#0052cc',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                {(profile.display_name || profile.username || '?')[0].toUpperCase()}
              </div>
            )}
            <span>{profile.display_name || profile.username}</span>
          </div>
        )}

        <button className="btn btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
