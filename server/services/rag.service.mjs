import { scheduleService } from './schedule.service.mjs';
import { curriculumService } from './curriculum.service.mjs';
import { recommendationService } from './recommendation.service.mjs';
import { prerequisiteService, GRADE_POINTS } from './prerequisite.service.mjs';
import { prerequisiteRepository } from '../repositories/prerequisite.repository.mjs';
import { curriculumRepository } from '../repositories/curriculum.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { cacheRepository } from '../repositories/cache.repository.mjs';
import { planRepository } from '../repositories/plan.repository.mjs';
import { recommendationConfigRepository } from '../repositories/recommendation-config.repository.mjs';
import { guardrailConfigRepository } from '../repositories/guardrail-config.repository.mjs';
import { userRepository } from '../repositories/user.repository.mjs';
import { guardrailService } from './guardrail.service.mjs';
import { demo } from '../demo-data.mjs';

const DAY_NAMES = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

function formatBasketSchedule(rawSchedule) {
  if (!Array.isArray(rawSchedule) || rawSchedule.length === 0) return [];
  return rawSchedule
    .filter((chip) => chip && chip.code)
    .map((chip) => {
      const code = normalizeCourseCode(chip.code);
      const slots = Array.isArray(chip.slots)
        ? chip.slots.map((s) => `${DAY_NAMES[s.day] || `Day${s.day}`} ${s.time}`).join(', ')
        : '';
      return {
        code,
        kind: chip.kind || 'N',
        section: chip.section || '',
        slots: slots || 'TBA',
      };
    });
}

const VALID_PAGES = {
  '/roadmap': { label: 'Curriculum Roadmap', url: '/roadmap', type: 'page' },
  '/recommendations': { label: 'Course Recommendations', url: '/recommendations', type: 'page' },
  '/simulation': { label: 'What-If Simulation', url: '/simulation', type: 'page' },
  '/': { label: 'Schedule & Curriculum Home', url: '/', type: 'page' },
};

const COURSE_CODE_REGEX = /\b([A-Za-z]{2,4})\s*-?\s*(\d{3}[A-Za-z]?)\b/g;

