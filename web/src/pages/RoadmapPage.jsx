import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';
import { useScheduleStore } from '../stores/scheduleStore.js';
import { api } from '../api.js';
import EligibilityBadge from '../shared/ui/EligibilityBadge.jsx';

export default function RoadmapPage() {
  const navigate = useNavigate();
  const { me, profile } = useAuthStore();
  const { curriculum, loadCurriculum, eligibilityMap, loadEligibility } = useScheduleStore();

  const [roadmapList, setRoadmapList] = useState([]);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState('sdu');
  const [selectedCourse, setSelectedCourse] = useState(null);

  const currentUsername = profile?.username || me?.user?.username || me?.username;

  useEffect(() => {
    let mounted = true;
    api.roadmap()
      .then((res) => {
        if (mounted && Array.isArray(res?.curriculums) && res.curriculums.length > 0) {
          setRoadmapList(res.curriculums);
          // Default to the primary SDU portal curriculum
          const defaultCurriculum = res.curriculums.find((c) => c.is_default || c.id === 'sdu') || res.curriculums[0];
          setSelectedCurriculumId(defaultCurriculum.id);
        }
      })
      .catch((err) => {
        console.warn('[Roadmap] Fallback to default curriculum:', err.message);
      });
    return () => { mounted = false; };
  }, [currentUsername]);

  useEffect(() => {
    loadCurriculum(true).catch(console.error);
    if (!eligibilityMap || Object.keys(eligibilityMap).length === 0) {
      loadEligibility().catch(console.error);
    }
  }, [currentUsername, loadCurriculum, eligibilityMap, loadEligibility]);

  const activeCurriculum = useMemo(() => {
    if (roadmapList.length > 0) {
      const found = roadmapList.find((c) => String(c.id) === String(selectedCurriculumId));
      if (found) return found;
      return roadmapList[0];
    }
    return curriculum;
  }, [roadmapList, selectedCurriculumId, curriculum]);

  const semesters = activeCurriculum?.semesters ?? [];

  // Вычисляем ECTS прогресс
  const { completedEcts, inProgressEcts, totalEcts, currentSemesterNo } = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let total = 0;
    let currentSem = 1;

    for (const sem of semesters) {
      for (const c of sem.courses) {
        const ectsNum = Number(c.ects) || 0;
        total += ectsNum;
        if (c.status === 'passed') {
          completed += ectsNum;
        } else if (c.status === 'taken' || c.grade === 'IP') {
          inProgress += ectsNum;
          if (sem.no > currentSem) currentSem = sem.no;
        }
      }
    }

    // Если нет курсов taken, берем первый семестр, где есть не сданные предметы
    if (inProgress === 0) {
      const firstIncomplete = semesters.find((s) => s.courses.some((c) => c.status !== 'passed'));
      if (firstIncomplete) currentSem = firstIncomplete.no;
    }

    return {
      completedEcts: completed,
      inProgressEcts: inProgress,
      totalEcts: total || 240,
      currentSemesterNo: currentSem,
    };
  }, [semesters]);

  const progressPercent = Math.min(Math.round((completedEcts / totalEcts) * 100), 100);

  // Вычисление статуса курса для Roadmap
  const getCourseRoadmapStatus = (course) => {
    if (course.status === 'passed') return 'passed';
    if (course.status === 'taken' || course.grade === 'IP') return 'taken';

    const eligibility = eligibilityMap?.[course.code?.toUpperCase().trim()];
    if (eligibility?.status === 'not_eligible') return 'locked';
    if (eligibility?.status === 'corequisite') return 'corequisite';
    return 'available';
  };

  const handleCourseClick = (course, status, eligibility) => {
    setSelectedCourse({ course, status, eligibility });
  };

  const closeModal = () => setSelectedCourse(null);

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <button className="btn" onClick={() => navigate('/')} style={{ marginRight: '1rem' }}>
            ← Back to Courses
          </button>
          <h1 style={{ display: 'inline-block', margin: 0, fontSize: '1.4rem' }}>
            Curriculum Roadmap
          </h1>
          {activeCurriculum?.program?.title && (
            <div className="muted small" style={{ marginTop: '4px' }}>
              {activeCurriculum.program.title} {activeCurriculum.program.track && `· ${activeCurriculum.program.track}`}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge" style={{ backgroundColor: '#e6f4ea', color: '#137333', border: '1px solid #ceead6', padding: '4px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600 }}>
            ● Completed: {completedEcts} ECTS
          </span>
          <span className="badge" style={{ backgroundColor: '#fef7e0', color: '#b06000', border: '1px solid #feefc3', padding: '4px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600 }}>
            ● In Progress: {inProgressEcts} ECTS
          </span>
          <span className="badge" style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', padding: '4px 10px', borderRadius: 12, fontSize: '12px', fontWeight: 600 }}>
            Degree Goal: {totalEcts} ECTS
          </span>
        </div>
      </div>

      {/* Curriculum Switcher (if user has custom assigned curriculums) */}
      {roadmapList.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            padding: '10px 14px',
            backgroundColor: '#f8f9fa',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#4a5568' }}>
            📚 Select Curriculum ({roadmapList.length}/3 max):
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {roadmapList.map((c) => {
              const isSelected = String(selectedCurriculumId) === String(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={isSelected ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                  onClick={() => setSelectedCurriculumId(c.id)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '12.5px',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {c.is_default ? `🏛️ ${c.title}` : `📋 ${c.title}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Прогресс-бар степени */}
      <section className="card" style={{ padding: '16px', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
          <span><b>Degree Progress:</b> {completedEcts} of {totalEcts} ECTS completed</span>
          <span style={{ fontWeight: 600, color: 'var(--blue)' }}>{progressPercent}%</span>
        </div>
        <div style={{ width: '100%', height: '10px', backgroundColor: '#e0e0e0', borderRadius: '5px', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${progressPercent}%`, backgroundColor: '#34a853', transition: 'width 0.4s' }} />
          <div style={{ width: `${Math.min((inProgressEcts / totalEcts) * 100, 100 - progressPercent)}%`, backgroundColor: '#fbbc04', transition: 'width 0.4s' }} />
        </div>
        <div className="legend" style={{ marginTop: '12px', justifyContent: 'flex-start', gap: '16px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#34a853' }} /> Completed
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#fbbc04' }} /> In Progress
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#1a73e8' }} /> Eligible
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#80868b' }} /> 🔒 Locked (Prerequisites Missing)
          </span>
        </div>
      </section>

      {/* Сетка семестров */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', alignItems: 'start' }}>
        {semesters.map((sem) => {
          const isCurrentSem = sem.no === currentSemesterNo;
          const semEcts = sem.courses.reduce((a, c) => a + (Number(c.ects) || 0), 0);

          return (
            <div
              key={sem.no}
              className="card"
              style={{
                margin: 0,
                padding: '14px',
                border: isCurrentSem ? '2px solid #1a73e8' : '1px solid var(--line)',
                boxShadow: isCurrentSem ? '0 4px 12px rgba(26, 115, 232, 0.15)' : 'none',
                backgroundColor: isCurrentSem ? '#fafcff' : '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid #edf2f7', paddingBottom: '8px' }}>
                <div>
                  <strong style={{ fontSize: '1.05rem', color: isCurrentSem ? '#1a73e8' : 'inherit' }}>
                    Semester {sem.no}
                  </strong>
                  {isCurrentSem && (
                    <span style={{ marginLeft: '8px', padding: '2px 6px', borderRadius: 4, backgroundColor: '#1a73e8', color: '#fff', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                      Current
                    </span>
                  )}
                </div>
                <span className="muted small">{semEcts} ECTS</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sem.courses.map((course, idx) => {
                  const status = getCourseRoadmapStatus(course);
                  const eligibility = eligibilityMap?.[course.code?.toUpperCase().trim()];
                  const isLocked = status === 'locked';
                  const isPassed = status === 'passed';
                  const isTaken = status === 'taken';

                  // Стили карточки предмета
                  let borderColor = '#dadce0';
                  let bgColor = '#ffffff';
                  let textColor = '#202124';

                  if (isPassed) {
                    borderColor = '#ceead6';
                    bgColor = '#f6fbf7';
                    textColor = '#137333';
                  } else if (isTaken) {
                    borderColor = '#feefc3';
                    bgColor = '#fffdf6';
                    textColor = '#b06000';
                  } else if (isLocked) {
                    borderColor = '#e8eaed';
                    bgColor = '#f8f9fa';
                    textColor = '#5f6368';
                  } else {
                    borderColor = '#d2e3fc';
                    bgColor = '#ffffff';
                    textColor = '#1a73e8';
                  }

                  return (
                    <div
                      key={course.code + idx}
                      onClick={() => handleCourseClick(course, status, eligibility)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${borderColor}`,
                        backgroundColor: bgColor,
                        cursor: 'pointer',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: isLocked ? '#5f6368' : textColor }}>
                          {course.code}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {isPassed && <span style={{ fontSize: '11px', fontWeight: 700, color: '#137333' }}>{course.grade || 'Passed'}</span>}
                          {isTaken && <span style={{ fontSize: '11px', fontWeight: 700, color: '#b06000' }}>In Progress</span>}
                          {isLocked && <span style={{ fontSize: '11px', color: '#c5221f' }}>🔒 Locked</span>}
                          {!isPassed && !isTaken && !isLocked && <span style={{ fontSize: '11px', color: '#1a73e8' }}>● Eligible</span>}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.82rem', color: '#3c4043', lineHeight: 1.3, marginBottom: '4px' }}>
                        {course.name}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#80868b' }}>
                        <span>{course.ects} ECTS</span>
                        {course.requisites && course.requisites !== 'None' && (
                          <span title={`Prerequisites: ${course.requisites}`}>Req: {course.requisites}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Модальное окно детализации курса (View-only для заблокированных курсов) */}
      {selectedCourse && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
            backdropFilter: 'blur(2px)',
          }}
          onClick={closeModal}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '540px',
              padding: '24px',
              margin: 0,
              boxShadow: '0 12px 36px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <span className="code" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  {selectedCourse.course.code}
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: '1.1rem' }}>{selectedCourse.course.name}</h3>
              </div>
              <button className="btn btn-ghost" onClick={closeModal} style={{ fontSize: '1.2rem', padding: '2px 8px' }}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', margin: '12px 0 16px', flexWrap: 'wrap' }}>
              <span className="badge" style={{ backgroundColor: '#f1f3f4', padding: '4px 8px', borderRadius: 4, fontSize: '12px' }}>
                ECTS: <b>{selectedCourse.course.ects}</b>
              </span>
              <span className="badge" style={{ backgroundColor: '#f1f3f4', padding: '4px 8px', borderRadius: 4, fontSize: '12px' }}>
                Hours: <b>{selectedCourse.course.hours?.teor || 2}+{selectedCourse.course.hours?.practice || 1}</b>
              </span>
              {selectedCourse.course.grade && (
                <span className="badge" style={{ backgroundColor: '#e6f4ea', color: '#137333', padding: '4px 8px', borderRadius: 4, fontSize: '12px' }}>
                  Grade: <b>{selectedCourse.course.grade}</b>
                </span>
              )}
            </div>

            {/* Блок для заблокированного курса (US15 Scenario 2: View-only mode with missing prerequisites) */}
            {selectedCourse.status === 'locked' && (
              <div
                style={{
                  backgroundColor: '#fef7f6',
                  border: '1px solid #fad2cf',
                  borderLeft: '4px solid #ea4335',
                  padding: '14px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c5221f', fontWeight: 600, marginBottom: '6px' }}>
                  <span>🔒 Course is Locked (Prerequisites Not Met)</span>
                </div>
                <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#5f6368' }}>
                  You cannot register for this course yet. The following prerequisite courses must be completed first:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(selectedCourse.eligibility?.missingPrerequisites || []).map((m) => (
                    <div
                      key={m.code}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #fad2cf',
                        borderRadius: 4,
                        fontSize: '12.5px',
                      }}
                    >
                      <div>
                        <strong>{m.code}</strong> · Min grade required: <b>{m.minGrade || 'D'}</b>
                      </div>
                      <button
                        className="btn btn-sm"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        onClick={() => {
                          closeModal();
                          navigate(`/courses/${encodeURIComponent(m.code)}`);
                        }}
                      >
                        View {m.code} →
                      </button>
                    </div>
                  ))}
                  {(!selectedCourse.eligibility?.missingPrerequisites || selectedCourse.eligibility.missingPrerequisites.length === 0) && (
                    <div style={{ fontSize: '12px', color: '#5f6368' }}>
                      Prerequisite requirement: {selectedCourse.course.requisites || 'Required prior courses'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Блок для успешно сданного курса */}
            {selectedCourse.status === 'passed' && (
              <div style={{ backgroundColor: '#f6fbf7', border: '1px solid #ceead6', padding: '12px', borderRadius: 6, marginBottom: '16px', color: '#137333', fontSize: '13px' }}>
                ✓ You have successfully completed this course with grade <b>{selectedCourse.course.grade || 'Passed'}</b>.
              </div>
            )}

            {/* Блок для изучаемого сейчас курса */}
            {selectedCourse.status === 'taken' && (
              <div style={{ backgroundColor: '#fffdf6', border: '1px solid #feefc3', padding: '12px', borderRadius: 6, marginBottom: '16px', color: '#b06000', fontSize: '13px' }}>
                ● You are currently taking this course in the active semester.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="btn" onClick={closeModal}>
                Close
              </button>

              {/* Кнопка регистрации доступна ТОЛЬКО если курс не Locked и не Passed */}
              {selectedCourse.status === 'available' && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    closeModal();
                    if (selectedCourse.course.isElective) {
                      navigate(`/electives/${encodeURIComponent(selectedCourse.course.code)}`);
                    } else {
                      navigate(`/courses/${encodeURIComponent(selectedCourse.course.code)}`);
                    }
                  }}
                >
                  Plan this Course →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
