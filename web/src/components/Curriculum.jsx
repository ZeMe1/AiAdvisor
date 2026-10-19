import React from 'react';

const ST_CLASS = {
  passed: 'st-passed',
  taken: 'st-taken',
  failed: 'st-failed',
  not_taken: 'st-not-taken',
  unknown: 'st-unknown',
};

function getTermLabel(semNo, startYear = 2024) {
  const no = Number(semNo);
  if (!no || no < 1) return '';
  const yearOffset = Math.floor((no - 1) / 2);
  const isFall = no % 2 === 1;
  const year = startYear + yearOffset;
  return isFall ? `(Fall ${year})` : `(Spring ${year + 1})`;
}

function CourseRow({ course, index, onChoose }) {
  const chooseable = Boolean(course.sectionsParams) || course.isElective || course.isCustom;
  return (
    <tr className={ST_CLASS[course.status] ?? 'st-unknown'}>
      <td className="dim c">{index + 1}</td>
      <td className="code">
        {course.code}
        {course.lastTaken && <span className="dim small"> {course.lastTaken}</span>}
      </td>
      <td>
        <div>{course.name}</div>
        {course.isElective && course.elective && (
          <div className="small muted">
            elective group · {course.elective.candidateCodes.length} elective choices
          </div>
        )}
      </td>
      <td className="c">{course.hours?.teor ?? 2}</td>
      <td className="c">{course.hours?.practice ?? '0+2'}</td>
      <td className="c">{course.credits}</td>
      <td className="c">{course.ects}</td>
      <td className="c">{course.grade ?? ''}</td>
      <td className="c">
        {chooseable && (
          <button className="btn" onClick={() => onChoose(course)}>Choose</button>
        )}
      </td>
    </tr>
  );
}

/** Semester curriculum breakdown — mirrors "From your program" on the portal. */
export default function Curriculum({ curriculum, onChoose }) {
  const titleYearMatch = String(curriculum.program?.title || '').match(/\b(20\d\d)\b/);
  const startYear = titleYearMatch ? parseInt(titleYearMatch[1], 10) : 2024;

  return (
    <section className="card">
      <h2 className="prog-title">
        {curriculum.program.title}
        {curriculum.program.track && <span className="prog-track">{curriculum.program.track}</span>}
      </h2>
      <div className="legend legend-status">
        <span className="st-failed">Failed</span><span className="st-not-taken">Not Taken</span>
        <span className="st-passed">Passed</span><span className="st-taken">Taken</span>
      </div>
      {curriculum.semesters.map((sem) => {
        const sumEcts = sem.courses.reduce((a, c) => a + (Number(c.ects) || 0), 0);
        return (
          <div className="semester" key={sem.no}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>№</th><th>course code</th><th>name</th><th>teor</th><th>pr</th>
                  <th>cr</th><th>ects</th><th>grade</th><th>status</th>
                </tr>
              </thead>
              <tbody>
                {sem.courses.map((c, i) => (
                  <CourseRow key={c.code + i} course={c} index={i} onChoose={onChoose} />
                ))}
              </tbody>
            </table>
            <div className="sum-ects">
              Semester {sem.no} <span style={{ color: '#0052cc', fontWeight: 600 }}>{getTermLabel(sem.no, startYear)}</span> · Sum ECTS: <b>{sumEcts}</b>
            </div>
          </div>
        );
      })}
    </section>
  );
}
