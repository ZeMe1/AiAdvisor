import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function SimulationPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, profile } = useAuthStore();

  const [targetEcts, setTargetEcts] = useState(21);
  const [numSemesters, setNumSemesters] = useState(2);
  const [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState(null);

  // Run simulation whenever targetEcts or numSemesters changes
  const runSimulation = (ectsVal, semsVal) => {
    setLoading(true);
    api.simulateWhatIf({ targetEctsPerSemester: ectsVal, numSemesters: semsVal })
      .then((data) => {
        setSimulation(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[Simulation] Failed to execute simulation:', err);
        toast.error('Simulation error: ' + err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    runSimulation(targetEcts, numSemesters);
  }, [targetEcts, numSemesters]);

  const handlePresetSelect = (ects) => {
    setTargetEcts(ects);
  };

  const handleExitSimulation = () => {
    // QA Scenario 2: When student closes simulation page, data is discarded and real plan remains intact
    navigate('/roadmap');
  };

  const risk = simulation?.risk || { riskLevel: 'Low', riskWarning: 'Low risk', color: '#16a34a' };
  const projection = simulation?.projection;
  const simulatedSemesters = simulation?.simulatedSemesters || [];

  return (
    <main className="page" style={{ maxWidth: 1200, margin: '0 auto', padding: '16px' }}>
      {/* Simulator Control Panel */}
      <section className="card" style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: 'var(--blue-dark)' }}>
          Workload Simulation Parameters
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#1c2733' }}>
                Target ECTS per Semester:
              </span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--blue)' }}>
                {targetEcts} ECTS
              </span>
            </div>

            <input
              type="range"
              min="10"
              max="40"
              step="1"
              value={targetEcts}
              onChange={(e) => setTargetEcts(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', height: '6px' }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              <span>10 ECTS (Part-time)</span>
              <span>20-25 ECTS (Standard)</span>
              <span>40 ECTS (Intensive)</span>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
              Quick Preset Scenarios
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={targetEcts === 12 ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                style={{ fontWeight: 600 }}
                onClick={() => handlePresetSelect(12)}
              >
                Light (12 ECTS)
              </button>
              <button
                type="button"
                className={targetEcts === 15 ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                style={{ fontWeight: 600 }}
                onClick={() => handlePresetSelect(15)}
              >
                Reduced (15 ECTS)
              </button>
              <button
                type="button"
                className={targetEcts === 21 ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                style={{ fontWeight: 600 }}
                onClick={() => handlePresetSelect(21)}
              >
                Standard (21 ECTS)
              </button>
              <button
                type="button"
                className={targetEcts === 25 ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                style={{ fontWeight: 600 }}
                onClick={() => handlePresetSelect(25)}
              >
                Full (25 ECTS)
              </button>
              <button
                type="button"
                className={targetEcts === 30 ? 'btn btn-primary btn-mini' : 'btn btn-mini'}
                style={{ fontWeight: 600 }}
                onClick={() => handlePresetSelect(30)}
              >
                Intensive (30 ECTS)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Projection & Risk Analytics Grid */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        {/* Metric 1: Projected Graduation Term */}
        <div className="card" style={{ borderLeft: '4px solid var(--blue)' }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
            Projected Graduation
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--blue-dark)', marginBottom: '4px' }}>
            {projection?.projectedGraduationTerm || 'Calculating…'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                backgroundColor: projection?.delayInSemesters > 0 ? '#fef2f2' : '#f0fdf4',
                color: projection?.delayInSemesters > 0 ? '#b91c1c' : '#15803d',
                border: `1px solid ${projection?.delayInSemesters > 0 ? '#fca5a5' : '#86efac'}`,
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              {projection?.delayDescription || 'On Schedule'}
            </span>
            <span className="small muted">
              ({projection?.semestersNeeded || 0} semesters remaining)
            </span>
          </div>
        </div>

        {/* Metric 2: Academic Risk Level */}
        <div className="card" style={{ borderLeft: `4px solid ${risk.color || '#16a34a'}` }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
            Academic Overload Risk
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: risk.color || '#16a34a', marginBottom: '4px' }}>
            {risk.riskWarning}
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#1c2733', lineHeight: 1.35 }}>
            {risk.description}
          </p>
        </div>

        {/* Metric 3: Academic Profile & Progress */}
        <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>
            Curriculum Progress
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#1c2733' }}>
              {simulation?.completedEcts || 0} / {simulation?.totalCurriculumEcts || 240} ECTS
            </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--blue)' }}>
              GPA: {simulation?.gpa || '3.20'}
            </span>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, Math.round(((simulation?.completedEcts || 0) / (simulation?.totalCurriculumEcts || 240)) * 100))}%`,
                height: '100%',
                backgroundColor: '#10b981',
                borderRadius: '4px',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
            <span>{simulation?.remainingEcts || 0} ECTS remaining</span>
            <span>Current: Semester {simulation?.currentSemester || 1}</span>
          </div>
        </div>
      </section>

      {/* Simulated Upcoming Semesters Schedule */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--blue-dark)', fontSize: '17px' }}>
              Simulated Study Progression (Next {numSemesters} Semesters)
            </h3>
            <p className="muted small" style={{ margin: '2px 0 0' }}>
              Simulated course allocation honoring prerequisite chaining and university policy limits.
            </p>
          </div>
          <span
            style={{
              backgroundColor: '#f1f5f9',
              border: '1px solid var(--line)',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--blue-dark)',
            }}
          >
            Pace: {targetEcts} ECTS / Semester
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px' }}>
            <p className="muted">Recalculating simulation trajectory…</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
            {simulatedSemesters.map((sem) => (
              <div
                key={sem.semesterIndex}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  backgroundColor: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid var(--line)',
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Simulated Semester {sem.semesterNumber}
                    </span>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--blue-dark)' }}>
                      {sem.termName}
                    </div>
                  </div>
                  <span
                    style={{
                      backgroundColor: '#e0f2fe',
                      color: '#0369a1',
                      border: '1px solid #bae6fd',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {sem.totalEcts} ECTS ({sem.courseCount} courses)
                  </span>
                </div>

                <div style={{ padding: '12px' }}>
                  {sem.courses.length === 0 ? (
                    <p className="muted small" style={{ margin: '10px 0', textAlign: 'center' }}>
                      No eligible courses allocated for this semester budget.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {sem.courses.map((c) => (
                        <div
                          key={c.code}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            backgroundColor: '#fcfcfc',
                            border: '1px solid var(--line)',
                            borderRadius: '4px',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <b className="code" style={{ fontSize: '13px' }}>{c.code}</b>
                              {c.isRetake && (
                                <span
                                  style={{
                                    backgroundColor: '#fee2e2',
                                    color: '#991b1b',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                  }}
                                >
                                  Retake
                                </span>
                              )}
                              {c.isMandatory ? (
                                <span
                                  style={{
                                    backgroundColor: '#e8edf2',
                                    color: 'var(--blue)',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                  }}
                                >
                                  Mandatory
                                </span>
                              ) : (
                                <span
                                  style={{
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                  }}
                                >
                                  Elective
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '12.5px', color: '#1c2733', marginTop: '2px', fontWeight: 500 }}>
                              {c.name}
                            </div>
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#00773c' }}>
                            {c.ects} ECTS
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
