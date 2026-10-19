import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function ProgressDashboard({ onBack, onOpenTranscript }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeSemIdx, setActiveSemIdx] = useState(null);

  useEffect(() => {
    loadProgress();
  }, []);

  async function loadProgress() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.studentGetProgress();
      setData(res);
      if (res && res.semesters && res.semesters.length > 0) {
        // Default to latest semester
        setActiveSemIdx(res.semesters.length - 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1080, margin: '2rem auto', textAlign: 'center', padding: '3rem' }}>
        <div style={{ fontSize: '28px', marginBottom: '12px' }}>⏳</div>
        <p className="muted">Loading academic progress and calculating GPA...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1080, margin: '2rem auto' }}>
        <div className="banner-error">Error: {error}</div>
        <button className="btn" onClick={loadProgress} style={{ marginTop: '1rem' }}>
          Try Again
        </button>
      </div>
    );
  }

  const semesters = data?.semesters || [];
  const hasCourses = data && data.totalCoursesCount > 0;
  const earned = data?.totalEarnedCredits || 0;
  const target = data?.requiredCredits || 240;
  const remaining = data?.remainingCredits || Math.max(0, target - earned);
  const percent = data?.completionPercentage || 0;
  const cumulativeGpa = data?.cumulativeGpa ? data.cumulativeGpa.toFixed(2) : '0.00';

  // Grade groupings
  const dist = data?.gradeDistribution || {};
  const excellentCount = (dist['A'] || 0) + (dist['A-'] || 0);
  const goodCount = (dist['B+'] || 0) + (dist['B'] || 0) + (dist['B-'] || 0);
  const satisfactoryCount = (dist['C+'] || 0) + (dist['C'] || 0) + (dist['C-'] || 0);
  const passedCount = dist['P'] || 0;
  const inProgressCount = dist['IP'] || 0;

  // Grade badge color helper
  function getGradeColor(grade) {
    const g = String(grade || '').toUpperCase();
    if (g === 'A' || g === 'A-') return { bg: '#e6f7ec', text: '#137333', border: '#99e0b1' };
    if (g === 'B+' || g === 'B' || g === 'B-') return { bg: '#e8f0fe', text: '#1a73e8', border: '#aecbfa' };
    if (g === 'C+' || g === 'C' || g === 'C-') return { bg: '#fef7e0', text: '#b06000', border: '#fce8b2' };
    if (g === 'P') return { bg: '#f1f3f4', text: '#3c4043', border: '#dadce0' };
    if (g === 'IP') return { bg: '#f3e8fd', text: '#8430ce', border: '#d7aefb' };
    return { bg: '#fce8e6', text: '#c5221f', border: '#f5c2c7' };
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '22px', color: '#16296e' }}>
            📈 Academic Progress & GPA Dashboard
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            GPA dynamics, semester performance, and degree completion progress (240 ECTS target).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onOpenTranscript && (
            <button className="btn btn-primary" onClick={onOpenTranscript}>
              📄 Upload / Update Transcript
            </button>
          )}
          {onBack && (
            <button className="btn btn-ghost" onClick={onBack}>
              ← Back to Schedule
            </button>
          )}
        </div>
      </div>

      {!hasCourses ? (
        /* Empty State */
        <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '3rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '1rem' }}>📊</div>
          <h3 style={{ margin: '0 0 8px', color: '#16296e' }}>No Academic Data Available</h3>
          <p className="muted" style={{ maxWidth: 520, margin: '0 auto 1.5rem' }}>
            You haven't uploaded course grades yet. Upload your official PDF transcript or add courses manually to view your GPA trend and degree progress.
          </p>
          {onOpenTranscript && (
            <button className="btn btn-primary" onClick={onOpenTranscript}>
              📄 Go to Transcript
            </button>
          )}
        </div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '12px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>🎓 Cumulative GPA</div>
              <div style={{ fontSize: '30px', fontWeight: 700, color: '#0052cc', marginTop: 4 }}>
                {cumulativeGpa}
                <span style={{ fontSize: '15px', color: '#888', fontWeight: 400 }}> / 4.00</span>
              </div>
              <div style={{ fontSize: '12px', color: '#137333', marginTop: 4, fontWeight: 500 }}>
                {Number(cumulativeGpa) >= 3.67 ? '🌟 Honors / Excellent Standing' : Number(cumulativeGpa) >= 2.67 ? '👍 Good Academic Standing' : '✓ Normal Academic Standing'}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '12px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>📚 Completed Credits</div>
              <div style={{ fontSize: '30px', fontWeight: 700, color: '#137333', marginTop: 4 }}>
                {earned}
                <span style={{ fontSize: '15px', color: '#888', fontWeight: 400 }}> / {target} ECTS</span>
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                Completed <b>{percent}%</b> of degree
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '12px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>🎯 Remaining to Graduate</div>
              <div style={{ fontSize: '30px', fontWeight: 700, color: '#e65100', marginTop: 4 }}>
                {remaining}
                <span style={{ fontSize: '15px', color: '#888', fontWeight: 400 }}> ECTS</span>
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                ~ {Math.ceil(remaining / 30)} semesters at 30 ECTS/sem
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '12px', color: '#666', fontWeight: 600, textTransform: 'uppercase' }}>📖 Courses Completed</div>
              <div style={{ fontSize: '30px', fontWeight: 700, color: '#333', marginTop: 4 }}>
                {data.totalCoursesCount}
                <span style={{ fontSize: '15px', color: '#888', fontWeight: 400 }}> courses</span>
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                Across {semesters.length} semesters of study
              </div>
            </div>
          </div>

          {/* Degree Completion Progress Bar with Milestones */}
          <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '20px', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontWeight: 700, color: '#16296e', fontSize: '15px' }}>
                🎓 Bachelor's Degree Completion Progress
              </div>
              <div style={{ fontWeight: 700, color: '#137333', fontSize: '15px' }}>
                {earned} / {target} ECTS ({percent}%)
              </div>
            </div>

            {/* Track Bar */}
            <div style={{ position: 'relative', height: '24px', background: '#e9eef5', borderRadius: 12, overflow: 'hidden', marginBottom: '28px' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, percent))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0052cc 0%, #137333 100%)',
                  borderRadius: 12,
                  transition: 'width 0.6s ease'
                }}
              />
            </div>

            {/* Milestones */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', position: 'relative', marginTop: '-18px' }}>
              {[
                { label: 'Year 1 (Freshman)', credits: 60, pct: 25 },
                { label: 'Year 2 (Sophomore)', credits: 120, pct: 50 },
                { label: 'Year 3 (Junior)', credits: 180, pct: 75 },
                { label: 'Graduation (Senior)', credits: 240, pct: 100 }
              ].map((m, i) => {
                const isPassed = earned >= m.credits;
                return (
                  <div key={i} style={{ textAlign: 'center', borderTop: `2px solid ${isPassed ? '#137333' : '#cbd5e1'}`, paddingTop: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: isPassed ? '#137333' : '#64748b' }}>
                      {isPassed ? '✓ ' : ''}{m.credits} ECTS
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>{m.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive GPA Trend Chart (Pure SVG) */}
          {semesters.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '20px', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#16296e' }}>
                    📉 GPA Trend by Semester
                  </h3>
                  <p className="muted small" style={{ margin: '2px 0 0' }}>
                    Term GPA (blue solid line) and Cumulative GPA (green dashed line).
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#0052cc' }} />
                    <span>Term GPA</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 3, background: '#137333' }} />
                    <span>Cumulative GPA</span>
                  </div>
                </div>
              </div>

              {/* SVG Line Chart */}
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <svg
                  viewBox={`0 0 ${Math.max(600, semesters.length * 130)} 240`}
                  style={{ width: '100%', height: 'auto', minWidth: '550px' }}
                >
                  {/* Grid Lines for GPA 1.0, 2.0, 3.0, 4.0 */}
                  {[1.0, 2.0, 3.0, 4.0].map((level) => {
                    const y = 190 - (level / 4.0) * 160;
                    return (
                      <g key={level}>
                        <line x1="45" y1={y} x2={Math.max(580, semesters.length * 130)} y2={y} stroke="#edf2f7" strokeWidth="1" />
                        <text x="35" y={y + 4} fill="#888" fontSize="10" textAnchor="end">{level.toFixed(1)}</text>
                      </g>
                    );
                  })}

                  {/* Benchmark line for GPA 3.0 (Good Standing) */}
                  <line
                    x1="45"
                    y1={190 - (3.0 / 4.0) * 160}
                    x2={Math.max(580, semesters.length * 130)}
                    y2={190 - (3.0 / 4.0) * 160}
                    stroke="#fed7aa"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />

                  {/* Lines between points */}
                  {semesters.length > 1 && (
                    <>
                      {/* Term GPA Path */}
                      <path
                        d={semesters.map((s, idx) => {
                          const x = 70 + idx * ((Math.max(550, semesters.length * 130) - 100) / Math.max(1, semesters.length - 1));
                          const y = 190 - (Math.min(4.0, s.termGpa) / 4.0) * 160;
                          return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#0052cc"
                        strokeWidth="3"
                      />

                      {/* Cumulative GPA Path (Dashed Green) */}
                      <path
                        d={semesters.map((s, idx) => {
                          const x = 70 + idx * ((Math.max(550, semesters.length * 130) - 100) / Math.max(1, semesters.length - 1));
                          const y = 190 - (Math.min(4.0, s.cumulativeGpa) / 4.0) * 160;
                          return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#137333"
                        strokeWidth="2.5"
                        strokeDasharray="5 4"
                      />
                    </>
                  )}

                  {/* Data Points and Labels */}
                  {semesters.map((s, idx) => {
                    const x = 70 + idx * ((Math.max(550, semesters.length * 130) - 100) / Math.max(1, semesters.length - 1));
                    const termY = 190 - (Math.min(4.0, s.termGpa) / 4.0) * 160;
                    const isSelected = activeSemIdx === idx;
                    const shortName = s.semester.replace(/\s*\(\d{4}\s*-\s*\d{4}\.\s*\d\)/, '');

                    return (
                      <g
                        key={idx}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setActiveSemIdx(idx)}
                      >
                        {/* Vertical Guide */}
                        <line x1={x} y1="30" x2={x} y2="190" stroke={isSelected ? '#0052cc' : '#f1f5f9'} strokeWidth={isSelected ? '2' : '1'} />

                        {/* Term GPA Point */}
                        <circle cx={x} cy={termY} r={isSelected ? "6" : "4.5"} fill="#0052cc" stroke="#fff" strokeWidth="2" />
                        <text x={x} y={termY - 10} fill="#0052cc" fontSize="11" fontWeight="700" textAnchor="middle">
                          {s.termGpa ? s.termGpa.toFixed(2) : '—'}
                        </text>

                        {/* Semester Name Label */}
                        <text
                          x={x}
                          y={215}
                          fill={isSelected ? '#0052cc' : '#475569'}
                          fontSize="11"
                          fontWeight={isSelected ? '700' : '500'}
                          textAnchor="middle"
                        >
                          {shortName}
                        </text>
                        <text x={x} y={230} fill="#94a3b8" fontSize="10" textAnchor="middle">
                          {s.termEarnedCredits} ECTS
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}

          {/* Grade Distribution Breakdown */}
          <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '20px', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#16296e' }}>
              📊 Grade Distribution
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div style={{ background: '#e6f7ec', border: '1px solid #99e0b1', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#137333', fontWeight: 600 }}>🌟 EXCELLENT (A / A-)</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#137333', marginTop: 2 }}>{excellentCount}</div>
                <div style={{ fontSize: '10px', color: '#137333' }}>
                  {data.totalCoursesCount > 0 ? ((excellentCount / data.totalCoursesCount) * 100).toFixed(0) : 0}% of courses
                </div>
              </div>

              <div style={{ background: '#e8f0fe', border: '1px solid #aecbfa', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#1a73e8', fontWeight: 600 }}>👍 GOOD (B+ / B / B-)</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a73e8', marginTop: 2 }}>{goodCount}</div>
                <div style={{ fontSize: '10px', color: '#1a73e8' }}>
                  {data.totalCoursesCount > 0 ? ((goodCount / data.totalCoursesCount) * 100).toFixed(0) : 0}% of courses
                </div>
              </div>

              <div style={{ background: '#fef7e0', border: '1px solid #fce8b2', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#b06000', fontWeight: 600 }}>👌 SATISFACTORY (C+ / C / C-)</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#b06000', marginTop: 2 }}>{satisfactoryCount}</div>
                <div style={{ fontSize: '10px', color: '#b06000' }}>
                  {data.totalCoursesCount > 0 ? ((satisfactoryCount / data.totalCoursesCount) * 100).toFixed(0) : 0}% of courses
                </div>
              </div>

              <div style={{ background: '#f1f3f4', border: '1px solid #dadce0', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#3c4043', fontWeight: 600 }}>✓ PASS (P)</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#3c4043', marginTop: 2 }}>{passedCount}</div>
                <div style={{ fontSize: '10px', color: '#5f6368' }}>
                  {data.totalCoursesCount > 0 ? ((passedCount / data.totalCoursesCount) * 100).toFixed(0) : 0}% of courses
                </div>
              </div>

              {inProgressCount > 0 && (
                <div style={{ background: '#f3e8fd', border: '1px solid #d7aefb', borderRadius: 6, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#8430ce', fontWeight: 600 }}>⏳ IN PROGRESS (IP)</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#8430ce', marginTop: 2 }}>{inProgressCount}</div>
                  <div style={{ fontSize: '10px', color: '#8430ce' }}>current semester</div>
                </div>
              )}
            </div>
          </div>

          {/* Detailed Semester Breakdown List */}
          <div style={{ background: '#fff', border: '1px solid #d2deeb', borderRadius: 8, padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '16px', color: '#16296e' }}>
              🗓️ Semesters Breakdown
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {semesters.map((sem, sIdx) => {
                const isActive = activeSemIdx === sIdx;
                return (
                  <div
                    key={sIdx}
                    style={{
                      border: `1px solid ${isActive ? '#0052cc' : '#e2e8f0'}`,
                      borderRadius: 8,
                      overflow: 'hidden',
                      transition: 'border-color 0.2s'
                    }}
                  >
                    {/* Semester Header Toggle */}
                    <div
                      onClick={() => setActiveSemIdx(isActive ? null : sIdx)}
                      style={{
                        padding: '12px 18px',
                        background: isActive ? '#f0f5ff' : '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '16px' }}>{isActive ? '📂' : '📁'}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>
                            {sem.semester}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {sem.coursesCount} courses · {sem.termEarnedCredits} ECTS earned
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Term GPA</div>
                          <div style={{ fontWeight: 700, fontSize: '15px', color: '#0052cc' }}>
                            {sem.termGpa ? sem.termGpa.toFixed(2) : '—'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Cumulative GPA</div>
                          <div style={{ fontWeight: 700, fontSize: '15px', color: '#137333' }}>
                            {sem.cumulativeGpa ? sem.cumulativeGpa.toFixed(2) : '—'}
                          </div>
                        </div>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{isActive ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Courses in Semester Table */}
                    {isActive && (
                      <div style={{ padding: '12px 18px', background: '#fff' }}>
                        <table className="tbl" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>#</th>
                              <th>Course Code</th>
                              <th>Course Title</th>
                              <th style={{ width: 80, textAlign: 'center' }}>ECTS</th>
                              <th style={{ width: 100, textAlign: 'center' }}>Grade</th>
                              <th style={{ width: 80, textAlign: 'center' }}>Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sem.courses.map((c, cIdx) => {
                              const style = getGradeColor(c.grade);
                              return (
                                <tr key={cIdx}>
                                  <td className="dim c">{cIdx + 1}</td>
                                  <td><b className="code">{c.course_code}</b></td>
                                  <td>{c.course_name}</td>
                                  <td style={{ textAlign: 'center' }}><b>{c.credits}</b></td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      fontWeight: 700,
                                      fontSize: '12px',
                                      background: style.bg,
                                      color: style.text,
                                      border: `1px solid ${style.border}`
                                    }}>
                                      {c.grade}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'center', color: '#555' }}>
                                    {c.gpa_points != null ? Number(c.gpa_points).toFixed(2) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
