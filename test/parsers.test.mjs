import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCurriculumHtml } from '../src/sdu/parsers/curriculum.js';
import { parseSectionsResponse, parseCourseInfoHtml } from '../src/sdu/parsers/sections.js';
import { parseCourseRegPage } from '../src/sdu/parsers/registrations.js';
import { parseElectivesResponse } from '../src/sdu/parsers/electives.js';
import { parseSchedule, num, splitIds } from '../src/sdu/parsers/normalize.js';

describe('SDU Normalizers', () => {
  it('parseSchedule correctly parses day and time strings', () => {
    expect(parseSchedule('')).toEqual([]);
    expect(parseSchedule('1.08:30,2.14:30')).toEqual([
      { day: 1, time: '08:30' },
      { day: 2, time: '14:30' },
    ]);
    expect(parseSchedule('4.9:30')).toEqual([{ day: 4, time: '09:30' }]);
  });

  it('splitIds splits comma separated strings', () => {
    expect(splitIds('101, 102,103 ')).toEqual(['101', '102', '103']);
    expect(splitIds(null)).toEqual([]);
  });

  it('num parses numbers safely with fallback to 0', () => {
    expect(num('42')).toBe(42);
    expect(num('abc')).toBe(0);
    expect(num(null)).toBe(0);
  });
});

describe('SDU Curriculum Parser', () => {
  it('parses curriculum HTML fixture accurately', () => {
    const html = fs.readFileSync(path.resolve('test/fixtures/curriculum.fixture.html'), 'utf8');
    const result = parseCurriculumHtml(html);

    expect(result.program.year).toBe(2024);
    expect(result.program.name).toBe('Information Systems (EN)');
    expect(result.program.track).toBe('Main Track');
    expect(result.semesters).toHaveLength(1);

    const sem1 = result.semesters[0];
    expect(sem1.courses).toHaveLength(3);

    const [css101, mde171, elective] = sem1.courses;
    expect(css101.code).toBe('CSS 101');
    expect(css101.credits).toBe('3');
    expect(css101.sectionsParams?.dk).toBe('CSS 101');

    expect(mde171.status).toBe('passed');
    expect(mde171.grade).toBe('B+');

    expect(elective.isElective).toBe(true);
    expect(elective.elective?.candidateCodes).toEqual(['TUR 101', 'GER 101']);
    expect(elective.elective?.groupName).toBe('Foreign Language 1');
  });
});

describe('SDU Sections Parser', () => {
  it('parses sections JSON fixture correctly', () => {
    const json = JSON.parse(fs.readFileSync(path.resolve('test/fixtures/sections.fixture.json'), 'utf8'));
    const result = parseSectionsResponse(json);

    expect(result.course.code).toBe('CSS 101');
    expect(result.course.ects).toBe(5);
    expect(result.depCode).toBe('CSS');
    expect(result.progCode).toBe('IS');

    expect(result.theory).toHaveLength(1);
    const theory = result.theory[0];
    expect(theory.section).toBe('01');
    expect(theory.teacher).toBe('Dr. Alan Turing');
    expect(theory.seatsLeft).toBe(5);
    expect(theory.isAvailable).toBe(true);
    expect(theory.schedule).toEqual([
      { day: 1, time: '08:30' },
      { day: 1, time: '09:30' },
    ]);
    expect(theory.practiceIds).toEqual(['2001', '2002']);

    expect(result.practice).toHaveLength(1);
    const practice = result.practice[0];
    expect(practice.section).toBe('01');
    expect(practice.teacher).toBe('Ada Lovelace');
    expect(practice.seatsLeft).toBe(5);
  });
});

describe('SDU Registrations Parser', () => {
  it('parses registration page fixture', () => {
    const html = fs.readFileSync(path.resolve('test/fixtures/course-reg.fixture.html'), 'utf8');
    const result = parseCourseRegPage(html);

    expect(result.authenticated).toBe(true);
    expect(result.term).toBe('2026 - 2027 Fall');
    expect(result.isApproved).toBe(true);
    expect(result.track?.id).toBe('999');
    expect(result.approved).toHaveLength(1);

    const c = result.approved[0];
    expect(c.code).toBe('CSS 101');
    expect(c.normalSection).toBe('01');
    expect(c.normalTeacher).toBe('Dr. Alan Turing');
    expect(c.practiceSection).toBe('01');
    expect(c.practiceTeacher).toBe('Ada Lovelace');
  });
});

describe('SDU Electives Parser', () => {
  it('falls back to candidates list when portal response is empty', () => {
    const result = parseElectivesResponse({ CODE: 0 }, ['TUR 101', 'GER 101']);
    expect(result.fromPortal).toBe(false);
    expect(result.courses).toEqual([
      { code: 'TUR 101', name: '' },
      { code: 'GER 101', name: '' },
    ]);
  });
});
