import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api.js';

export default function Transcript({ onBack, onOpenProgress, profile: propProfile }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ courses: [], totalCredits: 0, estimatedGpa: 0 });
  const [catalog, setCatalog] = useState([]);
  const [profile, setProfile] = useState(propProfile || null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Upload & Parsing state
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [savingPreview, setSavingPreview] = useState(false);
  const fileInputRef = useRef(null);

  // Manual Add Form state
  const [manualCode, setManualCode] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualCredits, setManualCredits] = useState('5');
  const [manualGrade, setManualGrade] = useState('A');
  const [manualSemester, setManualSemester] = useState('Fall 2024');
  const [manualSaving, setManualSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [tData, cList, pData] = await Promise.all([
        api.studentGetTranscript().catch(() => ({ courses: [], totalCredits: 0, estimatedGpa: 0 })),
        api.catalog().catch(() => []),
        !profile ? api.profile().catch(() => null) : Promise.resolve(profile)
      ]);
      setData(tData);
      setCatalog(cList || []);
      if (pData) setProfile(pData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Pre-fill course name when course code changes
  function handleManualCodeChange(codeVal) {
    const code = codeVal.toUpperCase();
    setManualCode(code);
    const found = catalog.find(c => c.code.toUpperCase() === code);
    if (found) {
      if (found.name) setManualName(found.name);
      if (found.credits) setManualCredits(String(found.credits));
      if (found.semester) setManualSemester(found.semester);
    }
  }

  // File Upload & Parse
  async function handleFileUpload(file) {
    if (!file) return;
    setParsing(true);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result;
        const res = await api.studentParseTranscript({
          fileData: base64,
          fileName: file.name
        });
        setPreview(res);
        setSuccess(`File "${file.name}" recognized successfully! Review the courses below and click "Confirm".`);
      } catch (err) {
        setError(err.message || 'Could not recognize the file');
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read the file on your device.');
      setParsing(false);
    };
    reader.readAsDataURL(file);
  }

  // Confirm recognized courses
  async function handleConfirmPreview() {
    if (!preview || !preview.courses || preview.courses.length === 0) return;
    setSavingPreview(true);
    setError(null);
    try {
      const res = await api.studentConfirmTranscript(preview.courses);
      setData(res);
      setPreview(null);
      setSuccess(`Successfully saved ${res.savedCount} completed courses to your profile!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPreview(false);
    }
  }

  // Edit row in preview
  function updatePreviewRow(idx, field, value) {
    if (!preview) return;
    const updated = [...preview.courses];
    updated[idx] = { ...updated[idx], [field]: value };
    
    if (field === 'course_code') {
      const found = catalog.find(c => c.code.toUpperCase() === value.toUpperCase());
      if (found) {
        updated[idx].course_name = found.name;
        updated[idx].credits = found.credits;
        updated[idx].matched = true;
      }
    }
    setPreview({
      ...preview,
      courses: updated,
      unmatchedCount: updated.filter(c => !c.matched).length
    });
  }

  function removePreviewRow(idx) {
    if (!preview) return;
    const updated = preview.courses.filter((_, i) => i !== idx);
    setPreview({
      ...preview,
      courses: updated,
      unmatchedCount: updated.filter(c => !c.matched).length
    });
  }

  // Add course manually
  async function handleManualAdd(e) {
    e.preventDefault();
    if (!manualCode.trim()) {
      setError('Please provide course code');
      return;
    }
    setManualSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.studentAddManualCourse({
        course_code: manualCode.trim().toUpperCase(),
        course_name: manualName.trim(),
        credits: Number(manualCredits) || 5,
        grade: manualGrade,
        semester: manualSemester.trim()
      });
      const refreshed = await api.studentGetTranscript();
      setData(refreshed);
      setSuccess(`Course ${manualCode.toUpperCase()} successfully added to transcript!`);
      setManualCode('');
      setManualName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setManualSaving(false);
    }
  }

  // Delete single course
  async function handleDeleteCourse(course) {
    if (!confirm(`Delete course "${course.course_code}" from transcript?`)) return;
    try {
      await api.studentDeleteTranscriptCourse(course.id);
      const refreshed = await api.studentGetTranscript();
      setData(refreshed);
    } catch (err) {
      alert('Error deleting course: ' + err.message);
    }
  }

  // Clear entire transcript
  async function handleClearAll() {
    if (!confirm('Are you sure you want to delete ALL transcript data? This action cannot be undone.')) return;
    try {
      await api.studentClearTranscript();
      setData({ courses: [], totalCredits: 0, estimatedGpa: 0 });
      setSuccess('Transcript cleared successfully.');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  const catalogOptions = useMemo(() => {
    return catalog.map(c => c.code).sort();
  }, [catalog]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '20px', color: '#16296e' }}>
            📄 My Transcript
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Upload your official transcript (PDF or XLSX) or add courses manually to record your academic history.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onOpenProgress && (
            <button className="btn btn-primary" onClick={onOpenProgress}>
              📈 Progress Dashboard
            </button>
          )}
          {onBack && (
            <button className="btn btn-ghost" onClick={onBack}>
              ← Back to Schedule
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="banner-error" style={{ marginBottom: '1rem', cursor: 'pointer' }} onClick={() => setError(null)}>
          {error} ✕
        </div>
      )}

      {success && (
        <div style={{ background: '#e6f7ec', border: '1px solid #99e0b1', color: '#137333', padding: '10px 14px', borderRadius: 6, marginBottom: '1rem' }}>
          {success}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#666', fontWeight: 600 }}>🎓 CURRENT GPA</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#0052cc', marginTop: 4 }}>
            {data.estimatedGpa ? data.estimatedGpa.toFixed(2) : '0.00'}
            <span style={{ fontSize: '14px', color: '#888', fontWeight: 400 }}> / 4.00</span>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#666', fontWeight: 600 }}>📚 COMPLETED CREDITS</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#137333', marginTop: 4 }}>
            {data.totalCredits || 0}
            <span style={{ fontSize: '14px', color: '#888', fontWeight: 400 }}> ECTS</span>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#666', fontWeight: 600 }}>📝 COURSES COMPLETED</div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#333', marginTop: 4 }}>
            {data.courses ? data.courses.length : 0}
            <span style={{ fontSize: '14px', color: '#888', fontWeight: 400 }}> courses</span>
          </div>
        </div>
      </div>

      {/* SDU Login / Anti-Fake Status Bar */}
      <div style={{
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        padding: '12px 18px',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🛡️</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
              User Verification (Anti-Fake System)
            </div>
            <div style={{ fontSize: '12px', color: '#475569' }}>
              Your <b>SDU Login (username)</b>: <code style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontWeight: 700, color: '#0052cc', fontSize: '13px' }}>{profile?.username || '—'}</code>
              {profile?.display_name && <span style={{ marginLeft: 6 }}>({profile.display_name})</span>}
            </div>
          </div>
        </div>
        <div style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '5px 12px', borderRadius: 14, fontWeight: 600 }}>
          🔒 Uploaded file ID must strictly match your SDU Login
        </div>
      </div>

      {/* Upload Zone (Drag and Drop) */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
          }
        }}
        style={{
          border: '2px dashed #0052cc',
          background: '#f4f8fd',
          borderRadius: 8,
          padding: '24px',
          textAlign: 'center',
          marginBottom: '1.5rem',
          cursor: 'pointer'
        }}
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files && e.target.files[0]) {
              handleFileUpload(e.target.files[0]);
            }
          }}
        />
        <div style={{ fontSize: '32px', marginBottom: 8 }}>📁</div>
        <div style={{ fontWeight: 600, color: '#16296e', fontSize: '15px' }}>
          {parsing ? '⏳ Recognizing document & verifying ID...' : 'Upload Transcript File (PDF or Excel .xlsx)'}
        </div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Drag and drop file here or click to browse. The system will automatically recognize Student ID, courses, credits, and grades.
        </p>
      </div>

      {/* Course Matching & Preview Screen */}
      {preview && (
        <div style={{ background: '#fff', border: '2px solid #0052cc', borderRadius: 8, padding: '18px', marginBottom: '2rem', boxShadow: '0 4px 12px rgba(0,82,204,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '16px', color: '#16296e' }}>
                🔍 Course Matching & Preview Screen
              </h3>
              <div style={{ fontSize: '12px', color: '#555' }}>
                Recognized: <b>{preview.courses.length}</b> courses | Needs review: <b>{preview.unmatchedCount}</b> | Estimated GPA: <b>{preview.estimatedGpa}</b>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={savingPreview}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmPreview} disabled={savingPreview || !preview.isVerified}>
                {savingPreview ? 'Saving...' : '✅ Confirm & Save to Profile'}
              </button>
            </div>
          </div>

          {/* Anti-Fake ID Verification Box */}
          <div style={{
            background: preview.isVerified ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${preview.isVerified ? '#86efac' : '#fca5a5'}`,
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px'
          }}>
            <span style={{ fontSize: '28px' }}>{preview.isVerified ? '🛡️' : '⛔'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: preview.isVerified ? '#15803d' : '#b91c1c', fontSize: '14px' }}>
                {preview.isVerified
                  ? 'Anti-Fake Verification Successful: Student ID Matches!'
                  : 'Verification Error: Student ID Mismatch!'}
              </div>
              <div style={{ color: '#334155', fontSize: '12px', marginTop: 4, lineHeight: 1.6 }}>
                <div>• Student ID in file: <b>{preview.studentId || 'Not found'}</b> {preview.studentName ? `(${preview.studentName})` : ''}</div>
                <div>• SDU Login (username) on website: <b>{preview.siteUsername || profile?.username || '—'}</b></div>
                <div style={{ marginTop: 2, fontWeight: 600, color: preview.isVerified ? '#166534' : '#991b1b' }}>
                  {preview.isVerified
                    ? '✅ Permission granted: File ID matches your logged-in SDU account. Document is authentic.'
                    : '⛔ Upload rejected: File ID does not match your logged-in SDU account.'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Course Code</th>
                  <th>Course Title</th>
                  <th>Semester</th>
                  <th style={{ width: 70 }}>ECTS</th>
                  <th style={{ width: 90 }}>Grade</th>
                  <th style={{ width: 120 }}>Catalog Match</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {preview.courses.map((c, i) => (
                  <tr key={i} style={{ background: c.matched ? '#fff' : '#fffdf5' }}>
                    <td className="dim c">{i + 1}</td>
                    <td>
                      <input
                        list={`preview-cat-${i}`}
                        value={c.course_code}
                        onChange={e => updatePreviewRow(i, 'course_code', e.target.value)}
                        style={{ width: '100px', padding: '4px 6px', fontWeight: 'bold', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                      <datalist id={`preview-cat-${i}`}>
                        {catalogOptions.map(opt => <option key={opt} value={opt} />)}
                      </datalist>
                    </td>
                    <td>
                      <input
                        value={c.course_name}
                        onChange={e => updatePreviewRow(i, 'course_name', e.target.value)}
                        style={{ width: '100%', minWidth: '180px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                    </td>
                    <td>
                      <input
                        value={c.semester}
                        onChange={e => updatePreviewRow(i, 'semester', e.target.value)}
                        style={{ width: '110px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={c.credits}
                        onChange={e => updatePreviewRow(i, 'credits', e.target.value)}
                        style={{ width: '55px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                    </td>
                    <td>
                      <select
                        value={c.grade}
                        onChange={e => updatePreviewRow(i, 'grade', e.target.value)}
                        style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, fontWeight: 'bold' }}
                      >
                        {['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'P', 'IP'].map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {c.matched ? (
                        <span style={{ color: '#137333', background: '#e6f7ec', padding: '3px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 600 }}>
                          ✓ Matched
                        </span>
                      ) : (
                        <span style={{ color: '#b06000', background: '#fef7e0', padding: '3px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 600 }}>
                          ⚠️ Needs Review
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        onClick={() => removePreviewRow(i)}
                        title="Delete row"
                        style={{ padding: '2px 6px', color: '#c00' }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Add Card */}
      <form onSubmit={handleManualAdd} style={{ background: '#fafbfc', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px', marginBottom: '2rem' }}>
        <div style={{ fontWeight: 600, color: '#16296e', marginBottom: '10px' }}>
          ✍️ Add Completed Course Manually
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 140, fontSize: '12px', color: '#555' }}>
            Course Code
            <input
              list="catalog-course-list"
              value={manualCode}
              onChange={e => handleManualCodeChange(e.target.value)}
              placeholder="e.g. CSS 108"
              required
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
            <datalist id="catalog-course-list">
              {catalogOptions.map(c => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 200, fontSize: '12px', color: '#555' }}>
            Course Title
            <input
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              placeholder="e.g. Data Structures"
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 90, fontSize: '12px', color: '#555' }}>
            ECTS
            <input
              type="number"
              min="1"
              max="20"
              value={manualCredits}
              onChange={e => setManualCredits(e.target.value)}
              required
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 110, fontSize: '12px', color: '#555' }}>
            Grade
            <select
              value={manualGrade}
              onChange={e => setManualGrade(e.target.value)}
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            >
              {['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'P', 'IP'].map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 130, fontSize: '12px', color: '#555' }}>
            Semester
            <input
              value={manualSemester}
              onChange={e => setManualSemester(e.target.value)}
              placeholder="e.g. Fall 2024"
              style={{ padding: '6px 9px', borderRadius: 4, border: '1px solid #b9c4cf' }}
            />
          </label>

          <button type="submit" className="btn btn-primary" disabled={manualSaving} style={{ height: '34px', padding: '0 16px' }}>
            {manualSaving ? '...' : '+ Add Course'}
          </button>
        </div>
      </form>

      {/* Confirmed Transcript Table */}
      <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#16296e' }}>
            📋 Confirmed Student Transcript ({data.courses ? data.courses.length : 0})
          </h3>
          {data.courses && data.courses.length > 0 && (
            <button className="btn btn-danger" onClick={handleClearAll} style={{ fontSize: '12px', padding: '4px 10px' }}>
              🗑️ Clear Transcript
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Course Code</th>
                <th>Course Title</th>
                <th>Semester</th>
                <th>ECTS</th>
                <th>Grade</th>
                <th>GPA Points</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="c muted">Loading transcript data...</td></tr>
              ) : !data.courses || data.courses.length === 0 ? (
                <tr>
                  <td colSpan="8" className="c muted" style={{ padding: '2rem' }}>
                    You have no saved transcript courses yet. Upload a PDF/Excel file above or add completed courses manually.
                  </td>
                </tr>
              ) : (
                data.courses.map((c, i) => (
                  <tr key={c.id || i}>
                    <td className="dim c">{i + 1}</td>
                    <td><b className="code" style={{ color: '#0052cc' }}>{c.course_code}</b></td>
                    <td>{c.course_name || c.course_code}</td>
                    <td className="muted">{c.semester || '—'}</td>
                    <td className="c">{c.credits}</td>
                    <td className="c">
                      <span style={{
                        background: c.grade === 'IP' ? '#e8f0fe' : (c.grade.startsWith('A') || c.grade === 'P') ? '#e6f7ec' : c.grade.startsWith('B') ? '#e3f2fd' : c.grade.startsWith('C') ? '#fff9c4' : '#ffebee',
                        color: c.grade === 'IP' ? '#1967d2' : (c.grade.startsWith('A') || c.grade === 'P') ? '#137333' : c.grade.startsWith('B') ? '#1565c0' : c.grade.startsWith('C') ? '#f57f17' : '#c62828',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontWeight: 'bold',
                        fontSize: '12px'
                      }}>
                        {c.grade === 'IP' ? '⏳ IP' : c.grade}
                      </span>
                    </td>
                    <td className="c font-mono">{c.grade === 'IP' || c.grade === 'P' ? '—' : Number(c.gpa_points || 0).toFixed(2)}</td>
                    <td className="c">
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleDeleteCourse(c)}
                        title="Delete course"
                        style={{ padding: '2px 8px', fontSize: '11px', color: '#c00' }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
