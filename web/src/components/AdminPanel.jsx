import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';

export default function AdminPanel({ onBack }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await api.adminGetUsers();
      setUsers(data);
    } catch (e) {
      setError('Ошибка загрузки пользователей: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(username, newRole) {
    if (!confirm(`Изменить роль пользователя ${username} на ${newRole}?`)) return;
    try {
      const updated = await api.adminUpdateRole(username, newRole);
      setUsers(users.map((u) => u.username === username ? { ...u, role: updated.role } : u));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleBlockToggle(username, currentStatus) {
    const action = currentStatus ? 'разблокировать' : 'заблокировать';
    if (!confirm(`Вы уверены, что хотите ${action} пользователя ${username}?`)) return;
    try {
      const updated = await api.adminBlockUser(username, !currentStatus);
      setUsers(users.map((u) => u.username === username ? { ...u, is_blocked: updated.is_blocked } : u));
    } catch (e) {
      alert(e.message);
    }
  }

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const lower = search.toLowerCase();
    return users.filter(u => 
      u.username.toLowerCase().includes(lower) || 
      (u.display_name && u.display_name.toLowerCase().includes(lower))
    );
  }, [users, search]);

  return (
    <div className="card" style={{ maxWidth: 1000, margin: '2rem auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button className="btn" onClick={onBack}>← Назад</button>
        <h2 style={{ margin: 0 }}>Админ-панель (Пользователи)</h2>
      </div>

      {error && <div className="banner-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ marginBottom: '1rem' }}>
        <input 
          placeholder="Поиск по логину или имени..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 400 }}
        />
      </div>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th>Имя (Display Name)</th>
                <th>Дата регистрации</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr><td colSpan="6" className="c muted">Ничего не найдено</td></tr>
              )}
              {filteredUsers.map((u) => (
                <tr key={u.id} style={{ opacity: u.is_blocked ? 0.6 : 1 }}>
                  <td><b className="code">{u.username}</b></td>
                  <td>{u.display_name || <span className="muted">—</span>}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <select 
                      value={u.role} 
                      onChange={(e) => handleRoleChange(u.username, e.target.value)}
                      style={{ padding: '2px 4px', border: '1px solid #ccc', borderRadius: 4 }}
                    >
                      <option value="Student">Student</option>
                      <option value="Advisor">Advisor</option>
                      <option value="Administrator">Administrator</option>
                    </select>
                  </td>
                  <td>
                    {u.is_blocked 
                      ? <span style={{ color: '#c00', fontWeight: 'bold' }}>Blocked</span> 
                      : <span style={{ color: '#00773c' }}>Active</span>}
                  </td>
                  <td>
                    <button 
                      className={u.is_blocked ? "btn" : "btn btn-danger"} 
                      onClick={() => handleBlockToggle(u.username, u.is_blocked)}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                    >
                      {u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
