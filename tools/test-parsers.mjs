/** Прогон парсеров по реальным дампам зонда. Запуск: node tools/test-parsers.mjs [dumps/<папка>] */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseCurriculumHtml } from '../src/sdu/parsers/curriculum.js';
import { parseSectionsResponse } from '../src/sdu/parsers/sections.js';
import { parseCourseRegPage } from '../src/sdu/parsers/registrations.js';

const dir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('dumps', fs.readdirSync('dumps').sort().pop());
console.log(`# Дампы: ${dir}\n`);

// ---- curriculum ----
const curriculum = parseCurriculumHtml(
  fs.readFileSync(path.join(dir, 'ajx-searchtypes-POST.DATA.html'), 'utf8'),
);
console.log('== CURRICULUM ==');
console.log(`program: ${JSON.stringify(curriculum.program)}`);
console.log(`semesters: ${curriculum.semesters.length}`);
for (const s of curriculum.semesters) {
  console.log(`  sem ${s.no}: ${s.courses.length} курсов`);
}
const allCourses = curriculum.semesters.flatMap((s) => s.courses);
const byStatus = {};
for (const c of allCourses) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
console.log(`  статусы: ${JSON.stringify(byStatus)}`);
const elective = allCourses.find((c) => c.isElective);
if (elective) {
  console.log(`  электив: ${elective.code} «${elective.name}» -> ${JSON.stringify(elective.elective)}`);
}
const withParams = allCourses.find((c) => c.sectionsParams);
if (withParams) {
  console.log(`  sectionsParams пример: ${withParams.code} -> ${JSON.stringify(withParams.sectionsParams)}`);
}
fs.writeFileSync(path.join(dir, 'parsed-curriculum.json'), JSON.stringify(curriculum, null, 2));

// ---- sections ----
const sectionsJson = JSON.parse(fs.readFileSync(path.join(dir, 'ajx-sections-POST.raw.txt'), 'utf8'));
const sections = parseSectionsResponse(sectionsJson);
console.log('\n== SECTIONS ==');
console.log(`course: ${JSON.stringify(sections.course)}`);
console.log(`depCode=${sections.depCode} progCode=${sections.progCode}`);
console.log(`theory: ${sections.theory.length}, practice: ${sections.practice.length}, lab: ${sections.lab.length}`);
for (const s of [sections.theory[0], sections.practice.at(-1)].filter(Boolean)) {
  console.log(`  [${s.kind}] id=${s.id} sec=${s.section} «${s.teacher}» quota=${s.quota} занято=${s.enrolled} свободно=${s.seatsLeft} available=${s.isAvailable}`);
  console.log(`       schedule=${JSON.stringify(s.schedule)} practiceIds=${s.practiceIds.length}`);
}
fs.writeFileSync(path.join(dir, 'parsed-sections.json'), JSON.stringify(sections, null, 2));

// ---- registrations ----
const reg = parseCourseRegPage(fs.readFileSync(path.join(dir, '06-course_reg.html'), 'utf8'));
console.log('\n== REGISTRATIONS ==');
console.log(`authenticated=${reg.authenticated}, term=${reg.term}, approved=${reg.isApproved}`);
console.log(`track: ${JSON.stringify(reg.track)}, progTrack=${reg.progTrack}`);
for (const c of reg.approved) {
  console.log(`  ${c.code} N=${c.normalSection} P=${c.practiceSection} «${c.name}» cr=${c.credits} ects=${c.ects} (${c.status})`);
}
fs.writeFileSync(path.join(dir, 'parsed-registrations.json'), JSON.stringify(reg, null, 2));

console.log('\n# Все три парсера отработали. Результаты сохранены рядом с дампами (parsed-*.json).');
