import React from 'react';

const ST_CLASS = {
  passed: 'st-passed',
  taken: 'st-taken',
  failed: 'st-failed',
  not_taken: 'st-not-taken',
  unknown: 'st-unknown',
};

function CourseRow({ course, index, onChoose }) {
  const chooseable = Boolean(course.sectionsParams) || course.isElective;
  return (
    <tr className={ST_CLASS[course.status] ?? 'st-unknown'}>
      <td className="dim c">{index + 1}</td>
      <td className="code">
        {course.code}
        {course.lastTaken && <span className="dim small"> {course.lastTaken}</span>}
      </td>
      <td>
        {course.name}
        {course.isElective && course.elective && (
          <div className="small muted">
            элективная группа · {course.elective.candidateCodes.length} курсов на выбор
          </div>
        )}
      </td>
      <td className="c">{course.hours.teor}</td>
      <td className="c">{course.hours.practice}</td>
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

/** Куррикулум по семестрам — как «From your program» на портале. */
export default function Curriculum({ curriculum, onChoose }) {
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
            <div className="sum-ects">Семестр {sem.no} · Sum ECTS: <b>{sumEcts}</b></div>
          </div>
        );
      })}
    </section>
  );
}
