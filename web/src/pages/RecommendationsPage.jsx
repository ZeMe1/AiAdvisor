import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { usePlanStore } from '../stores/planStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

// Client-side cache for instant zero-latency page loading (stale-while-revalidate)
let globalRecCache = null;
let globalRecCacheUser = null;

export function clearRecommendationsCache() {
  globalRecCache = null;
  globalRecCacheUser = null;
}

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, profile } = useAuthStore();
  const { plan } = usePlanStore();

  const currentUsername = profile?.username || me?.user?.username || me?.username;
  const hasCachedData = globalRecCache && globalRecCacheUser === currentUsername;

  const [loading, setLoading] = useState(!hasCachedData);
  const [data, setData] = useState(hasCachedData ? globalRecCache : null);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'interested' | 'retake' | 'mandatory' | 'elective'
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'semester' | 'ects' | 'name'
  const [search, setSearch] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState({});

  useEffect(() => {
    let mounted = true;
    if (!hasCachedData) {
      setLoading(true);
    }
    api.recommendations()
      .then((res) => {
        if (mounted) {
          globalRecCache = res;
          globalRecCacheUser = currentUsername;
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          console.error('[RecommendationsPage] Failed to fetch:', err);
          if (!hasCachedData) {
            toast.error('Failed to load recommendations: ' + err.message);
          }
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

  // Category counts for quick filter buttons
  const counts = useMemo(() => {
    return {
      all: allRecommendations.length,
      interested: allRecommendations.filter((c) => c.feedback === true).length,
      retake: allRecommendations.filter((c) => c.isRetake).length,
      mandatory: allRecommendations.filter((c) => c.isMandatory).length,
      elective: allRecommendations.filter((c) => !c.isMandatory).length,
    };
  }, [allRecommendations]);

  // Filtered and sorted eligible courses list
  const filteredCourses = useMemo(() => {
    let list = allRecommendations.filter((c) => {
      if (filterType === 'interested' && c.feedback !== true) return false;
      if (filterType === 'retake' && !c.isRetake) return false;
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

    return list.slice().sort((a, b) => {
      if (sortBy === 'score') return (b.score || 0) - (a.score || 0);
      if (sortBy === 'semester') return (a.semester || 0) - (b.semester || 0) || (b.score || 0) - (a.score || 0);
      if (sortBy === 'ects') return (b.ects || 0) - (a.ects || 0) || (b.score || 0) - (a.score || 0);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
  }, [allRecommendations, filterType, sortBy, search]);

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
   * US19: Give Feedback on Recommendations with Instant Optimistic UI (0ms latency)
   */
  const handleFeedback = (course, isInterested) => {
    if (!data) return;

    // Unique course key
    const courseKey = course.id || (course.code && course.name ? `${course.code}:${course.name}` : course.code);

    // Toggle off if user clicks the already active feedback button
    const targetVal = course.feedback === isInterested ? null : isInterested;

    // QA Scenario 2: Mandatory courses cannot be hidden
    if (targetVal === false && course.isMandatory) {
      toast.warn('Mandatory courses cannot be hidden');
      return;
    }

    // 1. Instant Optimistic Calculation in Memory (< 1ms)
    const interestWeight = Number(data.activeWeights?.interestWeight) || 1.5;
    let nextInterestBoost = 0;
    if (targetVal === true) {
      nextInterestBoost = Math.round(150 + 200 * interestWeight);
    } else if (targetVal === false && !course.isMandatory) {
      nextInterestBoost = -500;
    }

    const updatedAll = data.allRecommendations.map((c) => {
      const cKey = c.id || (c.code && c.name ? `${c.code}:${c.name}` : c.code);
      if (cKey !== courseKey) return c;
      const b = c.scoreBreakdown || { base: 450, retakeBoost: 0, gpaBoost: 0, interestBoost: 0 };
      const newScore = b.base + b.retakeBoost + b.gpaBoost + nextInterestBoost;
      return {
        ...c,
        feedback: targetVal,
        score: newScore,
        scoreBreakdown: {
          ...b,
          interestBoost: nextInterestBoost,
          total: newScore,
        },
      };
    });

    // Re-rank candidates: highest score first, then earliest semester
    const ranked = updatedAll.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || (a.semester || 0) - (b.semester || 0));

    // Re-select recommended set fitting maxEctsLimit
    let accEcts = 0;
    const nextRecSet = [];
    for (const cand of ranked) {
      if (cand.feedback === false && !cand.isMandatory) continue; // Exclude disliked electives
      const cEcts = Number(cand.ects) || 5;
      if (accEcts + cEcts <= (data.maxEctsLimit || 21) || nextRecSet.length === 0) {
        nextRecSet.push(cand);
        accEcts += cEcts;
      }
    }

    const optimisticData = {
      ...data,
      allRecommendations: updatedAll,
      recommendedSet: nextRecSet,
      recommendedEctsTotal: accEcts,
    };

    // Instant UI update (< 1ms)
    setData(optimisticData);
    globalRecCache = optimisticData;

    // Fast feedback notification
    const displayName = course.name || course.code;
    if (targetVal === null) {
      toast.info(`Cleared feedback for ${displayName}`);
    } else if (targetVal === false) {
      toast.info(`Marked "${displayName}" as not interesting`);
    } else {
      toast.success(`Marked "${displayName}" as interested`);
    }

    // 2. Non-blocking asynchronous backend synchronization
    api.submitRecommendationFeedback(course.id || course.code, targetVal, data.targetSemester)
      .catch((err) => {
        console.error('[Feedback sync error]', err);
        toast.error('Failed to sync feedback with server: ' + err.message);
        // Rollback by refreshing from server
        api.recommendations().then((fresh) => {
          setData(fresh);
          globalRecCache = fresh;
        }).catch(console.error);
      });
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

            {data?.activeWeights && (
              <div style={{ background: '#f4f7fa', border: '1px solid var(--line)', padding: '6px 12px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Engine Weights (R/I/G)</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--blue-dark)', marginTop: '2px' }}>
                  {data.activeWeights.retakeWeight}x / {data.activeWeights.interestWeight}x / {data.activeWeights.gpaWeight}x
                </div>
              </div>
            )}

            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontWeight: 600, fontSize: '12.5px', border: '1px solid var(--line)', padding: '8px 12px' }}
              onClick={() => navigate('/simulation')}
              title="Simulate different credit loads and graduation timeline"
            >
              🔮 Simulate 'What-If'
            </button>
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
      ) : data?.isProgramDisabled ? (
        <section
          className="card"
          style={{
            textAlign: 'center',
            padding: '36px 20px',
            border: '2px solid #D9381E',
            backgroundColor: '#fff8f7',
            borderRadius: '8px',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚫</div>
          <h2 style={{ color: '#D9381E', margin: '0 0 8px 0', fontSize: '20px' }}>
            AI Recommendations Disabled for Your Program
          </h2>
          <p style={{ maxWidth: '640px', margin: '0 auto 16px auto', color: '#1c2733', fontSize: '14px', lineHeight: 1.5 }}>
            {data.disabledReason || `AI-driven course recommendations for ${data.studentProgram || 'your study program'} have been disabled by university academic policy.`}
          </p>
          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', backgroundColor: '#fff', border: '1px solid #fad2cf', padding: '6px 14px', borderRadius: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#002B49' }}>Academic Program:</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#D9381E' }}>{data.studentProgram || 'Active Program'}</span>
          </div>
          <p className="muted small" style={{ marginTop: '16px', marginBottom: 0 }}>
            Please consult your assigned academic advisor or refer to the official program curriculum to plan your semester courses.
          </p>
        </section>
      ) : (
        <>
          {/* Recommended Set Section (Respects ECTS Limit & US19 Feedback) */}
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
                  const courseKey = c.id || `${c.code}:${c.name}`;
                  const isBusy = !!feedbackLoading[courseKey];
                  return (
                    <div
                      key={courseKey}
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

                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px', color: '#1c2733' }}>
                          {c.name}
                        </div>

                        {/* AI Score and Factor Badges */}
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
                          <span
                            style={{
                              backgroundColor: '#e8edf2',
                              color: 'var(--blue-dark)',
                              border: '1px solid #b9c4cf',
                              padding: '2px 7px',
                              borderRadius: '3px',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                            title="Overall ranking score calculated by the AI engine"
                          >
                            Score: {c.score}
                          </span>
                          {c.scoreBreakdown?.interestBoost > 0 && (
                            <span
                              style={{
                                backgroundColor: '#e6f4ea',
                                color: '#00773c',
                                border: '1px solid #ceead6',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 600,
                              }}
                              title={`Boost from student interest: +${c.scoreBreakdown.interestBoost} pts`}
                            >
                              ★ Interest +{c.scoreBreakdown.interestBoost}
                            </span>
                          )}
                          {c.scoreBreakdown?.gpaBoost > 0 && (
                            <span
                              style={{
                                backgroundColor: '#f0f4f9',
                                color: '#0070BA',
                                border: '1px solid #d0e1fd',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 600,
                              }}
                              title={`Boost from GPA scaling: +${c.scoreBreakdown.gpaBoost} pts`}
                            >
                              ▲ GPA +{c.scoreBreakdown.gpaBoost}
                            </span>
                          )}
                          {c.isRetake && (
                            <span
                              style={{
                                backgroundColor: '#fce8e6',
                                color: '#c5221f',
                                border: '1px solid #fad2cf',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              ⚡ Retake Priority
                            </span>
                          )}
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

          {/* All Eligible Courses Section with Filters & Sorting */}
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, color: 'var(--blue-dark)' }}>All Eligible Courses for Next Registration</h2>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  Browse every course where your completed prerequisites and academic status qualify you for enrollment.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search code or title..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ padding: '5px 10px', fontSize: '13px', minWidth: 200 }}
                />

                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span className="small muted" style={{ fontWeight: 600, fontSize: '12px' }}>Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid var(--line)' }}
                  >
                    <option value="score">Highest AI Score</option>
                    <option value="semester">Semester (Earliest)</option>
                    <option value="ects">ECTS Load</option>
                    <option value="name">Course Name (A-Z)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Quick Filter Buttons / Tabs */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
              <button
                type="button"
                className={filterType === 'all' ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                onClick={() => setFilterType('all')}
                style={{ fontWeight: 600 }}
              >
                All ({counts.all})
              </button>
              <button
                type="button"
                className={filterType === 'interested' ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                onClick={() => setFilterType('interested')}
                style={{ fontWeight: 600 }}
              >
                👍 Interested ({counts.interested})
              </button>
              {counts.retake > 0 && (
                <button
                  type="button"
                  className={filterType === 'retake' ? 'btn btn-danger btn-mini' : 'btn btn-mini'}
                  onClick={() => setFilterType('retake')}
                  style={{ fontWeight: 600 }}
                >
                  ⚡ Retakes ({counts.retake})
                </button>
              )}
              <button
                type="button"
                className={filterType === 'mandatory' ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                onClick={() => setFilterType('mandatory')}
                style={{ fontWeight: 600 }}
              >
                Mandatory ({counts.mandatory})
              </button>
              <button
                type="button"
                className={filterType === 'elective' ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                onClick={() => setFilterType('elective')}
                style={{ fontWeight: 600 }}
              >
                Electives ({counts.elective})
              </button>
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
                      <th>AI Score & Factors</th>
                      <th>Recommendation Reason</th>
                      <th>Feedback</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCourses.map((c) => {
                      const courseKey = c.id || `${c.code}:${c.name}`;
                      const isBusy = !!feedbackLoading[courseKey];
                      return (
                        <tr key={courseKey}>
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
                          <td className="c">
                            <div style={{ fontWeight: 700, color: 'var(--blue-dark)', fontSize: '13px' }}>
                              {c.score} pts
                            </div>
                            <div style={{ display: 'flex', gap: '3px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '2px' }}>
                              {c.scoreBreakdown?.interestBoost > 0 && (
                                <span style={{ fontSize: '10px', color: '#00773c', fontWeight: 600, backgroundColor: '#e6f4ea', border: '1px solid #ceead6', padding: '1px 4px', borderRadius: '3px' }}>
                                  +{c.scoreBreakdown.interestBoost} int
                                </span>
                              )}
                              {c.scoreBreakdown?.gpaBoost > 0 && (
                                <span style={{ fontSize: '10px', color: '#0070BA', fontWeight: 600, backgroundColor: '#f0f4f9', border: '1px solid #d0e1fd', padding: '1px 4px', borderRadius: '3px' }}>
                                  +{c.scoreBreakdown.gpaBoost} gpa
                                </span>
                              )}
                              {c.isRetake && (
                                <span style={{ fontSize: '10px', color: '#c5221f', fontWeight: 700, backgroundColor: '#fce8e6', border: '1px solid #fad2cf', padding: '1px 4px', borderRadius: '3px' }}>
                                  retake
                                </span>
                              )}
                            </div>
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
