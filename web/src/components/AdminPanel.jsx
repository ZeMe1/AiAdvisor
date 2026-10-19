import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';

/* ─── Users tab ────────────────────────────────────────────────────────── */

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await api.adminGetUsers();
      setUsers(data);
    } catch (e) {
      setError('Error loading users: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(username, newRole) {
    if (!confirm(`Change role of user ${username} to ${newRole}?`)) return;
    try {
      const updated = await api.adminUpdateRole(username, newRole);
      setUsers(users.map((u) => u.username === username ? { ...u, role: updated.role } : u));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleBlockToggle(username, currentStatus) {
    const action = currentStatus ? 'unblock' : 'block';
    if (!confirm(`Are you sure you want to ${action} user ${username}?`)) return;
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
    <>
      {error && <div className="banner-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div style={{ marginBottom: '1rem' }}>
        <input
          placeholder="Search by username or display name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 400 }}
        />
      </div>

      {loading ? (
        <p className="muted">Loading users...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th>Display Name</th>
                <th>Registered Date</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr><td colSpan="6" className="c muted">No users found</td></tr>
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
                      {u.is_blocked ? 'Unblock' : 'Block'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Course form modal with Teacher, Quota & Semester Presets ──────────── */

const EMPTY_COURSE = {
  code: '',
  name: '',
  credits: 5,
  description: '',
  language: 'English',
  semester: 'Fall 2026',
  theory_teacher: '',
  practice_teacher: '',
  quota: 30
};

const SEMESTER_PRESETS = [
  'Fall 2026',
  'Spring 2026',
  'Fall 2025',
  'Spring 2025',
  'Fall 2024',
  'Semester 1',
  'Semester 2',
  'Semester 3',
  'Semester 4',
  'Semester 5'
];

function CourseFormModal({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial ? {
    ...EMPTY_COURSE,
    ...initial,
    theory_teacher: initial.theory_teacher || initial.teacher || '',
    practice_teacher: initial.practice_teacher || initial.theory_teacher || initial.teacher || ''
  } : EMPTY_COURSE);
  const isNew = !initial;

  function set(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div style={overlayStyle}>
      <form onSubmit={handleSubmit} style={modalStyle}>
        <h3 style={{ margin: '0 0 12px' }}>{isNew ? 'Create Course' : 'Edit Course'}</h3>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Course Code *
            <input required maxLength={20} value={form.code} onChange={set('code')} placeholder="CS 101" />
          </label>

          <label style={{ ...labelStyle, flex: 2 }}>
            Course Title *
            <input required maxLength={255} value={form.name} onChange={set('name')} placeholder="Intro to Computer Science" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            👨‍🏫 Theory Instructor
            <input maxLength={255} value={form.theory_teacher} onChange={set('theory_teacher')} placeholder="e.g. Aliya Zhunis" />
          </label>

          <label style={{ ...labelStyle, flex: 1 }}>
            🧑‍🏫 Practice Instructor
            <input maxLength={255} value={form.practice_teacher} onChange={set('practice_teacher')} placeholder="e.g. Yerlan Berikov" />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            👥 Quota
            <input type="number" min={1} max={500} value={form.quota} onChange={set('quota')} placeholder="30" />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Credits (ECTS)
            <input type="number" min={1} max={30} value={form.credits} onChange={set('credits')} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Language
            <select value={form.language} onChange={set('language')} style={{ padding: '6px 9px', border: '1px solid #b9c4cf', borderRadius: 4, font: 'inherit' }}>
              <option>English</option>
              <option>Kazakh</option>
              <option>Russian</option>
            </select>
          </label>
        </div>

        <label style={labelStyle}>
          Semester (e.g. Fall 2026 or semester name)
          <input maxLength={50} value={form.semester} onChange={set('semester')} placeholder="Fall 2026" />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            <span className="muted small" style={{ marginRight: 4, alignSelf: 'center' }}>Quick presets:</span>
            {SEMESTER_PRESETS.map((p) => (
              <button
                type="button"
                key={p}
                className="btn btn-mini"
                style={{ background: form.semester === p ? '#0052cc' : '#f0f4f8', color: form.semester === p ? '#fff' : '#22303e', border: '1px solid #b9c4cf' }}
                onClick={() => setForm({ ...form, semester: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </label>

        <label style={labelStyle}>
          Description
          <textarea rows={3} value={form.description} onChange={set('description')} style={{ resize: 'vertical', border: '1px solid #b9c4cf', borderRadius: 4, padding: '6px 9px', font: 'inherit' }} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : isNew ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000,
};
const modalStyle = {
  background: '#fff', borderRadius: 10, padding: '22px 26px', width: 500, maxWidth: '95vw',
  boxShadow: '0 8px 32px rgba(22,41,110,.18)', display: 'flex', flexDirection: 'column', gap: 10,
};
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '12.5px', color: '#6b7a8c' };

/* ─── Courses tab ────────────────────────────────────────────────────────── */

function CoursesTab() {
  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCourses(); }, []);

  async function loadCourses() {
    try {
      setLoading(true);
      setError(null);
      setCourses(await api.adminGetCourses());
    } catch (e) {
      setError('Error loading courses: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(form) {
    setSaving(true);
    setError(null);
    try {
      if (modal === 'new') {
        const created = await api.adminCreateCourse(form);
        setCourses((prev) => [...prev, created]);
      } else {
        const updated = await api.adminUpdateCourse(modal.id, form);
        setCourses((prev) => prev.map((c) => c.id === modal.id ? updated : c));
      }
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle(course) {
    const action = course.is_archived ? 'restore' : 'archive';
    if (!confirm(`Are you sure you want to ${action} course ${course.code}?`)) return;
    try {
      const updated = await api.adminArchiveCourse(course.id, !course.is_archived);
      setCourses((prev) => prev.map((c) => c.id === course.id ? updated : c));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDelete(course) {
    if (!confirm(`Are you sure you want to permanently delete course ${course.code} ("${course.name}")?\n\nThis action cannot be undone.`)) return;
    try {
      await api.adminDeleteCourse(course.id);
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (e) {
      alert('Error deleting course: ' + e.message);
    }
  }

  const filteredCourses = useMemo(() => {
    if (!search.trim()) return courses;
    const lower = search.toLowerCase();
    return courses.filter(c =>
      c.code.toLowerCase().includes(lower) ||
      c.name.toLowerCase().includes(lower) ||
      (c.theory_teacher && c.theory_teacher.toLowerCase().includes(lower)) ||
      (c.practice_teacher && c.practice_teacher.toLowerCase().includes(lower)) ||
      (c.teacher && c.teacher.toLowerCase().includes(lower)) ||
      (c.semester && c.semester.toLowerCase().includes(lower))
    );
  }, [courses, search]);

  return (
    <>
      {error && <div className="banner-error" style={{ marginBottom: '1rem' }} onClick={() => setError(null)}>{error} ✕</div>}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search by code, title, instructor, or semester..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, maxWidth: 450 }}
        />
        <button className="btn btn-primary" onClick={() => setModal('new')}>+ Create Course</button>
      </div>

      {loading ? (
        <p className="muted">Loading courses...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Theory Instructor</th>
                <th>Practice Instructor</th>
                <th>Quota</th>
                <th>ECTS</th>
                <th>Language</th>
                <th>Semester</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.length === 0 && (
                <tr><td colSpan="10" className="c muted">No courses found</td></tr>
              )}
              {filteredCourses.map((c) => (
                <tr key={c.id} style={{ opacity: c.is_archived ? 0.55 : 1 }}>
                  <td><b className="code">{c.code}</b></td>
                  <td>{c.name}</td>
                  <td>{c.theory_teacher || c.teacher || <span className="muted">—</span>}</td>
                  <td>{c.practice_teacher || c.theory_teacher || c.teacher || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{c.quota || 30}</td>
                  <td style={{ textAlign: 'center' }}>{c.credits}</td>
                  <td>{c.language}</td>
                  <td><span style={{ fontWeight: 600, color: '#0052cc' }}>{c.semester || <span className="muted">—</span>}</span></td>
                  <td>
                    {c.is_archived
                      ? <span style={{ color: '#c00', fontWeight: 'bold' }}>Archived</span>
                      : <span style={{ color: '#00773c' }}>Active</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      onClick={() => setModal({
                        code: c.code,
                        name: c.name,
                        credits: c.credits,
                        description: c.description ?? '',
                        language: c.language ?? 'English',
                        semester: c.semester ?? '',
                        theory_teacher: c.theory_teacher || c.teacher || '',
                        practice_teacher: c.practice_teacher || c.theory_teacher || c.teacher || '',
                        quota: c.quota ?? 30,
                        id: c.id
                      })}
                      style={{ padding: '2px 8px', fontSize: '11px', marginRight: 4 }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className={c.is_archived ? 'btn' : 'btn btn-ghost'}
                      style={{ padding: '2px 8px', fontSize: '11px', marginRight: 4, color: c.is_archived ? '#00773c' : '#777', border: '1px solid #ccc' }}
                      onClick={() => handleArchiveToggle(c)}
                    >
                      {c.is_archived ? '📦 Restore' : '🗄️ Archive'}
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(c)}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CourseFormModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSave}
          onCancel={() => setModal(null)}
          saving={saving}
        />
      )}
    </>
  );
}

/* ─── Prerequisites tab (User Story 7: Manage Prerequisites) ─────────────── */

function PrerequisitesTab() {
  const [prereqs, setPrereqs] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [courseCode, setCourseCode] = useState('');
  const [prereqCode, setPrereqCode] = useState('');
  const [minGrade, setMinGrade] = useState('C');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [pList, cList] = await Promise.all([
        api.adminGetPrerequisites(),
        api.adminGetCourses()
      ]);
      setPrereqs(pList);
      setCourses(cList);
      if (cList.length > 0) {
        if (!courseCode) setCourseCode(cList[0].code);
        if (!prereqCode && cList.length > 1) setPrereqCode(cList[1].code);
      }
    } catch (e) {
      setError('Error loading prerequisites: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!courseCode.trim() || !prereqCode.trim()) {
      setError('Please specify both courses');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.adminCreatePrerequisite({
        course_code: courseCode.trim().toUpperCase(),
        prereq_code: prereqCode.trim().toUpperCase(),
        min_grade: minGrade,
        type: 'prerequisite'
      });
      setPrereqs(prev => [...prev, created]);
      setSuccess(`Prerequisite added successfully: ${created.course_code} → ${created.prereq_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete prerequisite: ${item.course_code} requires ${item.prereq_code}?`)) return;
    try {
      await api.adminDeletePrerequisite(item.id);
      setPrereqs(prev => prev.filter(p => p.id !== item.id));
    } catch (err) {
      alert('Error deleting prerequisite: ' + err.message);
    }
  }

  // Group prerequisites by course for visual graph representation
  const graphByCourse = useMemo(() => {
    const map = new Map();
    for (const p of prereqs) {
      if (!map.has(p.course_code)) map.set(p.course_code, []);
      map.get(p.course_code).push(p);
    }
    return Array.from(map.entries());
  }, [prereqs]);

  const courseOptions = useMemo(() => {
    const set = new Set();
    courses.forEach(c => set.add(c.code));
    ['CSS 101', 'CSS 105', 'CSS 108', 'CSS 215', 'CSS 217', 'CSS 331', 'INF 106', 'INF 203', 'INF 329', 'MAT 137', 'MAT 151', 'MAT 156'].forEach(c => set.add(c));
    return Array.from(set).sort();
  }, [courses]);

  return (
    <>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>🔗 Manage Prerequisites</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Define prerequisite relationships between courses (courses required before enrollment). The system automatically validates against cyclic dependencies (DAG).
        </p>
      </div>

      {error && <div className="banner-error" style={{ marginBottom: '1rem' }} onClick={() => setError(null)}>{error} ✕</div>}
      {success && <div style={{ background: '#e6f7ec', border: '1px solid #99e0b1', color: '#137333', padding: '8px 12px', borderRadius: 6, marginBottom: '1rem' }}>{success}</div>}

      {/* Card for adding a link */}
      <form onSubmit={handleAdd} style={{ background: '#f8fbff', border: '1px solid #c9d8eb', borderRadius: 8, padding: '16px', marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 600, color: '#16296e', marginBottom: '10px' }}>➕ Add Course Prerequisite</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 160, fontSize: '12px', color: '#555' }}>
            Course (requiring prerequisite)
            <input
              list="course-list-1"
              value={courseCode}
              onChange={e => setCourseCode(e.target.value.toUpperCase())}
              placeholder="e.g. CSS 215"
              required
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
            <datalist id="course-list-1">
              {courseOptions.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 160, fontSize: '12px', color: '#555' }}>
            Required Course (Prerequisite)
            <input
              list="course-list-2"
              value={prereqCode}
              onChange={e => setPrereqCode(e.target.value.toUpperCase())}
              placeholder="e.g. CSS 105"
              required
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
            <datalist id="course-list-2">
              {courseOptions.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120, fontSize: '12px', color: '#555' }}>
            Min Grade
            <select
              value={minGrade}
              onChange={e => setMinGrade(e.target.value)}
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            >
              <option value="D">D (Pass)</option>
              <option value="C">C (Average)</option>
              <option value="B">B (Good)</option>
              <option value="A">A (Excellent)</option>
            </select>
          </label>

          <button type="submit" className="btn btn-primary" disabled={saving} style={{ height: '34px', padding: '0 16px' }}>
            {saving ? '...' : '+ Add Prerequisite'}
          </button>
        </div>
      </form>

      {/* Visual Dependency Map / Graph */}
      {graphByCourse.length > 0 && (
        <div style={{ marginBottom: '1.5rem', background: '#fafbfc', border: '1px solid #e1e7ed', borderRadius: 8, padding: '14px' }}>
          <div style={{ fontWeight: 600, color: '#16296e', fontSize: '13px', marginBottom: '8px' }}>
            🗺️ Visual Dependency Map (Prerequisite Graph):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {graphByCourse.map(([course, links]) => (
              <div key={course} style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 6, padding: '8px 12px', minWidth: 200 }}>
                <b className="code" style={{ color: '#0052cc', fontSize: '13px' }}>{course}</b>
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {links.map(l => (
                    <div key={l.id} style={{ fontSize: '11.5px', color: '#444' }}>
                      ↳ requires <b className="code">{l.prereq_code}</b>
                      <span style={{ marginLeft: 4, color: '#666', fontSize: '10.5px' }}>
                        (min. {l.min_grade})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table of links */}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Course</th>
              <th>Required Prerequisite</th>
              <th>Min Grade</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {prereqs.length === 0 ? (
              <tr><td colSpan="5" className="c muted">No prerequisites added yet. Add the first prerequisite in the form above.</td></tr>
            ) : (
              prereqs.map((p, i) => (
                <tr key={p.id}>
                  <td className="dim c">{i + 1}</td>
                  <td><b className="code" style={{ color: '#0052cc' }}>{p.course_code}</b></td>
                  <td>
                    <span style={{ color: '#555' }}>requires → </span>
                    <b className="code">{p.prereq_code}</b>
                  </td>
                  <td>
                    <span style={{ background: '#f5f5f5', border: '1px solid #ddd', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold', fontSize: '11px' }}>
                      ≥ {p.min_grade || 'C'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(p)}
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ─── Main AdminPanel with tabs ──────────────────────────────────────────── */

export default function AdminPanel({ onBack }) {
  const [tab, setTab] = useState('courses');

  return (
    <div className="card" style={{ maxWidth: 1100, margin: '2rem auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button className="btn" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0 }}>Admin Panel</h2>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '2px solid #c9d4e0' }}>
        <button
          onClick={() => setTab('courses')}
          style={{
            padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none',
            borderBottom: tab === 'courses' ? '3px solid #005cb9' : '3px solid transparent',
            color: tab === 'courses' ? '#005cb9' : '#6b7a8c',
          }}
        >
          📚 Courses (Catalog)
        </button>
        <button
          onClick={() => setTab('prerequisites')}
          style={{
            padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none',
            borderBottom: tab === 'prerequisites' ? '3px solid #005cb9' : '3px solid transparent',
            color: tab === 'prerequisites' ? '#005cb9' : '#6b7a8c',
          }}
        >
          🔗 Prerequisites
        </button>
        <button
          onClick={() => setTab('users')}
          style={{
            padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none',
            borderBottom: tab === 'users' ? '3px solid #005cb9' : '3px solid transparent',
            color: tab === 'users' ? '#005cb9' : '#6b7a8c',
          }}
        >
          👥 Users
        </button>
      </div>

      {tab === 'courses' ? <CoursesTab /> : tab === 'prerequisites' ? <PrerequisitesTab /> : <UsersTab />}
    </div>
  );
}
