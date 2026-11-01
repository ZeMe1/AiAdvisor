import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';
import ConfirmModal from '../shared/ui/ConfirmModal.jsx';

export default function AdminPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuthStore();

  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'groups'

  // Users state
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Groups state
  const [groups, setGroups] = useState([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Create Group Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupProgram, setNewGroupProgram] = useState('Information Systems');
  const [newGroupYear, setNewGroupYear] = useState(1);
  const [newGroupAdvisor, setNewGroupAdvisor] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // CSV Import Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState('input'); // 'input' | 'preview'
  const [csvContent, setCsvContent] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  // Confirmation Modal state
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

  useEffect(() => {
    if (activeTab === 'groups') {
      loadGroups();
    }
  }, [activeTab]);

  async function loadUsers() {
    try {
      setLoadingUsers(true);
      const data = await api.adminGetUsers();
      setUsers(data);
    } catch (e) {
      toast.error('Failed to load users: ' + e.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadGroups() {
    try {
      setLoadingGroups(true);
      const data = await api.adminGetGroups();
      setGroups(data);
    } catch (e) {
      toast.error('Failed to load groups: ' + e.message);
    } finally {
      setLoadingGroups(false);
    }
  }

  // --- User management actions ---
  function handleRoleChange(username, newRole) {
    setModalConfig({
      isOpen: true,
      title: 'Change User Role',
      message: `Are you sure you want to change the role of user ${username} to ${newRole}?`,
      confirmText: 'Change Role',
      isDanger: false,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updated = await api.adminUpdateRole(username, newRole);
          setUsers((prev) => prev.map((u) => (u.username === username ? { ...u, role: updated.role } : u)));
          toast.success(`Role of ${username} changed to ${newRole}`);
        } catch (e) {
          toast.error(e.message);
        }
      },
    });
  }

  function handleBlockToggle(username, currentStatus) {
    const action = currentStatus ? 'unblock' : 'block';
    setModalConfig({
      isOpen: true,
      title: currentStatus ? 'Unblock User' : 'Block User',
      message: `Are you sure you want to ${action} user ${username}? All active sessions will be revoked.`,
      confirmText: currentStatus ? 'Unblock' : 'Block',
      isDanger: !currentStatus,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updated = await api.adminBlockUser(username, !currentStatus);
          setUsers((prev) => prev.map((u) => (u.username === username ? { ...u, is_blocked: updated.is_blocked } : u)));
          toast.success(`User ${username} successfully ${currentStatus ? 'unblocked' : 'blocked'}`);
        } catch (e) {
          toast.error(e.message);
        }
      },
    });
  }

  // --- Group & Advisor actions (US13) ---
  const advisorCandidates = useMemo(() => {
    // Users with Advisor or Administrator role, or other active staff
    return users.filter((u) => !u.is_blocked && (u.role === 'Advisor' || u.role === 'Administrator'));
  }, [users]);

  function handleAssignAdvisorPrompt(group, newAdvisorUsername) {
    const targetAdvisor = users.find((u) => u.username === newAdvisorUsername);
    const advisorLabel = targetAdvisor ? (targetAdvisor.display_name || targetAdvisor.username) : newAdvisorUsername || 'Unassigned';

    setModalConfig({
      isOpen: true,
      title: 'Assign Academic Advisor',
      message: newAdvisorUsername
        ? `Assign ${advisorLabel} (@${newAdvisorUsername}) as the advisor for group ${group.name}?`
        : `Remove assigned advisor from group ${group.name}?`,
      confirmText: 'Save Assignment',
      isDanger: false,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updated = await api.adminAssignAdvisor(group.id, newAdvisorUsername || null);
          setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, ...updated } : g)));
          toast.success(`Advisor updated for group ${group.name}`);
        } catch (e) {
          toast.error('Failed to assign advisor: ' + e.message);
        }
      },
    });
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) {
      toast.warn('Group name cannot be empty');
      return;
    }
    setCreatingGroup(true);
    try {
      const created = await api.adminCreateGroup({
        name: newGroupName.trim(),
        program: newGroupProgram.trim(),
        study_year: Number(newGroupYear),
        advisor_username: newGroupAdvisor || null,
      });
      toast.success(`Group ${created.name} successfully created!`);
      setShowCreateModal(false);
      setNewGroupName('');
      setNewGroupAdvisor('');
      loadGroups();
    } catch (e) {
      toast.error('Failed to create group: ' + e.message);
    } finally {
      setCreatingGroup(false);
    }
  }

  // CSV Import handlers
  function handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCsvContent(event.target.result || '');
    };
    reader.readAsText(file);
  }

  async function handlePreviewImport() {
    if (!csvContent.trim()) {
      toast.warn('Please paste or upload CSV content');
      return;
    }
    setImporting(true);
    try {
      const preview = await api.adminImportPreview(csvContent);
      setImportPreview(preview);
      setImportStep('preview');
    } catch (e) {
      toast.error('CSV Preview failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!importPreview || !importPreview.rows || importPreview.rows.length === 0) {
      toast.warn('No rows to import');
      return;
    }
    setImporting(true);
    try {
      const res = await api.adminImportGroups(importPreview.rows);
      toast.success(`Successfully imported ${res.groupsCount} groups and enrolled ${res.studentsEnrolled} students!`);
      setShowImportModal(false);
      setImportStep('input');
      setCsvContent('');
      setImportPreview(null);
      loadGroups();
    } catch (e) {
      toast.error('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  // Filtered lists
  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const lower = userSearch.toLowerCase();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(lower) ||
        (u.display_name && u.display_name.toLowerCase().includes(lower))
    );
  }, [users, userSearch]);

  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    const lower = groupSearch.toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(lower) ||
        g.program.toLowerCase().includes(lower) ||
        (g.advisor_username && g.advisor_username.toLowerCase().includes(lower)) ||
        (g.advisor_display_name && g.advisor_display_name.toLowerCase().includes(lower))
    );
  }, [groups, groupSearch]);

  if (profile && profile.role !== 'Administrator') {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 600, margin: '2rem auto', textAlign: 'center' }}>
          <h2>Access Restricted</h2>
          <p className="muted">You do not have administrator privileges to view this page.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Return to Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 1080, margin: '2rem auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn" onClick={() => navigate('/')}>← Back</button>
            <h2 style={{ margin: 0 }}>Administrator Control Panel</h2>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={activeTab === 'users' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('users')}
            >
              👥 Users Management
            </button>
            <button
              className={activeTab === 'groups' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('groups')}
            >
              🏫 Groups & Advisors
            </button>
          </div>
        </div>

        {/* ================= TAB 1: USERS MANAGEMENT ================= */}
        {activeTab === 'users' && (
          <div>
            <div style={{ marginBottom: '1.2rem' }}>
              <input
                placeholder="Search users by username or display name..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 400 }}
              />
            </div>

            {loadingUsers ? (
              <p className="muted">Loading user list...</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Display Name</th>
                      <th>Registration Date</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan="6" className="c muted">No users found</td>
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
                            {u.is_blocked ? 'Unblock' : 'Block'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: GROUPS & ADVISORS (US13) ================= */}
        {activeTab === 'groups' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <input
                placeholder="Search groups, programs, or advisors..."
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 360 }}
              />

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  + Create Group
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setImportStep('input');
                    setImportPreview(null);
                    setShowImportModal(true);
                  }}
                >
                  📥 Import from CSV
                </button>
              </div>
            </div>

            {loadingGroups ? (
              <p className="muted">Loading student groups...</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Group Name</th>
                      <th>Program</th>
                      <th>Study Year</th>
                      <th>Students</th>
                      <th>Assigned Academic Advisor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroups.length === 0 && (
                      <tr>
                        <td colSpan="5" className="c muted">No student groups found</td>
                      </tr>
                    )}
                    {filteredGroups.map((g) => (
                      <tr key={g.id}>
                        <td><b className="code">{g.name}</b></td>
                        <td>{g.program}</td>
                        <td>Year {g.study_year}</td>
                        <td>
                          <span
                            style={{
                              backgroundColor: '#eef2ff',
                              color: '#3730a3',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontSize: '12px',
                              fontWeight: 600,
                            }}
                          >
                            {g.member_count ?? 0} students
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <select
                              value={g.advisor_username || ''}
                              onChange={(e) => handleAssignAdvisorPrompt(g, e.target.value)}
                              style={{
                                padding: '4px 8px',
                                border: '1px solid #ccc',
                                borderRadius: 4,
                                fontSize: '13px',
                                minWidth: 200,
                              }}
                            >
                              <option value="">-- No Advisor Assigned --</option>
                              {advisorCandidates.map((adv) => (
                                <option key={adv.username} value={adv.username}>
                                  {adv.display_name ? `${adv.display_name} (@${adv.username})` : adv.username} ({adv.role})
                                </option>
                              ))}
                            </select>

                            {g.advisor_username && (
                              <span
                                style={{
                                  backgroundColor: '#e6f4ea',
                                  color: '#137333',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}
                              >
                                Assigned
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================= MODAL: CREATE GROUP ================= */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="card modal-card" style={{ maxWidth: 480, width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Create Student Group</h3>
            <form onSubmit={handleCreateGroup}>
              <div style={{ marginBottom: '1rem' }}>
                <label className="small muted">Group Name (e.g. CS-23-1, IS-22-2)</label>
                <input
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="CS-23-1"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="small muted">Study Program / Major</label>
                <input
                  required
                  value={newGroupProgram}
                  onChange={(e) => setNewGroupProgram(e.target.value)}
                  placeholder="Computer Science"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="small muted">Study Year</label>
                <select
                  value={newGroupYear}
                  onChange={(e) => setNewGroupYear(e.target.value)}
                  style={{ width: '100%', marginTop: '0.3rem', padding: '6px' }}
                >
                  <option value={1}>Year 1 (Freshman)</option>
                  <option value={2}>Year 2 (Sophomore)</option>
                  <option value={3}>Year 3 (Junior)</option>
                  <option value={4}>Year 4 (Senior)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label className="small muted">Assign Academic Advisor (Optional)</label>
                <select
                  value={newGroupAdvisor}
                  onChange={(e) => setNewGroupAdvisor(e.target.value)}
                  style={{ width: '100%', marginTop: '0.3rem', padding: '6px' }}
                >
                  <option value="">-- No Advisor Assigned --</option>
                  {advisorCandidates.map((adv) => (
                    <option key={adv.username} value={adv.username}>
                      {adv.display_name ? `${adv.display_name} (@${adv.username})` : adv.username} ({adv.role})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creatingGroup}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingGroup}
                >
                  {creatingGroup ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: CSV IMPORT WITH PREVIEW ================= */}
      {showImportModal && (
        <div className="modal-backdrop">
          <div className="card modal-card" style={{ maxWidth: 640, width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Import Groups & Students from CSV</h3>

            {importStep === 'input' && (
              <div>
                <p className="muted small" style={{ margin: '0 0 1rem 0' }}>
                  Upload a <code>.csv</code> file or paste rows below. Expected format:
                  <br />
                  <code>group_name,program,study_year,student_username</code>
                </p>

                <div style={{ marginBottom: '1rem' }}>
                  <input
                    type="file"
                    accept=".csv,text/plain"
                    ref={fileInputRef}
                    onChange={handleCsvFileSelect}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <textarea
                    rows={7}
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    placeholder={`group_name,program,study_year,student_username\nCS-23-1,Computer Science,2,210107001\nCS-23-1,Computer Science,2,210107002\nIS-22-2,Information Systems,3,200103045`}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    className="btn"
                    onClick={() => setShowImportModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={!csvContent.trim() || importing}
                    onClick={handlePreviewImport}
                  >
                    {importing ? 'Analyzing CSV...' : 'Preview Import →'}
                  </button>
                </div>
              </div>
            )}

            {importStep === 'preview' && importPreview && (
              <div>
                <div
                  style={{
                    backgroundColor: '#e6f4ea',
                    border: '1px solid #b7e1cd',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                  }}
                >
                  <b style={{ color: '#137333' }}>
                    CSV Preview Validated:
                  </b>{' '}
                  Found <b>{importPreview.groupsCount} distinct groups</b> and{' '}
                  <b>{importPreview.studentsCount} student enrollments</b> ({importPreview.totalRows} total records).
                </div>

                <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: '1rem', border: '1px solid #eee' }}>
                  <table className="tbl" style={{ margin: 0, fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Program</th>
                        <th>Year</th>
                        <th>Student Username</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.sampleRows.map((r, idx) => (
                        <tr key={idx}>
                          <td><b>{r.group_name}</b></td>
                          <td>{r.program}</td>
                          <td>{r.study_year}</td>
                          <td><span className="code">{r.student_username}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreview.totalRows > importPreview.sampleRows.length && (
                    <p className="muted small" style={{ textAlign: 'center', margin: '0.5rem' }}>
                      ... and {importPreview.totalRows - importPreview.sampleRows.length} more rows
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    className="btn"
                    onClick={() => setImportStep('input')}
                    disabled={importing}
                  >
                    ← Back to Edit
                  </button>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn"
                      onClick={() => setShowImportModal(false)}
                      disabled={importing}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleConfirmImport}
                      disabled={importing}
                    >
                      {importing ? 'Importing...' : 'Confirm & Import Students'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
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
