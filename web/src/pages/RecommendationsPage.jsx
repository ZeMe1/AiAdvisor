import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { usePlanStore } from '../stores/planStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, profile } = useAuthStore();
  const { plan } = usePlanStore();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'mandatory' | 'elective'
  const [search, setSearch] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState({});

  const currentUsername = profile?.username || me?.user?.username || me?.username;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.recommendations()
      .then((res) => {
        if (mounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          console.error('[RecommendationsPage] Failed to fetch:', err);
          toast.error('Failed to load recommendations: ' + err.message);
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, [currentUsername]);

  const recommendedSet = data?.recommendedSet || [];
  const allRecommendations = data?.allRecommendations || [];
  const maxLimit = data?.maxEctsLimit || 21;
  const recommendedEcts = data?.recommendedEctsTotal || 0;

  // Calculate current planned ECTS from basket + local plan
  const basketCourses = me?.approved || [];
  const plannedEcts = useMemo(() => {
    const basketSum = basketCourses.reduce((sum, c) => sum + (Number(c.ects) || 5), 0);
    const localPlanSum = plan.reduce((sum, p) => sum + 5, 0); // standard 5 ects
    return basketSum + localPlanSum;
  }, [basketCourses, plan]);

  const isOverLimit = plannedEcts > maxLimit;

  // Filtered all eligible courses
  const filteredCourses = useMemo(() => {
    return allRecommendations.filter((c) => {
      if (filterType === 'mandatory' && !c.isMandatory) return false;
      if (filterType === 'elective' && c.isMandatory) return false;
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        return (
          c.code.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query) ||
          (c.reason && c.reason.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [allRecommendations, filterType, search]);

  const handleOpenCourse = (c) => {
    const isElective = c.elective || /^XXX/i.test(c.code);
    if (isElective && c.elective?.mufSqId) {
      navigate(`/electives/${encodeURIComponent(c.code)}?mufSqId=${encodeURIComponent(c.elective.mufSqId)}`);
    } else {
      const mufSqId = c.sectionsParams?.mufSqId;
      navigate(`/courses/${encodeURIComponent(c.code)}${mufSqId ? `?mufSqId=${encodeURIComponent(mufSqId)}` : ''}`);
    }
  };

  /**
   * US19: Give Feedback on Recommendations (👍 Like / 👎 Dislike)
   */
  const handleFeedback = async (course, isInterested) => {
    setFeedbackLoading((prev) => ({ ...prev, [course.code]: true }));
    try {
      const res = await api.submitRecommendationFeedback(course.code, isInterested, data?.targetSemester);

      // QA Scenario 2: Student marks a mandatory course as not interesting
      if (isInterested === false && course.isMandatory) {
        toast.warn('Mandatory courses cannot be hidden');
        setFeedbackLoading((prev) => ({ ...prev, [course.code]: false }));
        return;
      }

      // QA Scenario 1: Student marks an optional course as not interesting -> hides card
      if (isInterested === false) {
        toast.info(`Marked "${course.code}" as not interesting`);
      } else {
        toast.success(`Marked "${course.code}" as interested`);
      }

      // Update in-memory state
      setData((prev) => {
        if (!prev) return prev;
        const updatedAll = prev.allRecommendations.map((c) =>
          c.code === course.code ? { ...c, feedback: isInterested } : c
        );

        // If not interested and not mandatory, remove from recommended set
        const updatedSet = (isInterested === false && !course.isMandatory)
          ? prev.recommendedSet.filter((c) => c.code !== course.code)
          : prev.recommendedSet.map((c) => (c.code === course.code ? { ...c, feedback: isInterested } : c));

        return {
          ...prev,
          allRecommendations: updatedAll,
          recommendedSet: updatedSet,
          recommendedEctsTotal: updatedSet.reduce((sum, c) => sum + (c.ects || 5), 0),
        };
      });
    } catch (err) {
      toast.error('Failed to submit feedback: ' + err.message);
    } finally {
      setFeedbackLoading((prev) => ({ ...prev, [course.code]: false }));
    }
  };

  return (
    <main className="page" style={{ maxWidth: 1280, margin: '0 auto', padding: '14px' }}>
      {/* Top Banner / Academic Snapshot */}
      <section className="card" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '20px' }}>💡</span>
              <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--blue-dark)' }}>Personalized Course Recommendations</h2>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              AI-driven course suggestions tailored to your academic standing, completed prerequisites, and curriculum requirements.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ background: '#f4f7fa', border: '1px solid var(--line)', padding: '6px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Cumulative GPA</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--blue)' }}>
                {data?.gpa ? Number(data.gpa).toFixed(2) : '3.20'}
              </div>
            </div>

            <div style={{ background: '#f4f7fa', border: '1px solid var(--line)', padding: '6px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Target Semester</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#00773c' }}>
                Semester {data?.targetSemester || 1}
              </div>
            </div>

            <div style={{ background: '#f4f7fa', border: '1px solid var(--line)', padding: '6px 14px', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Recommended Load</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--blue-dark)' }}>
                {recommendedEcts} / {maxLimit} <span style={{ fontSize: '12px', fontWeight: 600 }}>ECTS</span>
              </div>
            </div>
          </div>
        </div>

        {/* ECTS Overload Warning */}
        {isOverLimit && (
          <div className="banner-warn" style={{ marginTop: '10px' }}>
            ⚠ <b>ECTS Limit Warning:</b> Your current planned registration ({plannedEcts} ECTS) exceeds the recommended limit of {maxLimit} ECTS per semester.
          </div>
        )}
      </section>

      {loading ? (
        <section className="card" style={{ textAlign: 'center', padding: '28px' }}>
          <p className="muted">Analyzing your curriculum, prerequisites, and GPA…</p>
        </section>
      ) : (
        <>
          {/* Recommended Set Section (Respects 21 ECTS Limit & US19 Feedback) */}
          <section className="card" style={{ marginBottom: '14px', borderLeft: '4px solid var(--blue)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--blue-dark)' }}>
                  <span>⭐</span> Recommended Study Set ({recommendedEcts} ECTS)
                </h2>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  Optimal set of core requirements and eligible courses within the {maxLimit} ECTS semester limit.
                </p>
              </div>
              <span
                style={{
                  backgroundColor: '#e8edf2',
                  color: 'var(--blue-dark)',
                  border: '1px solid var(--line)',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {recommendedSet.length} courses suggested
              </span>
            </div>

            {recommendedSet.length === 0 ? (
              <p className="muted">No eligible recommendations found for the upcoming semester.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                {recommendedSet.map((c) => {
                  const isBusy = !!feedbackLoading[c.code];
                  return (
                    <div
                      key={c.code}
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        backgroundColor: '#fff',
                        boxShadow: '0 1px 2px rgba(22, 41, 110, .06)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', gap: '8px' }}>
                          <span className="code" style={{ fontSize: '15px' }}>
                            {c.code}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {c.isMandatory ? (
                              <span
                                style={{
                                  backgroundColor: '#e8edf2',
                                  color: 'var(--blue)',
                                  border: '1px solid #b9c4cf',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                Mandatory
                              </span>
                            ) : (
                              <span
                                style={{
                                  backgroundColor: '#f4f7fa',
                                  color: '#1c2733',
                                  border: '1px solid var(--line)',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}
                              >
                                Elective
                              </span>
                            )}

                            {c.isRetake && (
                              <span
                                style={{
                                  backgroundColor: '#f6c9c9',
                                  color: '#7c1a1a',
                                  border: '1px solid #d98a8a',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                Retake
                              </span>
                            )}

                            <span
                              style={{
                                backgroundColor: '#e6f4ea',
                                color: '#00773c',
                                border: '1px solid #ceead6',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              {c.ects} ECTS
                            </span>
                          </div>
                        </div>

                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', color: '#1c2733' }}>
                          {c.name}
                        </div>

                        {/* High-contrast, theme-consistent reason block */}
                        <div
                          style={{
                            backgroundColor: '#f4f7fa',
                            border: '1px solid var(--line)',
                            borderLeft: '4px solid var(--blue)',
                            padding: '8px 10px',
                            borderRadius: '4px',
                            fontSize: '12.5px',
                            color: '#1c2733',
                            marginBottom: '10px',
                            lineHeight: 1.45,
                          }}
                        >
                          <b style={{ color: 'var(--blue-dark)' }}>Reason:</b> {c.reason}
                        </div>
                      </div>

                      {/* US19 Feedback Buttons & Actions with clear, high-contrast buttons */}
                      <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontSize: '12px', color: '#1c2733', fontWeight: 600 }}>Rate:</span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              className={c.feedback === true ? 'btn btn-mini btn-primary' : 'btn btn-mini'}
                              disabled={isBusy}
                              title="Interested in taking this course"
                              onClick={() => handleFeedback(c, true)}
                              style={{ fontWeight: 600 }}
                            >
                              👍 Interested
                            </button>
                            <button
                              type="button"
                              className={c.feedback === false ? 'btn btn-mini btn-danger' : 'btn btn-mini'}
                              disabled={isBusy}
                              title={c.isMandatory ? 'Mandatory courses cannot be hidden' : 'Not interested in taking this course'}
                              onClick={() => handleFeedback(c, false)}
                              style={{ fontWeight: 600 }}
                            >
                              👎 Not interesting
                            </button>
                          </div>
                        </div>

                        <button
                          className="btn btn-primary"
                          style={{ width: '100%', padding: '5px 0', fontSize: '13px' }}
                          onClick={() => handleOpenCourse(c)}
                        >
                          View & Select Section →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* All Eligible Courses Section */}
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--blue-dark)' }}>All Eligible Courses for Next Registration</h2>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  Browse every course where your completed prerequisites and academic status qualify you for enrollment.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Filter by code or title..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: '4px 10px', fontSize: '13px', minWidth: 200 }}
                />

                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--line)' }}
                >
                  <option value="all">All Types</option>
                  <option value="mandatory">Mandatory Only</option>
                  <option value="elective">Electives Only</option>
                </select>
              </div>
            </div>

            {filteredCourses.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: '24px' }}>
                No courses match the selected filters.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Course Name</th>
                      <th>Semester</th>
                      <th>ECTS</th>
                      <th>Type</th>
                      <th>Recommendation Reason</th>
                      <th>Feedback</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCourses.map((c) => {
                      const isBusy = !!feedbackLoading[c.code];
                      return (
                        <tr key={c.code}>
                          <td><b className="code">{c.code}</b></td>
                          <td><b style={{ color: '#1c2733' }}>{c.name}</b></td>
                          <td className="c" style={{ color: '#1c2733' }}>Semester {c.semester}</td>
                          <td className="c" style={{ color: '#00773c', fontWeight: 700 }}>{c.ects}</td>
                          <td className="c">
                            {c.isMandatory ? (
                              <span
                                style={{
                                  backgroundColor: '#e8edf2',
                                  color: 'var(--blue)',
                                  border: '1px solid #b9c4cf',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                Mandatory
                              </span>
                            ) : (
                              <span
                                style={{
                                  backgroundColor: '#f4f7fa',
                                  color: '#1c2733',
                                  border: '1px solid var(--line)',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}
                              >
                                Elective
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: '12.5px', color: '#1c2733', lineHeight: 1.4 }}>{c.reason}</td>
                          <td className="c">
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                              <button
                                type="button"
                                className={c.feedback === true ? 'btn btn-mini btn-primary' : 'btn btn-mini'}
                                disabled={isBusy}
                                title="Interested"
                                onClick={() => handleFeedback(c, true)}
                                style={{ padding: '2px 6px', fontSize: '12px' }}
                              >
                                👍
                              </button>
                              <button
                                type="button"
                                className={c.feedback === false ? 'btn btn-mini btn-danger' : 'btn btn-mini'}
                                disabled={isBusy}
                                title="Not interesting"
                                onClick={() => handleFeedback(c, false)}
                                style={{ padding: '2px 6px', fontSize: '12px' }}
                              >
                                👎
                              </button>
                            </div>
                          </td>
                          <td className="c">
                            <button
                              className="btn btn-primary btn-mini"
                              style={{ padding: '3px 8px', fontSize: '12px' }}
                              onClick={() => handleOpenCourse(c)}
                            >
                              Choose
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
