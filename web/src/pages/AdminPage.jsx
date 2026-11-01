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

  // Manage Students Modal state
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [studentInput, setStudentInput] = useState('');
  const [enrollError, setEnrollError] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  // Curriculums state (US14)
  const [curriculums, setCurriculums] = useState([]);
  const [loadingCurriculums, setLoadingCurriculums] = useState(false);
  const [curriculumSearch, setCurriculumSearch] = useState('');

  // Import Curriculum Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importProgram, setImportProgram] = useState('Information Systems');
  const [importYear, setImportYear] = useState(new Date().getFullYear());
  const [importTitle, setImportTitle] = useState('Information Systems 2026');
  const [importFileBase64, setImportFileBase64] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importError, setImportError] = useState('');
  const [savingCurriculum, setSavingCurriculum] = useState(false);

  // View Curriculum Modal state
  const [viewCurriculum, setViewCurriculum] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

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
    } else if (activeTab === 'curriculums') {
      loadCurriculums();
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
  // ONLY users with role 'Advisor' (not Administrator, not Student)
  const advisorCandidates = useMemo(() => {
    return users.filter((u) => !u.is_blocked && u.role === 'Advisor');
  }, [users]);

  // Registered students for suggestions
  const studentCandidates = useMemo(() => {
    return users.filter((u) => !u.is_blocked && u.role === 'Student');
  }, [users]);

  function handleAssignAdvisorPrompt(group, newAdvisorUsername) {
    const targetAdvisor = users.find((u) => u.username === newAdvisorUsername);
    const advisorLabel = targetAdvisor ? (targetAdvisor.display_name || targetAdvisor.username) : newAdvisorUsername || 'Unassigned';

    setModalConfig({
      isOpen: true,
      title: 'Assign Academic Advisor',
      message: newAdvisorUsername
        ? `Assign advisor ${advisorLabel} to group ${group.name}?`
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

  // --- Students Management in Group ---
  async function openStudentsModal(group) {
    setSelectedGroup(group);
    setStudentInput('');
    setEnrollError('');
    setLoadingMembers(true);
    try {
      const members = await api.adminGetGroupMembers(group.id);
      setGroupMembers(members);
    } catch (e) {
      toast.error('Failed to load group members: ' + e.message);
      setGroupMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }

  async function handleEnrollStudent(e) {
    e.preventDefault();
    const username = studentInput.trim();
    if (!username || !selectedGroup) return;

    setEnrolling(true);
    setEnrollError('');
    try {
      const updatedMembers = await api.adminEnrollStudent(selectedGroup.id, username);
      setGroupMembers(updatedMembers);
      setStudentInput('');
      setGroups((prev) =>
        prev.map((g) => (g.id === selectedGroup.id ? { ...g, member_count: updatedMembers.length } : g))
      );
      toast.success(`Student ${username} added to group ${selectedGroup.name}`);
    } catch (e) {
      setEnrollError(e.message);
      toast.error('Failed to add student: ' + e.message);
    } finally {
      setEnrolling(false);
    }
  }

  function handleRemoveStudentPrompt(username) {
    if (!selectedGroup) return;
    setModalConfig({
      isOpen: true,
      title: 'Remove Student from Group',
      message: `Are you sure you want to remove student ${username} from group ${selectedGroup.name}?`,
      confirmText: 'Remove Student',
      isDanger: true,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const updatedMembers = await api.adminRemoveStudent(selectedGroup.id, username);
          setGroupMembers(updatedMembers);
          setGroups((prev) =>
            prev.map((g) => (g.id === selectedGroup.id ? { ...g, member_count: updatedMembers.length } : g))
          );
          toast.success(`Student ${username} removed from group ${selectedGroup.name}`);
        } catch (e) {
          toast.error('Failed to remove student: ' + e.message);
        }
      },
    });
  }

  // --- US14 Curriculums Handlers ---
  async function loadCurriculums() {
    try {
      setLoadingCurriculums(true);
      const data = await api.adminGetCurriculums();
      setCurriculums(data);
    } catch (e) {
      toast.error('Failed to load curriculums: ' + e.message);
    } finally {
      setLoadingCurriculums(false);
    }
  }

  function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportError('');
    setLoadingPreview(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const base64 = event.target.result;
        setImportFileBase64(base64);

        const preview = await api.adminPreviewCurriculum({ fileBase64: base64, fileName: file.name });
        setPreviewData(preview);
      } catch (err) {
        setImportError(err.message);
        setPreviewData(null);
        toast.error('Failed to parse curriculum file: ' + err.message);
      } finally {
        setLoadingPreview(false);
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file');
      setLoadingPreview(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveCurriculum(isPublished) {
    if (!importProgram.trim()) {
      toast.error('Program name is required');
      return;
    }
    if (!importFileBase64) {
      toast.error('Please upload an XLSX or CSV curriculum file');
      return;
    }
    if (isPublished && previewData && !previewData.is_valid) {
      toast.error('Cannot publish curriculum with unmapped course codes');
      return;
    }

    setSavingCurriculum(true);
    setImportError('');
    try {
      await api.adminImportCurriculum({
        program: importProgram.trim(),
        academic_year: Number(importYear) || new Date().getFullYear(),
        version_title: importTitle.trim() || `${importProgram.trim()} ${importYear}`,
        is_published: isPublished,
        fileBase64: importFileBase64,
        fileName: importFileName,
      });

      toast.success(isPublished ? 'Curriculum imported and published!' : 'Curriculum saved as draft!');
      setShowImportModal(false);
      setPreviewData(null);
      setImportFileBase64('');
      setImportFileName('');
      loadCurriculums();
    } catch (e) {
      setImportError(e.message);
      toast.error('Failed to import curriculum: ' + e.message);
    } finally {
      setSavingCurriculum(false);
    }
  }

  function handleTogglePublishPrompt(curr) {
    const willPublish = !curr.is_published;
    setModalConfig({
      isOpen: true,
      title: willPublish ? 'Publish Curriculum' : 'Unpublish Curriculum',
      message: willPublish
        ? `Are you sure you want to publish "${curr.version_title}"? Students in ${curr.program} will immediately see this updated roadmap.`
        : `Are you sure you want to unpublish "${curr.version_title}"?`,
      confirmText: willPublish ? 'Publish' : 'Unpublish',
      isDanger: !willPublish,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          await api.adminSetCurriculumPublished(curr.id, willPublish);
          toast.success(`Curriculum "${curr.version_title}" ${willPublish ? 'published' : 'unpublished'}`);
          loadCurriculums();
        } catch (e) {
          toast.error('Action failed: ' + e.message);
        }
      },
    });
  }

  function handleDeleteCurriculumPrompt(curr) {
    setModalConfig({
      isOpen: true,
      title: 'Delete Curriculum',
      message: `Are you sure you want to delete curriculum "${curr.version_title}"? This cannot be undone.`,
      confirmText: 'Delete Curriculum',
      isDanger: true,
      onConfirm: async () => {
        setModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          await api.adminDeleteCurriculum(curr.id);
          toast.success(`Curriculum "${curr.version_title}" deleted`);
          setCurriculums((prev) => prev.filter((c) => c.id !== curr.id));
        } catch (e) {
          toast.error('Failed to delete curriculum: ' + e.message);
        }
      },
    });
  }

  async function handleViewCurriculumDetails(curr) {
    setLoadingDetails(true);
    setViewCurriculum(curr);
    try {
      const details = await api.adminGetCurriculumDetails(curr.id);
      setViewCurriculum(details);
    } catch (e) {
      toast.error('Failed to load curriculum details: ' + e.message);
    } finally {
      setLoadingDetails(false);
    }
  }

  function handleDownloadTemplate() {
    const sampleCsv = `Semester,Course Code,Course Name,ECTS,Type
1,CSS 105,Fundamentals of Programming,5,Mandatory
1,MAT 137,Mathematics 1,5,Mandatory
1,MDE 162,Academic English 1,3,Mandatory
2,CSS 108,Programming Technologies,5,Mandatory
2,MAT 138,Mathematics 2,5,Mandatory
2,MDE 171,Academic English 2,3,Mandatory
3,CSS 215,Data Structures & Algorithms,5,Mandatory
3,CSS 216,Mobile Application Development,5,Mandatory
4,CSS 305,Database Systems,5,Mandatory
4,INF 318,Computer Networks,5,Mandatory
5,INF 376,Information Security,5,Mandatory
5,CSS 311,Operating Systems,5,Mandatory
6,CSS 320,Software Engineering,5,Mandatory
6,INF 451,Cloud Computing & DevOps,5,Mandatory
7,CSS 405,Artificial Intelligence,5,Major Elective
8,HIST 101,History of Kazakhstan,5,General Elective
`;
    const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'curriculum_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  const filteredCurriculums = useMemo(() => {
    if (!curriculumSearch.trim()) return curriculums;
    const lower = curriculumSearch.toLowerCase();
    return curriculums.filter(
      (c) =>
        c.program.toLowerCase().includes(lower) ||
        c.version_title.toLowerCase().includes(lower) ||
        String(c.academic_year).includes(lower)
    );
  }, [curriculums, curriculumSearch]);

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
              Users Management
            </button>
            <button
              className={activeTab === 'groups' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('groups')}
            >
              Groups
            </button>
            <button
              className={activeTab === 'curriculums' ? 'btn btn-primary' : 'btn'}
              onClick={() => setActiveTab('curriculums')}
            >
              Curriculums
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

              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  + Create Group
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
                      <th>Enrolled Students</th>
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
                          <button
                            className="btn btn-mini"
                            onClick={() => openStudentsModal(g)}
                            style={{ padding: '3px 10px', fontSize: '12px' }}
                          >
                            + Add
                          </button>
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
                                  {adv.display_name || adv.username}
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

        {/* ================= TAB 3: CURRICULUMS (US14) ================= */}
        {activeTab === 'curriculums' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <input
                placeholder="Search curriculums by program, version, or year..."
                value={curriculumSearch}
                onChange={(e) => setCurriculumSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 360 }}
              />

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setImportError('');
                    setPreviewData(null);
                    setImportFileBase64('');
                    setImportFileName('');
                    setShowImportModal(true);
                  }}
                >
                  + Import Curriculum
                </button>
              </div>
            </div>

            {loadingCurriculums ? (
              <p className="muted">Loading academic curriculums...</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Program / Major</th>
                      <th>Version Title</th>
                      <th>Year</th>
                      <th>Courses / Semesters</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCurriculums.length === 0 && (
                      <tr>
                        <td colSpan="6" className="c muted">No program curriculums found. Click "+ Import Curriculum" to upload one.</td>
                      </tr>
                    )}
                    {filteredCurriculums.map((c) => (
                      <tr key={c.id}>
                        <td><b>{c.program}</b></td>
                        <td><span className="code">{c.version_title}</span></td>
                        <td>{c.academic_year}</td>
                        <td>
                          {c.course_count} courses ({c.max_semester} semesters)
                        </td>
                        <td>
                          {c.is_published ? (
                            <span
                              style={{
                                backgroundColor: '#e6f4ea',
                                color: '#137333',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                              }}
                            >
                              Published
                            </span>
                          ) : (
                            <span
                              style={{
                                backgroundColor: '#f1f3f4',
                                color: '#5f6368',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                              }}
                            >
                              Draft
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              className="btn btn-mini"
                              onClick={() => handleViewCurriculumDetails(c)}
                              style={{ padding: '3px 8px', fontSize: '12px' }}
                            >
                              View
                            </button>
                            <button
                              className={c.is_published ? 'btn btn-mini' : 'btn btn-mini btn-primary'}
                              onClick={() => handleTogglePublishPrompt(c)}
                              style={{ padding: '3px 8px', fontSize: '12px' }}
                            >
                              {c.is_published ? 'Unpublish' : 'Publish'}
                            </button>
                            <button
                              className="btn btn-danger btn-mini"
                              onClick={() => handleDeleteCurriculumPrompt(c)}
                              style={{ padding: '3px 8px', fontSize: '12px' }}
                            >
                              Delete
                            </button>
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
                <label className="small muted">Group Name (e.g. CS-23-1, 404)</label>
                <input
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="404"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="small muted">Study Program / Major</label>
                <input
                  required
                  value={newGroupProgram}
                  onChange={(e) => setNewGroupProgram(e.target.value)}
                  placeholder="Information Systems"
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
                <label className="small muted">Assign Academic Advisor (Optional - Advisor role only)</label>
                <select
                  value={newGroupAdvisor}
                  onChange={(e) => setNewGroupAdvisor(e.target.value)}
                  style={{ width: '100%', marginTop: '0.3rem', padding: '6px' }}
                >
                  <option value="">-- No Advisor Assigned --</option>
                  {advisorCandidates.map((adv) => (
                    <option key={adv.username} value={adv.username}>
                      {adv.display_name || adv.username}
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

      {/* ================= MODAL: MANAGE STUDENTS IN GROUP ================= */}
      {selectedGroup && (
        <div className="modal-backdrop">
          <div className="card modal-card" style={{ maxWidth: 600, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0' }}>Group {selectedGroup.name} — Students</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {selectedGroup.program} · Year {selectedGroup.study_year}
                </p>
              </div>
              <button
                className="btn btn-mini"
                onClick={() => setSelectedGroup(null)}
              >
                ✕ Close
              </button>
            </div>

            {/* Form to add a student */}
            <form onSubmit={handleEnrollStudent} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <input
                required
                list="registered-students-list"
                value={studentInput}
                onChange={(e) => setStudentInput(e.target.value)}
                placeholder="Enter student login (e.g. 240103199)..."
                style={{ flex: 1 }}
              />
              <datalist id="registered-students-list">
                {studentCandidates.map((s) => (
                  <option key={s.username} value={s.username}>
                    {s.display_name ? `${s.display_name} (@${s.username})` : s.username}
                  </option>
                ))}
              </datalist>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={enrolling || !studentInput.trim()}
              >
                {enrolling ? 'Adding...' : '+ Add Student'}
              </button>
            </form>

            {enrollError && (
              <div
                style={{
                  backgroundColor: '#fce8e6',
                  color: '#c5221f',
                  border: '1px solid #f5c6cb',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  marginBottom: '1rem',
                  fontWeight: 500,
                }}
              >
                ⚠️ {enrollError}
              </div>
            )}

            {/* Table of enrolled students */}
            {loadingMembers ? (
              <p className="muted">Loading students in this group...</p>
            ) : groupMembers.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: '#f9f9f9', borderRadius: 6 }}>
                <p className="muted" style={{ margin: 0 }}>
                  No students are enrolled in group <b>{selectedGroup.name}</b> yet.
                  <br />
                  <span className="small">Enter a student login above to enroll them.</span>
                </p>
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="tbl" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Student Login</th>
                      <th>Display Name</th>
                      <th>Enrolled Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupMembers.map((m) => (
                      <tr key={m.username}>
                        <td><b className="code">{m.username}</b></td>
                        <td>{m.display_name || <span className="muted">—</span>}</td>
                        <td className="small">{new Date(m.enrolled_at).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="btn btn-danger btn-mini"
                            onClick={() => handleRemoveStudentPrompt(m.username)}
                            style={{ padding: '2px 6px', fontSize: '11px' }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                className="btn"
                onClick={() => setSelectedGroup(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: IMPORT CURRICULUM (US14) ================= */}
      {showImportModal && (
        <div className="modal-backdrop">
          <div className="card modal-card" style={{ maxWidth: 580, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Import Program Curriculum</h3>
            <p className="muted small" style={{ marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
              Upload an official program curriculum (.xlsx or .csv) mapping courses to semesters.
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ flex: 2 }}>
                <label className="small muted">Program / Major</label>
                <input
                  required
                  value={importProgram}
                  onChange={(e) => {
                    setImportProgram(e.target.value);
                    setImportTitle(`${e.target.value} ${importYear}`);
                  }}
                  placeholder="e.g. Computer Science, Information Systems"
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="small muted">Enrollment Year</label>
                <input
                  type="number"
                  required
                  value={importYear}
                  onChange={(e) => {
                    setImportYear(e.target.value);
                    setImportTitle(`${importProgram} ${e.target.value}`);
                  }}
                  style={{ width: '100%', marginTop: '0.3rem' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted">Curriculum Version Title</label>
              <input
                required
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder="e.g. Computer Science 2023"
                style={{ width: '100%', marginTop: '0.3rem' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <label className="small muted">Curriculum File (.xlsx, .csv)</label>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="btn btn-mini"
                  style={{ fontSize: '11px', padding: '2px 6px' }}
                >
                  📥 Download CSV template
                </button>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelected}
                style={{ width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: 4 }}
              />
              {importFileName && <p className="small muted" style={{ margin: '4px 0 0 0' }}>Selected: <b>{importFileName}</b></p>}
            </div>

            {loadingPreview && <p className="muted small">Parsing and validating curriculum file...</p>}

            {importError && (
              <div
                style={{
                  backgroundColor: '#fce8e6',
                  color: '#c5221f',
                  border: '1px solid #f5c6cb',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  marginBottom: '1rem',
                  fontWeight: 500,
                }}
              >
                ⚠️ {importError}
              </div>
            )}

            {previewData && (
              <div style={{ marginBottom: '1.25rem', backgroundColor: '#f8f9fa', padding: '12px', borderRadius: 6, border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '14px' }}>Validation & Preview Summary</h4>

                {!previewData.is_valid ? (
                  <div
                    style={{
                      backgroundColor: '#fce8e6',
                      color: '#c5221f',
                      padding: '8px 12px',
                      borderRadius: 4,
                      fontSize: '13px',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <b>⚠️ Unmapped Course Codes:</b>
                    <div style={{ marginTop: '4px' }}>
                      The following course codes were not found in the course catalog:
                      <b style={{ marginLeft: 4 }}>{previewData.unmapped_codes.join(', ')}</b>.
                    </div>
                    <div className="small" style={{ marginTop: '4px', opacity: 0.9 }}>
                      Curriculum cannot be published until all course codes exist in the course catalog. You can still save it as draft.
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      backgroundColor: '#e6f4ea',
                      color: '#137333',
                      padding: '8px 12px',
                      borderRadius: 4,
                      fontSize: '13px',
                      marginBottom: '0.75rem',
                      fontWeight: 500,
                    }}
                  >
                    ✓ All {previewData.total_courses} course codes successfully mapped to catalog! ({previewData.total_ects} ECTS total across {previewData.semesters.length} semesters).
                  </div>
                )}

                <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                  <table className="tbl" style={{ margin: 0, fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th>Semester</th>
                        <th>Courses</th>
                        <th>ECTS Sum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.semesters.map((s) => (
                        <tr key={s.semester}>
                          <td><b>Semester {s.semester}</b></td>
                          <td>{s.course_count} courses</td>
                          <td>{s.ects_sum} ECTS</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                disabled={savingCurriculum}
                onClick={() => setShowImportModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={savingCurriculum || !importFileBase64}
                onClick={() => handleSaveCurriculum(false)}
              >
                {savingCurriculum ? 'Saving...' : 'Save as Draft'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingCurriculum || !importFileBase64 || (previewData && !previewData.is_valid)}
                onClick={() => handleSaveCurriculum(true)}
              >
                {savingCurriculum ? 'Saving...' : 'Save & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: VIEW CURRICULUM (US14) ================= */}
      {viewCurriculum && (
        <div className="modal-backdrop">
          <div className="card modal-card" style={{ maxWidth: 760, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{viewCurriculum.version_title}</h3>
                <p className="muted small" style={{ margin: '2px 0 0 0' }}>
                  Program: <b>{viewCurriculum.program}</b> | Year: <b>{viewCurriculum.academic_year}</b>
                </p>
              </div>
              <div>
                {viewCurriculum.is_published ? (
                  <span
                    style={{
                      backgroundColor: '#e6f4ea',
                      color: '#137333',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                  >
                    Published
                  </span>
                ) : (
                  <span
                    style={{
                      backgroundColor: '#f1f3f4',
                      color: '#5f6368',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                  >
                    Draft
                  </span>
                )}
              </div>
            </div>

            {loadingDetails ? (
              <p className="muted">Loading curriculum details...</p>
            ) : !viewCurriculum.semesters || viewCurriculum.semesters.length === 0 ? (
              <p className="muted">No courses found in this curriculum.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {viewCurriculum.semesters.map((s) => (
                  <div key={s.no} style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ backgroundColor: '#f8f9fa', padding: '6px 12px', fontWeight: 'bold', fontSize: '13px' }}>
                      Semester {s.no} ({s.courses.length} courses, {s.courses.reduce((sum, c) => sum + (Number(c.ects) || 0), 0)} ECTS)
                    </div>
                    <table className="tbl" style={{ margin: 0, fontSize: '12px' }}>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Course Name</th>
                          <th>ECTS</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.courses.map((c) => (
                          <tr key={c.id || c.course_code}>
                            <td><b className="code">{c.course_code}</b></td>
                            <td>{c.course_name}</td>
                            <td>{c.ects}</td>
                            <td><span className="small muted">{c.course_type}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                className="btn"
                onClick={() => setViewCurriculum(null)}
              >
                Close
              </button>
            </div>
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
