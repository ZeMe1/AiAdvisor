import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';
import ConfirmModal from '../shared/ui/ConfirmModal.jsx';

export default function AdminPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuthStore();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Состояние модального окна подтверждения
  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDanger: false,
    onConfirm: () => {},
  });

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await api.adminGetUsers();
      setUsers(data);
    } catch (e) {
      toast.error('Ошибка загрузки пользователей: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleRoleChange(username, newRole) {
    setModalConfig({
      isOpen: true,
      title: 'Смена роли пользователя',
      message: `Вы уверены, что хотите изменить роль пользователя ${username} на ${newRole}?`,
      confirmText: 'Изменить роль',
      isDanger: false,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updated = await api.adminUpdateRole(username, newRole);
          setUsers((prev) => prev.map((u) => (u.username === username ? { ...u, role: updated.role } : u)));
          toast.success(`Роль пользователя ${username} изменена на ${newRole}`);
        } catch (e) {
          toast.error(e.message);
        }
      },
    });
  }

  function handleBlockToggle(username, currentStatus) {
    const action = currentStatus ? 'разблокировать' : 'заблокировать';
    setModalConfig({
      isOpen: true,
      title: currentStatus ? 'Разблокировка пользователя' : 'Блокировка пользователя',
      message: `Вы уверены, что хотите ${action} пользователя ${username}? При блокировке все его активные сессии будут немедленно отозваны.`,
      confirmText: currentStatus ? 'Разблокировать' : 'Заблокировать',
      isDanger: !currentStatus,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updated = await api.adminBlockUser(username, !currentStatus);
          setUsers((prev) => prev.map((u) => (u.username === username ? { ...u, is_blocked: updated.is_blocked } : u)));
          toast.success(`Пользователь ${username} успешно ${currentStatus ? 'разблокирован' : 'заблокирован'}`);
        } catch (e) {
          toast.error(e.message);
        }
      },
    });
  }

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const lower = search.toLowerCase();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(lower) ||
        (u.display_name && u.display_name.toLowerCase().includes(lower))
    );
  }, [users, search]);

  if (profile && profile.role !== 'Administrator') {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 600, margin: '2rem auto', textAlign: 'center' }}>
          <h2>Доступ ограничен</h2>
          <p className="muted">У вас нет прав администратора для просмотра этой страницы.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Вернуться на главную
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 1040, margin: '2rem auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button className="btn" onClick={() => navigate('/')}>← Назад</button>
          <h2 style={{ margin: 0 }}>Админ-панель (Управление пользователями)</h2>
        </div>

        <div style={{ marginBottom: '1.2rem' }}>
          <input
            placeholder="Поиск по логину или имени..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', maxWidth: 400 }}
          />
        </div>

        {loading ? (
          <p className="muted">Загрузка списка пользователей...</p>
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
                  <tr>
                    <td colSpan="6" className="c muted">Ничего не найдено</td>
                  </tr>
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
                        style={{ padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
                      >
                        <option value="Student">Student</option>
                        <option value="Advisor">Advisor</option>
                        <option value="Administrator">Administrator</option>
                      </select>
                    </td>
                    <td>
                      {u.is_blocked ? (
                        <span style={{ color: '#c00', fontWeight: 'bold' }}>Blocked</span>
                      ) : (
                        <span style={{ color: '#00773c' }}>Active</span>
                      )}
                    </td>
                    <td>
                      <button
                        className={u.is_blocked ? 'btn' : 'btn btn-danger'}
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

      <ConfirmModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        isDanger={modalConfig.isDanger}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </main>
  );
}