export function normalizeCourseCode(raw) {
  if (!raw) return '';
  const match = String(raw).trim().toUpperCase().match(/^([A-Z]{2,4})\s*-?\s*(\d{3}[A-Z]?)$/);
  if (match) return `${match[1]} ${match[2]}`;
  return String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function extractCourseCodes(text) {
  if (!text) return [];
  const found = new Set();
  const str = String(text);
  let m;
  COURSE_CODE_REGEX.lastIndex = 0;
  while ((m = COURSE_CODE_REGEX.exec(str)) !== null) {
    found.add(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
  }
  return Array.from(found);
}

export function detectLanguage(text) {
  return /[а-яёА-ЯЁ]/.test(String(text || '')) ? 'ru' : 'en';
}

function buildCompletedCoursesMap(courses = []) {
  const map = new Map();
  for (const c of courses) {
    if (!c?.code) continue;
    const codeKey = normalizeCourseCode(c.code);
    const existing = map.get(codeKey);
    const grade = c.grade ? String(c.grade).toUpperCase().trim() : null;
    const isPassed = c.status === 'passed';
    const isPositiveGrade = grade && !['F', 'FX', 'I', 'NA'].includes(grade);

    if (!existing) {
      map.set(codeKey, { ...c, code: codeKey, grade });
    } else if (isPassed || (existing.status !== 'passed' && isPositiveGrade)) {
      map.set(codeKey, { ...c, code: codeKey, grade });
    }
  }
  return map;
}

export class RagService {
  /**
   * Builds live, grounded academic context for a specific student from system repositories/services.
   */
  async buildStudentContext(username, client = null) {
    const isDemoMode = process.env.DEMO === '1';
    const canUseRecsClient = Boolean(client && (isDemoMode || typeof client.getCourseReg === 'function'));
    const [
      userRes,
      groupRes,
      studentDataRes,
      sduCurrRes,
      assignedListRes,
      prereqRulesRes,
      catalogRes,
      plansRes,
      configRes,
      guardrailRes,
      recsRes,
    ] = await Promise.allSettled([
      username ? userRepository.findByUsername(username) : null,
      username ? groupRepository.getStudentGroupAndAdvisor(username) : null,
      username ? cacheRepository.getStudentData(username, Infinity) : null,
      client ? scheduleService.getCurriculum(client) : (isDemoMode ? demo.curriculum() : null),
      username ? curriculumRepository.listAssignedCurriculumsForUser(username) : [],
      prerequisiteRepository.getAllPrerequisites(),
      curriculumRepository.getCatalogCourses(),
      username ? planRepository.getAllPlans(username) : [],
      recommendationConfigRepository.getActiveConfig(),
      guardrailConfigRepository.getActiveConfig(),
      canUseRecsClient ? recommendationService.getRecommendations(client) : null,
    ]);

    const user = userRes.status === 'fulfilled' ? userRes.value : null;
    const groupInfo = groupRes.status === 'fulfilled' ? groupRes.value : null;
    const rawStudentData = studentDataRes.status === 'fulfilled' ? studentDataRes.value : null;
    const studentData = rawStudentData || (isDemoMode ? demo.me() : null);
    const sduCurriculum = sduCurrRes.status === 'fulfilled' ? sduCurrRes.value : null;
    const assignedList = assignedListRes.status === 'fulfilled' ? (assignedListRes.value || []) : [];
    const prereqRules = prereqRulesRes.status === 'fulfilled' ? (prereqRulesRes.value || []) : [];
    const catalogMap = catalogRes.status === 'fulfilled' && catalogRes.value instanceof Map ? catalogRes.value : new Map();
    const savedPlans = plansRes.status === 'fulfilled' ? (plansRes.value || []) : [];
    const config = configRes.status === 'fulfilled' ? configRes.value : null;
    const guardrailConfig = guardrailRes.status === 'fulfilled' ? guardrailRes.value : null;
    const rawRecs = recsRes.status === 'fulfilled' ? recsRes.value : null;

    // Gather student's active curriculum if assigned or cached from SDU
    let activeCurriculum = sduCurriculum;
    if (username && (!activeCurriculum || assignedList.length > 0)) {
      const sduCourses = sduCurriculum?.semesters?.flatMap((s) => s.courses || []) || [];
      const customCurr = await curriculumService.getCurriculumForStudent(username, sduCourses, sduCurriculum).catch(() => null);
      if (customCurr) activeCurriculum = customCurr;
    }

    // Also include approved/in-progress courses from studentData cache
    const approvedCourses = Array.isArray(studentData?.approved) ? studentData.approved : [];
    const curriculumCourses = activeCurriculum?.semesters?.flatMap((s) =>
      (s.courses || []).map((c) => ({ ...c, semester: s.no }))
    ) || [];

    const allStudentCourses = [...curriculumCourses];
    const seenCurrCodes = new Set(curriculumCourses.map((c) => normalizeCourseCode(c.code)));
    for (const ac of approvedCourses) {
      const code = normalizeCourseCode(ac.code);
      if (code && !seenCurrCodes.has(code)) {
        allStudentCourses.push({ ...ac, code, status: ac.status || 'taken' });
      }
    }

    const completedMap = buildCompletedCoursesMap(allStudentCourses);

    // Track passed and in-progress non-elective names to prevent duplicate catalog codes (e.g. MDE 171 vs HIST 101)
    const normalizeCourseTitle = (name) =>
      String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const passedByName = new Map();
    const inProgressByName = new Set();

    for (const c of completedMap.values()) {
      const grade = c.grade ? c.grade.toUpperCase().trim() : null;
      const isTakenNow = c.status === 'taken' || grade === 'IP';
      const isPassed = !isTakenNow && (c.status === 'passed' || (grade && !['F', 'FX', 'I', 'NA', 'IP'].includes(grade)));
      const normTitle = normalizeCourseTitle(c.name);
      const isGenericElective = !normTitle || /^xxx/i.test(c.code) || normTitle.includes('elective');
      if (!isGenericElective) {
        if (isPassed) passedByName.set(normTitle, grade || 'Passed');
        else if (isTakenNow) inProgressByName.add(normTitle);
      }
    }

    // Build unified grounded courses index: student curriculum courses FIRST, then catalog supplements
    const coursesMap = new Map();

    for (const c of allStudentCourses) {
      const normCode = normalizeCourseCode(c.code);
      if (!normCode) continue;
      const prev = coursesMap.get(normCode) || {};
      const cat = catalogMap.get(normCode);
      const studentState = completedMap.get(normCode);
      coursesMap.set(normCode, {
        code: normCode,
        name: c.name || prev.name || cat?.name || normCode,
        ects: Number(c.ects) || prev.ects || Number(cat?.ects) || 5,
        description: c.description || prev.description || cat?.description || null,
        semester: c.semester ?? prev.semester ?? null,
        type: c.type || prev.type || 'Mandatory',
        status: studentState?.status || c.status || prev.status || 'not_taken',
        grade: studentState?.grade ?? c.grade ?? prev.grade ?? null,
        mufSqId: c.elective?.mufSqId || c.sectionsParams?.mufSqId || prev.mufSqId || null,
      });
    }

    for (const [code, cat] of catalogMap.entries()) {
      const normCode = normalizeCourseCode(code);
      if (coursesMap.has(normCode)) continue;
      const normTitle = normalizeCourseTitle(cat.name);
      const passedGrade = passedByName.get(normTitle);
      const isTakenName = inProgressByName.has(normTitle);
      coursesMap.set(normCode, {
        code: normCode,
        name: cat.name || normCode,
        ects: Number(cat.ects) || 5,
        description: cat.description || null,
        semester: null,
        type: 'Catalog',
        status: passedGrade ? 'passed' : (isTakenName ? 'taken' : 'not_taken'),
        grade: passedGrade || (isTakenName ? 'IP' : null),
      });
    }

    // Enrich every course with exact prerequisite rules, eligibility, and DB description
    const coursesIndex = [];
    for (const course of coursesMap.values()) {
      const courseRules = prereqRules.filter(
        (r) => normalizeCourseCode(r.course_code || r.courseCode) === course.code
      );
      const eligibility = prerequisiteService.checkCourseEligibility(course.code, completedMap, prereqRules);
      const enriched = {
        ...course,
        description: course.description || `${course.name} (${course.ects} ECTS, ${course.type}).`,
        prerequisites: courseRules.map((r) => ({
          code: normalizeCourseCode(r.prereq_course_code || r.prereqCourseCode),
          minGrade: (r.min_grade || r.minGrade || 'D').toUpperCase().trim(),
          type: (r.type || 'prerequisite').toLowerCase(),
        })),
        eligible: eligibility.eligible,
        eligibilityStatus: eligibility.status,
        eligibilityReason: eligibility.reason,
        missingPrerequisites: eligibility.missingPrerequisites || [],
      };
      coursesMap.set(course.code, enriched);
      coursesIndex.push(enriched);
    }

    // Calculate GPA and completed credits from passed courses
    let totalQualityPoints = 0;
    let totalGpaEcts = 0;
    let completedEcts = 0;
    const completedCourses = [];
    const inProgressCodes = new Set();

    const basketSchedule = formatBasketSchedule(studentData?.schedule);
    for (const item of basketSchedule) {
      if (item?.code) inProgressCodes.add(item.code);
    }

    for (const c of completedMap.values()) {
      const grade = c.grade ? c.grade.toUpperCase().trim() : null;
      const ects = Number(c.ects) || coursesMap.get(c.code)?.ects || 5;
      const isTakenNow = c.status === 'taken' || grade === 'IP';
      const isPassed = !isTakenNow && (c.status === 'passed' || (grade && !['F', 'FX', 'I', 'NA', 'IP'].includes(grade)));

      if (isTakenNow) {
        inProgressCodes.add(c.code);
      } else if (isPassed) {
        inProgressCodes.delete(c.code);
        completedEcts += ects;
        completedCourses.push({
          code: c.code,
          name: c.name || coursesMap.get(c.code)?.name || c.code,
          ects,
          grade: grade || 'Passed',
          status: c.status || 'passed',
        });
        if (grade && GRADE_POINTS[grade] !== undefined) {
          totalQualityPoints += GRADE_POINTS[grade] * ects;
          totalGpaEcts += ects;
        }
      }
    }

    const gpa = totalGpaEcts > 0 ? (totalQualityPoints / totalGpaEcts).toFixed(2) : null;
    const programName =
      groupInfo?.program ||
      (typeof activeCurriculum?.program === 'string'
        ? activeCurriculum.program
        : activeCurriculum?.program?.name || activeCurriculum?.program?.title) ||
      assignedList[0]?.program ||
      'Information Systems';

    const minEcts = Number(config?.min_ects) || 20;
    const maxEcts = Number(config?.max_ects) || 21;

    const recommendations = rawRecs
      ? {
          targetSemester: rawRecs.targetSemester,
          recommendedEctsTotal: rawRecs.recommendedEctsTotal,
          isProgramDisabled: rawRecs.isProgramDisabled,
          disabledReason: rawRecs.disabledReason,
          recommendedSet: (rawRecs.recommendedSet || []).slice(0, 6).map((r) => ({
            code: normalizeCourseCode(r.code),
            name: r.name,
            ects: r.ects,
            semester: r.semester,
            score: r.score,
            isRetake: r.isRetake,
            isMandatory: r.isMandatory,
            reason: r.reason,
          })),
        }
      : null;

    const faqDocs = [
      {
        id: 'faq-ects',
        keywords: ['ects', 'credit', 'limit', 'load', 'workload', 'кредит', 'лимит', 'нагрузка'],
        text: `Standard semester registration ECTS limit is ${minEcts}–${maxEcts} ECTS per semester.`,
        page: '/recommendations',
      },
      {
        id: 'faq-gpa',
        keywords: ['gpa', 'grade', 'retake', 'average', 'гпа', 'оценка', 'балл', 'пересдача', 'ретейк'],
        text: 'Cumulative GPA is calculated as sum(grade_points * ECTS) / sum(ECTS) using A=4.0, A-=3.67, B+=3.33, B=3.0, C=2.0, D=1.0. Retaking a failed course with a passing grade overrides the previous F/FX for eligibility.',
        page: '/roadmap',
      },
      {
        id: 'faq-roadmap',
        keywords: ['roadmap', 'curriculum', 'track', 'semester', 'роадмап', 'учебный план', 'программа', 'семестр'],
        text: 'The Curriculum Roadmap (/roadmap) shows all semesters, completed grades, prerequisites, and eligible upcoming courses.',
        page: '/roadmap',
      },
      {
        id: 'faq-recommendations',
        keywords: ['recommend', 'recommendation', 'priority', 'prioritized', 'elective', 'advice', 'plan', 'рекоменд', 'приоритет', 'электив', 'совет', 'план'],
        text: 'Personalized Recommendations (/recommendations) and What-If Simulation (/simulation) rank eligible courses by priority (retakes first, overdue core, current semester, then electives).',
        page: '/recommendations',
      },
      {
        id: 'faq-schedule',
        keywords: ['schedule', 'basket', 'timetable', 'section', 'slot', 'расписани', 'корзин', 'секци', 'слот', 'пар'],
        text: 'Your current registration basket and weekly timetable can be reviewed and adjusted on the Schedule & Curriculum Home page (/).',
        page: '/',
      },
      {
        id: 'faq-deadlines',
        keywords: ['deadline', 'deadlines', 'last day', 'drop', 'add/drop', 'withdraw', 'withdrawal', 'registration', 'rule', 'policy', 'дедлайн', 'последн', 'срок', 'дроп', 'отказ', 'правил'],
        text: `Official Deadlines — Drop: ${guardrailConfig?.official_deadlines?.drop_deadline || ''} Registration: ${guardrailConfig?.official_deadlines?.registration_deadline || ''} Retake Rule: ${guardrailConfig?.official_deadlines?.retake_rule || ''}`,
        page: '/roadmap',
      },
    ];

    const plannedCodes = new Set();
    let targetSemester = recommendations?.targetSemester || null;
    for (const p of savedPlans) {
      if (!targetSemester && p.target_semester) targetSemester = Number(p.target_semester);
      const list = Array.isArray(p.courses) ? p.courses : [];
      for (const c of list) {
        if (c?.code) plannedCodes.add(normalizeCourseCode(c.code));
      }
    }
    if (!targetSemester) targetSemester = 1;

    return {
      username,
      displayName: user?.display_name || username,
      program: programName,
      group: groupInfo?.group_name || null,
      advisor: groupInfo?.advisor_display_name || groupInfo?.advisor_username || null,
      gpa,
      completedEcts,
      minEcts,
      maxEcts,
      targetSemester,
      plannedCodes,
      inProgressCodes,
      completedCourses,
      completedMap,
      coursesMap,
      coursesIndex,
      basketSchedule,
      recommendations,
      savedPlans,
      prereqRules,
      faqDocs,
      guardrailConfig,
    };
  }

  /**
   * Retrieves top-K relevant curriculum courses and FAQ docs using TF-IDF / cosine weighting + exact code matching.
   */
  retrieveRelevantContext(query, studentContext, topK = 10) {
    const mentionedCodes = extractCourseCodes(query);
    const knownMentionedCourses = [];
    const unknownCourseCodes = [];

    for (const code of mentionedCodes) {
      const found = studentContext.coursesMap.get(code);
      if (found) knownMentionedCourses.push(found);
      else unknownCourseCodes.push(code);
    }

    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'can', 'will', 'who', 'what', 'when', 'where', 'how',
      'why', 'take', 'next', 'this', 'that', 'from', 'into', 'are', 'you', 'your', 'about',
      'which', 'right', 'now', 'currently', 'show',
      'что', 'как', 'или', 'для', 'про', 'кто', 'где', 'когда', 'почему', 'можно', 'ли', 'мне', 'сейчас', 'моем', 'моём',
    ]);

    const tokens = String(query || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t));

    // Compute IDF weights across course documents for better semantic ranking
    const docFreq = new Map();
    const courseTokenLists = studentContext.coursesIndex.map((course) => {
      const words = `${course.code} ${course.name} ${course.description} ${course.type}`
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      const uniqueWords = new Set(words);
      for (const w of uniqueWords) {
        docFreq.set(w, (docFreq.get(w) || 0) + 1);
      }
      return { course, uniqueWords, size: Math.max(1, uniqueWords.size) };
    });
    const totalDocs = Math.max(1, courseTokenLists.length);

    const scoredCourses = courseTokenLists.map(({ course, uniqueWords, size }) => {
      let score = 0;
      if (mentionedCodes.includes(course.code)) score += 100;

      // Normalized TF-IDF cosine-style overlap
      for (const tok of tokens) {
        if (uniqueWords.has(tok)) {
          const idf = Math.log(1 + totalDocs / (1 + (docFreq.get(tok) || 0)));
          score += (15 * idf) / Math.sqrt(size);
        }
      }

      for (const mc of knownMentionedCourses) {
        if (mc.prerequisites.some((p) => p.code === course.code)) score += 30;
        if (course.prerequisites.some((p) => p.code === mc.code)) score += 20;
      }

      return { course, score };
    });

    const matchedCourses = scoredCourses
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.course);

    const relevantFaqs = studentContext.faqDocs.filter((faq) =>
      faq.keywords.some((kw) => tokens.some((tok) => tok === kw || (kw.length >= 5 && tok.startsWith(kw))))
    );

    return {
      mentionedCodes,
      knownMentionedCourses,
      unknownCourseCodes,
      matchedCourses,
      relevantFaqs,
    };
  }

  /**
   * Guardrail check ensuring non-academic questions (sports, weather, entertainment) are declined cleanly.
   */
  isAcademicTopic(query, retrieval) {
    const q = String(query || '').toLowerCase();
    // Exclude obvious non-academic financial meanings of "курс" (exchange rate / currency / crypto)
    if (/(доллар|евро|рубл|тенге|валют|биткоин|акци|бирж)/i.test(q)) {
      return false;
    }

    if (retrieval.mentionedCodes.length > 0 || retrieval.matchedCourses.length > 0 || retrieval.relevantFaqs.length > 0) {
      return true;
    }

    const greetingPattern = /^(hi|hello|hey|good morning|good afternoon|good evening|привет|здравствуй|здравствуйте|салем|сәлем|thanks|thank you|спасибо)\b/i;
    if (greetingPattern.test(q.trim())) return true;

    const words = q
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const exactAcademicWords = new Set([
      'course', 'courses', 'prereq', 'prerequisite', 'prerequisites', 'corequisite', 'corequisites',
      'curriculum', 'roadmap', 'syllabus', 'plan', 'plans', 'study', 'studies', 'semester', 'semesters',
      'gpa', 'grade', 'grades', 'ects', 'credit', 'credits', 'retake', 'retakes', 'elective', 'electives',
      'recommend', 'recommended', 'recommendation', 'recommendations', 'priority', 'prioritized',
      'advisor', 'university', 'sdu', 'zema', 'zeme', 'major', 'program', 'faculty',
      'eligible', 'eligibility', 'enroll', 'enrollment', 'register', 'registration',
      'schedule', 'basket', 'timetable', 'section', 'sections', 'graduate', 'graduation', 'transcript', 'academic',
      'deadline', 'deadlines', 'drop', 'withdraw', 'withdrawal', 'policy', 'policies', 'rule', 'rules', 'deanery',
      'курс', 'курсы', 'курсов', 'курсу', 'курсе', 'пререквизит', 'пререквизиты', 'пререквизитов',
      'кореквизит', 'кореквизиты', 'план', 'планирование', 'учеба', 'учёба', 'учебу', 'учёбу', 'учиться',
      'гпа', 'кредит', 'кредиты', 'кредитов', 'ретейк', 'ретейки', 'пересдача', 'пересдачу',
      'эдвайзер', 'универ', 'университет', 'сду', 'программа', 'программе', 'специальность',
      'доступен', 'доступна', 'доступны', 'записаться', 'регистрация', 'выпуск', 'транскрипт', 'сдал', 'сдала', 'провалил',
      'дедлайн', 'дедлайны', 'дроп', 'отчисление', 'деканат',
    ]);

    if (words.some((w) => exactAcademicWords.has(w))) return true;

    const russianPrefixes = [
      'пререквизит', 'роадмап', 'силлабус', 'семестр', 'оценк', 'электив',
      'рекоменд', 'приоритет', 'расписани', 'корзин', 'секци', 'академ',
    ];
    if (words.some((w) => russianPrefixes.some((p) => w.startsWith(p)))) return true;

    return q.includes('учебный план') || q.includes('study plan');
  }

  makeCourseLink(course) {
    const isPlaceholder = /^XXX/i.test(course.code);
    const url = isPlaceholder
      ? `/electives/${encodeURIComponent(course.code)}${course.mufSqId ? `?mufSqId=${encodeURIComponent(course.mufSqId)}` : ''}`
      : `/courses/${encodeURIComponent(course.code)}${course.mufSqId ? `?mufSqId=${encodeURIComponent(course.mufSqId)}` : ''}`;
    return {
      label: `${course.code} — ${course.name}`,
      url,
      type: 'course',
      code: course.code,
      eligible: course.eligible,
    };
  }

  validateLinks(courseCodes = [], pages = [], studentContext) {
    const links = [];
    const seenUrls = new Set();

    for (const rawCode of courseCodes) {
      const code = normalizeCourseCode(rawCode);
      const course = studentContext.coursesMap.get(code);
      if (course) {
        const link = this.makeCourseLink(course);
        if (!seenUrls.has(link.url)) {
          seenUrls.add(link.url);
          links.push(link);
        }
      }
    }

    for (const rawPage of pages) {
      const page = VALID_PAGES[rawPage];
      if (page && !seenUrls.has(page.url)) {
        seenUrls.add(page.url);
        links.push(page);
      }
    }

    return links;
  }

  /**
   * Builds structured actionable course cards for the chat UI (US23).
   */
  buildCourseCards(courseCodes = [], studentContext, reasonMap = new Map()) {
    const cards = [];
    const seen = new Set();

    for (const rawCode of courseCodes) {
      const code = normalizeCourseCode(rawCode);
      if (!code || seen.has(code)) continue;
      const course = studentContext.coursesMap.get(code);
      if (!course) continue;
      seen.add(code);

      cards.push({
        code: course.code,
        name: course.name,
        ects: Number(course.ects) || 5,
        semester: course.semester,
        type: course.type,
        eligible: Boolean(course.eligible),
        eligibilityStatus: course.eligibilityStatus || (course.eligible ? 'eligible' : 'not_eligible'),
        missingPrerequisites: (course.missingPrerequisites || []).map((m) => ({
          code: m.code,
          minGrade: m.minGrade,
          reason: m.reason,
        })),
        alreadyCompleted: course.status === 'passed',
        currentlyTaking: Boolean(studentContext.inProgressCodes?.has(course.code) || course.status === 'taken' || course.grade === 'IP'),
        alreadyInPlan: Boolean(studentContext.plannedCodes?.has(course.code)),
        isElectivePlaceholder: /^XXX/i.test(course.code),
        mufSqId: course.mufSqId || null,
        reason: reasonMap.get(course.code) || course.eligibilityReason || null,
      });
    }

    return cards;
  }

  /**
   * Calls Gemini / OpenAI / Groq API when an API key is configured, strictly grounded on studentContext.
   */
  async callExternalLlm({ query, history = [], studentContext, retrieval }) {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const groqKey = process.env.GROQ_API_KEY?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    if (!geminiKey && !groqKey && !openaiKey) {
      return null;
    }

    const contextPool = new Map();
    for (const c of retrieval.matchedCourses) contextPool.set(c.code, c);
    for (const r of studentContext.recommendations?.recommendedSet || []) {
      const found = studentContext.coursesMap.get(r.code);
      if (found && !contextPool.has(found.code)) contextPool.set(found.code, found);
    }
    const prioritizedCourses = [
      ...studentContext.coursesIndex.filter((c) => c.type !== 'Catalog'),
      ...studentContext.coursesIndex.filter((c) => c.type === 'Catalog'),
    ];
    for (const c of prioritizedCourses) {
      if (contextPool.size >= 30) break;
      if (!contextPool.has(c.code)) contextPool.set(c.code, c);
    }
    const coursesContext = Array.from(contextPool.values()).map((c) => ({
      code: c.code,
      name: c.name,
      ects: c.ects,
      semester: c.semester,
      type: c.type,
      description: c.description,
      studentStatus: c.status,
      studentGrade: c.grade,
      prerequisites: c.prerequisites,
      eligible: c.eligible,
      eligibilityReason: c.eligibilityReason,
    }));

    const systemInstruction = `You are the AI Academic Advisor for SDU ZeMe Student Information System.
STRICT GROUNDING RULES:
1. Answer ONLY using the provided Student Context and Course Catalog JSON below.
2. NEVER invent, guess, or mention any course codes or prerequisites that do NOT appear in the provided JSON.
3. If the student asks about a course code not in the catalog (${retrieval.unknownCourseCodes.join(', ') || 'none'}), explicitly state that it is not found in their curriculum or course catalog.
4. Answer in the exact language of the user's question (English or Russian).
5. If the question is off-topic (not related to courses, curriculum, prerequisites, GPA, schedule, study plans, or university policies), politely decline and offer academic topics. Do NOT answer off-topic questions.
6. NEVER recommend courses whose studentStatus is "passed" or "taken" (or already in currentBasketSchedule) as courses to take next.
7. Use clean Markdown (**bold**, bullet lists) when listing multiple courses or steps.
8. Return valid JSON ONLY in this schema:
{
  "reply": "string (clear answer grounded in the student's data)",
  "courseCodes": ["array of relevant course codes from the context"],
  "pages": ["array of relevant app routes from: /roadmap, /recommendations, /simulation, /"]
}

STUDENT CONTEXT:
${JSON.stringify({
  username: studentContext.username,
  program: studentContext.program,
  group: studentContext.group,
  advisor: studentContext.advisor,
  gpa: studentContext.gpa,
  completedEcts: studentContext.completedEcts,
  semesterEctsPolicy: `${studentContext.minEcts}-${studentContext.maxEcts} ECTS`,
  completedCourses: studentContext.completedCourses,
  currentBasketSchedule: studentContext.basketSchedule,
  recommendations: studentContext.recommendations,
  savedPlansCount: studentContext.savedPlans.length,
  relevantCurriculumCourses: coursesContext,
  faqKnowledge: retrieval.relevantFaqs.map((f) => f.text),
  officialDeadlines: studentContext.guardrailConfig?.official_deadlines || null,
})}`;

    const recentHistory = history.slice(-6).map((m) => ({
      role: m.sender === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    try {
      let rawJsonText = null;

      if (geminiKey) {
        const modelsToTry = process.env.GEMINI_MODEL
          ? [process.env.GEMINI_MODEL]
          : ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
        const contents = [
          ...recentHistory.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          { role: 'user', parts: [{ text: query }] },
        ];

        let lastErr = null;
        for (const model of modelsToTry) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(10000),
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemInstruction }] },
                contents,
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: 'application/json',
                },
              }),
            });

            if (res.ok) {
              const data = await res.json();
              rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
              lastErr = null;
              break;
            }
            lastErr = new Error(`Gemini HTTP ${res.status} (${model})`);
            if (![404, 429, 503].includes(res.status)) {
              throw lastErr;
            }
          } catch (err) {
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
              lastErr = err;
              continue;
            }
            throw err;
          }
        }
        if (lastErr) throw lastErr;
      } else {
        const isGroq = Boolean(groqKey);
        const apiKey = groqKey || openaiKey;
        const baseUrl = process.env.OPENAI_BASE_URL || (isGroq ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
        const model = process.env.AI_MODEL || (isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemInstruction },
              ...recentHistory,
              { role: 'user', content: query },
            ],
          }),
        });

        if (!res.ok) {
          throw new Error(`LLM HTTP ${res.status}`);
        }
        const data = await res.json();
        rawJsonText = data?.choices?.[0]?.message?.content || null;
      }

      if (!rawJsonText) return null;
      const parsed = JSON.parse(rawJsonText);
      if (!parsed?.reply || typeof parsed.reply !== 'string') return null;

      const reasonMap = new Map();
      for (const r of studentContext.recommendations?.recommendedSet || []) {
        if (r.code && r.reason) reasonMap.set(r.code, r.reason);
      }

      return {
        content: parsed.reply.trim(),
        links: this.validateLinks(parsed.courseCodes || [], parsed.pages || [], studentContext),
        courseCards: this.buildCourseCards(parsed.courseCodes || [], studentContext, reasonMap),
      };
    } catch (err) {
      console.warn('[RagService] External LLM API unavailable, using grounded local RAG:', err.message);
      return null;
    }
  }

  /**
   * Grounded deterministic RAG responder using strictly verified system & student data.
   */
  generateGroundedFallback({ query, studentContext, retrieval }) {
    const lang = detectLanguage(query);
    const lower = String(query || '').toLowerCase().trim();

    // 1. Greeting check (only intercept pure greetings without an actual specific question)
    const hasSpecificQuestion =
      retrieval.mentionedCodes.length > 0 ||
      retrieval.unknownCourseCodes.length > 0 ||
      /prereq|пререквизит|gpa|гпа|schedule|basket|расписани|корзин|recommend|priorit|рекоменд|приоритет|eligible|доступен|deadline|last day|drop|add\/drop|withdraw|official rule|дедлайн|последн\S*\s+ден|дроп|срок/i.test(lower);
    if (!hasSpecificQuestion && /^(hi|hello|hey|good morning|good afternoon|good evening|привет|здравствуй|здравствуйте|салем|сәлем)\b/i.test(lower)) {
      if (lang === 'ru') {
        const summary = studentContext.gpa
          ? ` Ваша программа: ${studentContext.program}, текущий GPA: ${studentContext.gpa}.`
          : ` Ваша программа: ${studentContext.program}.`;
        return {
          content: `Привет, ${studentContext.displayName}! Я ваш AI Academic Advisor.${summary} Чем помочь по курсам, пререквизитам или учебному плану?`,
          links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
        };
      }
      const summary = studentContext.gpa
        ? ` Your program is ${studentContext.program} with a GPA of ${studentContext.gpa}.`
        : ` Your program is ${studentContext.program}.`;
      return {
        content: `Hello ${studentContext.displayName}! I am your AI Academic Advisor.${summary} How can I assist you with your courses, curriculum roadmap, or semester registration today?`,
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
      };
    }

    // 2. Guardrail: politely decline off-topic questions using configurable templates
    if (!this.isAcademicTopic(query, retrieval)) {
      return {
        content: guardrailService.getRefusalMessage(lang, studentContext.guardrailConfig, false),
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
        wasRefusal: true,
      };
    }

    // 2b. Official Deadlines & University Policies (US24)
    if (
      retrieval.knownMentionedCourses.length === 0 &&
      guardrailService.isOfficialRuleOrDeadlineQuery(query)
    ) {
      const deadlines = studentContext.guardrailConfig?.official_deadlines || {};
      const lines =
        lang === 'ru'
          ? [
              'Вот официальные академические сроки и правила университета:',
              deadlines.drop_deadline ? `- **Дедлайн отказа от курса (Add/Drop):** ${deadlines.drop_deadline}` : null,
              deadlines.registration_deadline ? `- **Дедлайн регистрации:** ${deadlines.registration_deadline}` : null,
              deadlines.retake_rule ? `- **Правило пересдачи (Retake):** ${deadlines.retake_rule}` : null,
            ]
          : [
              'Here are the official academic deadlines and rules:',
              deadlines.drop_deadline ? `- **Course Drop / Add-Drop Deadline:** ${deadlines.drop_deadline}` : null,
              deadlines.registration_deadline ? `- **Registration Deadline:** ${deadlines.registration_deadline}` : null,
              deadlines.retake_rule ? `- **Retake Rule:** ${deadlines.retake_rule}` : null,
            ];
      return {
        content: lines.filter(Boolean).join('\n'),
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
      };
    }

    // 3. Explicit course code question (e.g. "Can I take CS 201 next semester and what is it about?")
    if (retrieval.knownMentionedCourses.length > 0 || retrieval.unknownCourseCodes.length > 0) {
      const parts = [];
      const linkCodes = [];
      const pages = ['/roadmap'];

      for (const course of retrieval.knownMentionedCourses) {
        linkCodes.push(course.code);
        const prereqTextEn = course.prerequisites.length > 0
          ? course.prerequisites.map((p) => `${p.code} (min ${p.minGrade})`).join(', ')
          : 'none';
        const prereqTextRu = course.prerequisites.length > 0
          ? course.prerequisites.map((p) => `${p.code} (мин. ${p.minGrade})`).join(', ')
          : 'нет';

        const prereqStudentNotes = course.prerequisites.map((p) => {
          const done = studentContext.completedMap.get(p.code);
          if (!done) return lang === 'ru' ? `${p.code}: не пройден` : `${p.code}: not completed`;
          return lang === 'ru'
            ? `${p.code}: оценка ${done.grade || done.status}`
            : `${p.code}: completed with grade ${done.grade || done.status}`;
        });

        if (lang === 'ru') {
          let eligibilityLine;
          if (course.status === 'passed') {
            eligibilityLine = `Вы уже сдали курс ${course.code} (${course.name}) с оценкой ${course.grade || 'Passed'}.`;
          } else if (studentContext.inProgressCodes?.has(course.code) || course.status === 'taken' || course.grade === 'IP') {
            eligibilityLine = `Вы уже проходите курс ${course.code} (${course.name}) в текущем семестре.`;
          } else if (course.eligible) {
            const basis = prereqStudentNotes.length > 0 ? ` (${prereqStudentNotes.join('; ')})` : '';
            eligibilityLine = `Да, вы можете взять ${course.code} (${course.name}, ${course.ects} ECTS) — требования выполнены${basis}.`;
          } else {
            eligibilityLine = `Сейчас вы не можете записаться на ${course.code} (${course.name}): не выполнены пререквизиты — ${course.eligibilityReason}.`;
          }
          parts.push(`${eligibilityLine}\nО курсе: ${course.description} Пререквизиты: ${prereqTextRu}.`);
        } else {
          let eligibilityLine;
          if (course.status === 'passed') {
            eligibilityLine = `You have already completed ${course.code} (${course.name}) with grade ${course.grade || 'Passed'}.`;
          } else if (studentContext.inProgressCodes?.has(course.code) || course.status === 'taken' || course.grade === 'IP') {
            eligibilityLine = `You are already taking ${course.code} (${course.name}) in your current semester.`;
          } else if (course.eligible) {
            const basis = prereqStudentNotes.length > 0 ? ` (${prereqStudentNotes.join('; ')})` : '';
            eligibilityLine = `Yes, you are eligible to take ${course.code} (${course.name}, ${course.ects} ECTS) next semester${basis}.`;
          } else {
            eligibilityLine = `You are currently not eligible for ${course.code} (${course.name}): ${course.eligibilityReason}.`;
          }
          parts.push(`${eligibilityLine}\nAbout the course: ${course.description} Prerequisites: ${prereqTextEn}.`);
        }
      }

      if (retrieval.unknownCourseCodes.length > 0) {
        const missingList = retrieval.unknownCourseCodes.join(', ');
        parts.push(
          lang === 'ru'
            ? `Курс(ы) ${missingList} не найдены в вашем учебном плане или каталоге университета.`
            : `Course(s) ${missingList} were not found in your curriculum or the university course catalog.`
        );
      }

      return {
        content: parts.join('\n\n'),
        links: this.validateLinks(linkCodes, pages, studentContext),
        courseCards: this.buildCourseCards(linkCodes, studentContext),
      };
    }

    // 4. Prerequisites general question
    if (/prereq|prerequisite|пререквизит/i.test(lower)) {
      const samplePrereqs = studentContext.coursesIndex
        .filter((c) => c.prerequisites.length > 0)
        .slice(0, 4);
      const codes = samplePrereqs.map((c) => c.code);
      const listText = samplePrereqs
        .map((c) => `${c.code} ← ${c.prerequisites.map((p) => `${p.code} (min ${p.minGrade})`).join(', ')}`)
        .join('; ');

      if (lang === 'ru') {
        return {
          content: `Пререквизиты проверяются автоматически по вашему транскрипту и каталогу. Примеры правил в системе: ${listText}. Полный статус доступности каждого курса можно посмотреть на странице Curriculum Roadmap.`,
          links: this.validateLinks(codes, ['/roadmap'], studentContext),
          courseCards: this.buildCourseCards(codes, studentContext),
        };
      }
      return {
        content: `Prerequisites ensure you have completed required foundational courses before enrolling. Key prerequisite rules in your catalog include: ${listText}. Check live eligibility badges on the Curriculum Roadmap.`,
        links: this.validateLinks(codes, ['/roadmap'], studentContext),
        courseCards: this.buildCourseCards(codes, studentContext),
      };
    }

    // 5. GPA / Grade / Credits question
    if (/gpa|grade|credit|ects|гпа|оценк|кредит|балл/i.test(lower)) {
      if (lang === 'ru') {
        const stats = studentContext.gpa
          ? `Ваш текущий рассчитанный GPA: ${studentContext.gpa}, закрыто кредитов: ${studentContext.completedEcts} ECTS.`
          : `У вас пока нет закрытых курсов с оценками в системе (лимит семестра: ${studentContext.minEcts}–${studentContext.maxEcts} ECTS).`;
        return {
          content: `${stats} Кумулятивный GPA рассчитывается как взвешенное среднее оценок по ECTS-кредитам.`,
          links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
        };
      }
      const stats = studentContext.gpa
        ? `Your current cumulative GPA is ${studentContext.gpa} across ${studentContext.completedEcts} completed ECTS.`
        : `Your transcript has no graded completed courses cached yet (semester limit: ${studentContext.minEcts}–${studentContext.maxEcts} ECTS).`;
      return {
        content: `${stats} Cumulative GPA is calculated across all passed courses weighted by ECTS credits.`,
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
      };
    }

    // 6. Current Schedule / Basket question (using studentData.basket_schedule)
    if (/schedule|basket|timetable|расписани|корзин|слот|пар[ауы]?/i.test(lower)) {
      if (studentContext.basketSchedule.length > 0) {
        const grouped = new Map();
        for (const item of studentContext.basketSchedule) {
          if (!grouped.has(item.code)) grouped.set(item.code, []);
          grouped.get(item.code).push(`${item.kind}${item.section ? ' #' + item.section : ''} (${item.slots})`);
        }
        const codes = Array.from(grouped.keys());
        const lines = codes.map((code) => `- **${code}**: ${grouped.get(code).join('; ')}`).join('\n');

        if (lang === 'ru') {
          return {
            content: `Сейчас в вашей корзине/расписании выбраны следующие курсы:\n${lines}`,
            links: this.validateLinks(codes, ['/'], studentContext),
          };
        }
        return {
          content: `Here is your current registration basket and schedule:\n${lines}`,
          links: this.validateLinks(codes, ['/'], studentContext),
        };
      }
      if (lang === 'ru') {
        return {
          content: 'В вашей текущей корзине расписания пока нет выбранных секций. Вы можете подобрать курсы на главной странице расписания или во вкладке рекомендаций.',
          links: this.validateLinks([], ['/', '/recommendations'], studentContext),
        };
      }
      return {
        content: 'Your current registration basket has no selected sections yet. Open the Schedule Home or Recommendations page to add courses.',
        links: this.validateLinks([], ['/', '/recommendations'], studentContext),
      };
    }

    // 7. Recommendations / Study plan / Curriculum / Roadmap question
    if (/\b(recommend|priorit|advice|elective|roadmap|curriculum|plan)\w*\b|рекоменд|приоритет|электив|роадмап|учебный план|план/i.test(lower)) {
      const recSet = studentContext.recommendations?.recommendedSet || [];
      if (recSet.length > 0 && /recommend|priorit|next|take|рекоменд|приоритет|взять/i.test(lower)) {
        const codes = recSet.map((r) => r.code);
        const reasonMap = new Map(recSet.map((r) => [r.code, r.reason]));
        const recLines = recSet
          .map((r) => `- **${r.code}** (${r.name}, ${r.ects} ECTS): ${r.reason}`)
          .join('\n');
        if (lang === 'ru') {
          return {
            content: `Приоритетные рекомендованные курсы (лимит ${studentContext.minEcts}–${studentContext.maxEcts} ECTS, итого ${studentContext.recommendations.recommendedEctsTotal} ECTS):\n${recLines}`,
            links: this.validateLinks(codes, ['/recommendations', '/roadmap'], studentContext),
            courseCards: this.buildCourseCards(codes, studentContext, reasonMap),
          };
        }
        return {
          content: `Here are your prioritized course recommendations (target Semester ${studentContext.recommendations.targetSemester}, ${studentContext.recommendations.recommendedEctsTotal} ECTS):\n${recLines}`,
          links: this.validateLinks(codes, ['/recommendations', '/roadmap'], studentContext),
          courseCards: this.buildCourseCards(codes, studentContext, reasonMap),
        };
      }

      const eligibleNext = studentContext.coursesIndex
        .filter((c) => c.status !== 'passed' && !studentContext.inProgressCodes?.has(c.code) && c.eligible)
        .filter((c) => !studentContext.coursesIndex.some((x) => x.type !== 'Catalog') || c.type !== 'Catalog')
        .slice(0, 4);
      const codes = eligibleNext.map((c) => c.code);
      const nextNames = eligibleNext.map((c) => `${c.code} (${c.name})`).join(', ');

      if (lang === 'ru') {
        return {
          content: `Ваша программа: ${studentContext.program}${studentContext.group ? `, группа: ${studentContext.group}` : ''}. Пройдено курсов: ${studentContext.completedCourses.length}. Лимит семестра: ${studentContext.minEcts}–${studentContext.maxEcts} ECTS.${nextNames ? ` Доступные для взятия курсы: ${nextNames}.` : ''}`,
          links: this.validateLinks(codes, ['/roadmap', '/recommendations', '/simulation'], studentContext),
          courseCards: this.buildCourseCards(codes, studentContext),
        };
      }
      return {
        content: `Your active program is ${studentContext.program}${studentContext.group ? ` (group ${studentContext.group})` : ''}, with ${studentContext.completedCourses.length} completed course(s) and a semester limit of ${studentContext.minEcts}–${studentContext.maxEcts} ECTS.${nextNames ? ` Eligible courses available next: ${nextNames}.` : ''} Explore your Curriculum Roadmap and Recommendations for full planning.`,
        links: this.validateLinks(codes, ['/roadmap', '/recommendations', '/simulation'], studentContext),
        courseCards: this.buildCourseCards(codes, studentContext),
      };
    }

    // 8. Semantic/keyword match on courses from catalog/curriculum
    if (retrieval.matchedCourses.length > 0) {
      const top = retrieval.matchedCourses.slice(0, 3);
      const codes = top.map((c) => c.code);
      const descLines = top.map((c) =>
        `${c.code} (${c.name}, ${c.ects} ECTS): ${c.description} [${c.eligible ? 'Eligible' : c.eligibilityReason}]`
      ).join('\n');

      if (lang === 'ru') {
        return {
          content: `Вот курсы из вашей базы, подходящие под запрос:\n${descLines}`,
          links: this.validateLinks(codes, ['/roadmap'], studentContext),
          courseCards: this.buildCourseCards(codes, studentContext),
        };
      }
      return {
        content: `Here are the matching courses from your curriculum and catalog:\n${descLines}`,
        links: this.validateLinks(codes, ['/roadmap'], studentContext),
        courseCards: this.buildCourseCards(codes, studentContext),
      };
    }

    // 8. Default academic fallback
    if (lang === 'ru') {
      return {
        content: `Спасибо за вопрос! Как ваш AI Academic Advisor по программе ${studentContext.program}, я могу подсказать по конкретному коду курса (например, CS 201 или CSS 215), пререквизитам, вашему GPA и учебному плану.`,
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
      };
    }
    return {
      content: `Thank you for your question! As your AI Academic Advisor for ${studentContext.program}, I can check your eligibility for any course (e.g., CS 201 or CSS 215), explain prerequisites, calculate your GPA, and guide your study schedule.`,
      links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
    };
  }

  /**
   * Full RAG execution entry point: builds student context, retrieves relevant docs, calls LLM or grounded fallback.
   */
  async answerCurriculumQuestion({ username, query, history = [], client = null }) {
    const studentContext = await this.buildStudentContext(username, client);
    const guardrailCfg = studentContext.guardrailConfig;

    // Pre-execution guardrail check before external LLM or retrieval
    const inputCheck = guardrailService.moderateInput(query, guardrailCfg);
    if (inputCheck.blocked) {
      return {
        content: guardrailService.redactSensitiveData(inputCheck.refusalReply).text,
        links: this.validateLinks([], ['/roadmap', '/recommendations'], studentContext),
        courseCards: [],
        wasRefusal: true,
      };
    }

    const retrieval = this.retrieveRelevantContext(inputCheck.sanitizedQuery, studentContext);

    // Off-topic check before calling external LLM so non-academic queries never generate free-form answers
    if (!this.isAcademicTopic(inputCheck.sanitizedQuery, retrieval)) {
      const refusal = this.generateGroundedFallback({
        query: inputCheck.sanitizedQuery,
        studentContext,
        retrieval,
      });
      return {
        ...refusal,
        content: guardrailService.redactSensitiveData(refusal.content).text,
      };
    }

    const llmResult = await this.callExternalLlm({
      query: inputCheck.sanitizedQuery,
      history,
      studentContext,
      retrieval,
    });
    const rawResult = llmResult || this.generateGroundedFallback({
      query: inputCheck.sanitizedQuery,
      studentContext,
      retrieval,
    });

    return {
      ...rawResult,
      content: guardrailService.moderateOutput(rawResult.content, inputCheck.sanitizedQuery, guardrailCfg),
    };
  }
}

export const ragService = new RagService();
