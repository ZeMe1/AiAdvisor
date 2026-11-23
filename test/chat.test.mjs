import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { chatRepository } from '../server/repositories/chat.repository.mjs';
import { chatService } from '../server/services/chat.service.mjs';
import { cacheRepository } from '../server/repositories/cache.repository.mjs';
import { curriculumRepository } from '../server/repositories/curriculum.repository.mjs';
import { planRepository } from '../server/repositories/plan.repository.mjs';
import { ragService } from '../server/services/rag.service.mjs';

describe('US21: Open the AI Assistant Chat', () => {
  const studentA = 'test_student_a';
  const studentB = 'test_student_b';

  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await chatRepository.clearMessages(studentA);
    await chatRepository.clearMessages(studentB);
  });

  it('unauthenticated requests to /api/chat/messages return 401', async () => {
    const res = await request(app).get('/api/chat/messages');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('unauthenticated requests to /api/chat/message return 401', async () => {
    const res = await request(app).post('/api/chat/message').send({ message: 'Hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('Scenario 1: Student opens assistant and retrieves previously saved conversation history', async () => {
    // 1. Initial history is empty
    const initialHistory = await chatService.getChatHistory(studentA);
    expect(initialHistory).toEqual([]);

    // 2. Student sends a message
    const sendResult = await chatService.sendMessage(studentA, 'Hello, can you help me with my study plan?');
    expect(sendResult.userMessage).toBeDefined();
    expect(sendResult.userMessage.content).toBe('Hello, can you help me with my study plan?');
    expect(sendResult.assistantMessage).toBeDefined();
    expect(sendResult.assistantMessage.sender).toBe('assistant');
    expect(sendResult.assistantMessage.content).toContain('AI Academic Advisor');

    // 3. Reload / subsequent fetch retrieves the saved conversation history
    const reloadedHistory = await chatService.getChatHistory(studentA);
    expect(reloadedHistory.length).toBe(2);
    expect(reloadedHistory[0].sender).toBe('user');
    expect(reloadedHistory[0].content).toBe('Hello, can you help me with my study plan?');
    expect(reloadedHistory[1].sender).toBe('assistant');
  });

  it('Constraint: Chat history is strictly isolated per student (Student B cannot see Student A messages)', async () => {
    // Student A sends a private question
    await chatService.sendMessage(studentA, 'What are my specific prerequisites?');

    // Student B fetches history
    const studentBHistory = await chatService.getChatHistory(studentB);
    expect(studentBHistory).toEqual([]);

    // Student A still sees their messages
    const studentAHistory = await chatService.getChatHistory(studentA);
    expect(studentAHistory.length).toBe(2);
    expect(studentAHistory[0].content).toBe('What are my specific prerequisites?');
  });

  it('Responsibility: Chat supports multiline messages', async () => {
    const multilineText = 'Line 1: I need advice on CSS 215.\nLine 2: Can I take it with MAT 138?\nLine 3: Thanks!';
    const result = await chatService.sendMessage(studentA, multilineText);

    expect(result.userMessage.content).toBe(multilineText);
    const history = await chatService.getChatHistory(studentA);
    expect(history[0].content).toBe(multilineText);
  });

  it('Validation: Empty or whitespace-only messages fail with 400 Bad Request', async () => {
    await expect(chatService.sendMessage(studentA, '')).rejects.toThrow('Message cannot be empty');
    await expect(chatService.sendMessage(studentA, '   \n  ')).rejects.toThrow('Message cannot be empty');
  });

  it('Assistant responds within conversational topics (curriculum, prerequisites, GPA)', async () => {
    const resPrereq = await chatService.sendMessage(studentA, 'Tell me about prerequisites');
    expect(resPrereq.assistantMessage.content).toContain('Prerequisites');

    const resGpa = await chatService.sendMessage(studentA, 'How is my GPA calculated?');
    expect(resGpa.assistantMessage.content).toContain('GPA');
  });

  it('can clear conversation history for a student', async () => {
    await chatService.sendMessage(studentA, 'Hello');
    let history = await chatService.getChatHistory(studentA);
    expect(history.length).toBe(2);

    await chatService.clearChatHistory(studentA);
    history = await chatService.getChatHistory(studentA);
    expect(history).toEqual([]);
  });
});

describe('US22: Answer Questions about the Curriculum (RAG + Student Context)', () => {
  const studentEligible = 'test_us22_eligible';
  const studentMissing = 'test_us22_missing';

  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await chatRepository.clearMessages(studentEligible);
    await chatRepository.clearMessages(studentMissing);

    await cacheRepository.setStudentData(studentEligible, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'CS 101', name: 'Introduction to Computer Science', ects: '5', status: 'passed', grade: 'B' },
      ],
      basketSchedule: {},
    });

    await cacheRepository.setStudentData(studentMissing, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [],
      basketSchedule: {},
    });
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    vi.restoreAllMocks();
  });

  it('QA Scenario 1: Eligible student (completed CS 101 with B) asks about CS 201 and gets description + clickable link', async () => {
    const res = await chatService.sendMessage(
      studentEligible,
      'Can I take CS 201 next semester and what is it about?'
    );
    const msg = res.assistantMessage;
    expect(msg.content.toLowerCase()).toContain('eligible');
    expect(msg.content).toContain('CS 201');
    expect(msg.content).toContain('CS 101');
    expect(msg.content).toContain('B');
    expect(msg.content.toLowerCase()).toContain('intermediate programming');

    const cs201Link = msg.links.find((l) => l.code === 'CS 201');
    expect(cs201Link).toBeDefined();
    expect(cs201Link.url).toBe('/courses/CS%20201');
  });

  it('reports missing prerequisite accurately when student has not completed CS 101', async () => {
    const res = await chatService.sendMessage(studentMissing, 'Can I take CS 201?');
    expect(res.assistantMessage.content.toLowerCase()).toContain('not eligible');
    expect(res.assistantMessage.content).toContain('CS 101');
  });

  it('Constraint: Does not invent courses or prerequisites for unknown course codes', async () => {
    const res = await chatService.sendMessage(studentEligible, 'What are the prerequisites for XYZ 999?');
    expect(res.assistantMessage.content).toContain('XYZ 999');
    expect(res.assistantMessage.content.toLowerCase()).toContain('not found');
    const fakeLink = (res.assistantMessage.links || []).find((l) => l.code === 'XYZ 999');
    expect(fakeLink).toBeUndefined();
  });

  it('QA Scenario 2: Politely declines off-topic questions and offers academic topics', async () => {
    const res = await chatService.sendMessage(studentEligible, 'Who will win the football match tomorrow?');
    expect(res.assistantMessage.content.toLowerCase()).toContain('academic');
    expect(res.assistantMessage.content.toLowerCase()).not.toContain('goal');
  });

  it('Constraint: Responds in Russian when the student asks in Russian', async () => {
    const res = await chatService.sendMessage(studentEligible, 'Могу ли я взять CS 201 в следующем семестре?');
    expect(res.assistantMessage.content).toMatch(/[а-яё]/i);
    expect(res.assistantMessage.content).toContain('CS 201');
    expect(res.assistantMessage.links.some((l) => l.code === 'CS 201')).toBe(true);
  });

  it('Student-context injection: computes and injects student GPA from completed transcript', async () => {
    const res = await chatService.sendMessage(studentEligible, 'What is my current GPA?');
    expect(res.assistantMessage.content).toContain('3.00');
  });

  it('LLM API integration: validates links against real catalog and falls back cleanly on API error', async () => {
    process.env.GEMINI_API_KEY = 'test-fake-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reply: 'Based on your B in CS 101, you can take CS 201 next semester.',
                    courseCodes: ['CS 201', 'FAKE 999'],
                    pages: ['/roadmap'],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const res = await chatService.sendMessage(studentEligible, 'Can I take CS 201?');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.assistantMessage.content).toContain('CS 201');
    expect(res.assistantMessage.links.some((l) => l.code === 'CS 201')).toBe(true);
    expect(res.assistantMessage.links.some((l) => l.code === 'FAKE 999')).toBe(false);

    // Simulate API failure -> falls back seamlessly to grounded local RAG
    fetchSpy.mockRejectedValueOnce(new Error('Network timeout'));
    const fallbackRes = await chatService.sendMessage(studentEligible, 'Can I take CS 201?');
    expect(fallbackRes.assistantMessage.content).toContain('CS 201');
    expect(fallbackRes.assistantMessage.links.some((l) => l.code === 'CS 201')).toBe(true);
  });

  it('reads current basket_schedule and DB course_catalog descriptions dynamically', async () => {
    await curriculumRepository.addCatalogCourse(
      'CSS 499',
      'Distributed Capstone',
      5,
      'Hands-on senior capstone project building cloud-native microservices.'
    );
    await cacheRepository.setStudentData(studentEligible, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'CS 101', name: 'Introduction to Computer Science', ects: '5', status: 'passed', grade: 'B' },
      ],
      schedule: [
        { code: 'CSS 216', kind: 'N', section: '01', slots: [{ day: 4, time: '14:30' }] },
      ],
    });

    const schedRes = await ragService.answerCurriculumQuestion({
      username: studentEligible,
      query: 'What is in my current schedule right now?',
    });
    expect(schedRes.content).toContain('CSS 216');
    expect(schedRes.content).toContain('Thu 14:30');
    expect(schedRes.links.some((l) => l.code === 'CSS 216')).toBe(true);

    const schedRuRes = await ragService.answerCurriculumQuestion({
      username: studentEligible,
      query: 'Что у меня сейчас в расписании?',
    });
    expect(schedRuRes.content).toMatch(/[а-яё]/i);
    expect(schedRuRes.content).toContain('CSS 216');

    const dbCourseRes = await ragService.answerCurriculumQuestion({
      username: studentEligible,
      query: 'Tell me about CSS 499',
    });
    expect(dbCourseRes.content).toContain('microservices');
    expect(dbCourseRes.links.some((l) => l.code === 'CSS 499')).toBe(true);
  });

  it('US22 Maintenance Benchmark: achieves >= 95% accuracy across 30 curriculum & guardrail questions', async () => {
    await cacheRepository.setStudentData(studentEligible, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'CS 101', name: 'Introduction to Computer Science', ects: '5', status: 'passed', grade: 'B' },
        { code: 'CSS 105', name: 'Fundamentals of Programming', ects: '5', status: 'passed', grade: 'A' },
        { code: 'MAT 137', name: 'Mathematics 1', ects: '5', status: 'passed', grade: 'C+' },
      ],
      schedule: [
        { code: 'INF 451', kind: 'N', section: '01', slots: [{ day: 4, time: '08:30' }] },
      ],
    });

    const evalSet = [
      { q: 'Can I take CS 201 next semester?', check: (r) => r.content.toLowerCase().includes('eligible') && r.links.some((l) => l.code === 'CS 201') },
      { q: 'What is CS 201 about?', check: (r) => r.content.toLowerCase().includes('intermediate programming') },
      { q: 'Can I take CS 301 right now?', check: (r) => r.content.toLowerCase().includes('not eligible') && r.content.includes('CS 201') },
      { q: 'What are prerequisites for CSS 108?', check: (r) => r.content.includes('CSS 105') && r.content.toLowerCase().includes('eligible') },
      { q: 'Am I eligible for MAT 138?', check: (r) => r.content.toLowerCase().includes('eligible') && r.content.includes('MAT 137') },
      { q: 'Can I take CSS 215 already?', check: (r) => r.content.toLowerCase().includes('not eligible') && r.content.includes('CSS 108') },
      { q: 'Tell me about INF 376 prerequisites', check: (r) => r.content.includes('CSS 215') },
      { q: 'What is CSS 305 about?', check: (r) => r.content.toLowerCase().includes('database') },
      { q: 'What is CSS 405 about?', check: (r) => r.content.toLowerCase().includes('artificial intelligence') },
      { q: 'Can I take MATH 201 without MATH 101?', check: (r) => r.content.toLowerCase().includes('not eligible') && r.content.includes('MATH 101') },
      { q: 'Did I already pass CS 101?', check: (r) => r.content.toLowerCase().includes('already completed') && r.content.includes('B') },
      { q: 'Did I pass MAT 137?', check: (r) => r.content.toLowerCase().includes('already completed') && r.content.includes('C+') },
      { q: 'What is my current GPA?', check: (r) => r.content.includes('3.11') },
      { q: 'How many ECTS credits have I completed?', check: (r) => r.content.includes('15') },
      { q: 'What is in my current schedule?', check: (r) => r.content.includes('INF 451') },
      { q: 'What courses are in my registration basket?', check: (r) => r.content.includes('INF 451') },
      { q: 'Where can I see my curriculum roadmap?', check: (r) => r.links.some((l) => l.url === '/roadmap') },
      { q: 'What courses are recommended for me?', check: (r) => r.links.some((l) => l.url === '/recommendations') },
      { q: 'How are prerequisites checked?', check: (r) => r.content.toLowerCase().includes('prerequisite') },
      { q: 'Can I take FAKE 999?', check: (r) => r.content.toLowerCase().includes('not found') && !r.links.some((l) => l.code === 'FAKE 999') },
      { q: 'What is ABC 123?', check: (r) => r.content.toLowerCase().includes('not found') },
      { q: 'Могу ли я взять CS 201 в следующем семестре?', check: (r) => /[а-яё]/i.test(r.content) && r.content.includes('CS 201') },
      { q: 'Что нужно сдать для CSS 215?', check: (r) => /[а-яё]/i.test(r.content) && r.content.includes('CSS 108') },
      { q: 'Какой у меня сейчас GPA?', check: (r) => /[а-яё]/i.test(r.content) && r.content.includes('3.11') },
      { q: 'Что сейчас у меня в расписании?', check: (r) => /[а-яё]/i.test(r.content) && r.content.includes('INF 451') },
      { q: 'Какие курсы мне доступны по учебному плану?', check: (r) => /[а-яё]/i.test(r.content) && r.links.some((l) => l.url === '/roadmap') },
      { q: 'Who will win the football match tomorrow?', check: (r) => r.content.toLowerCase().includes('academic') },
      { q: 'What is the weather in Almaty today?', check: (r) => r.content.toLowerCase().includes('academic') },
      { q: 'Кто победит на чемпионате мира по футболу?', check: (r) => /[а-яё]/i.test(r.content) && r.content.includes('академическ') },
      { q: 'Write a recipe for pizza please', check: (r) => r.content.toLowerCase().includes('academic') },
    ];

    let passedCount = 0;
    const t0 = Date.now();
    for (const item of evalSet) {
      const r = await ragService.answerCurriculumQuestion({
        username: studentEligible,
        query: item.q,
      });
      if (item.check(r)) passedCount++;
    }
    const elapsedMs = Date.now() - t0;

    expect(passedCount).toBeGreaterThanOrEqual(29);
    expect(elapsedMs).toBeLessThan(10000);
  });
});

describe('US23: Act on Assistant Suggestions inside the Chat', () => {
  const studentPlanUser = 'test_us23_student';

  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await chatRepository.clearMessages(studentPlanUser);
    const existingPlan = await planRepository.getPlan(studentPlanUser);
    if (existingPlan) {
      await planRepository.deletePlan(studentPlanUser, existingPlan.target_semester);
    }

    await cacheRepository.setStudentData(studentPlanUser, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'CS 101', name: 'Introduction to Computer Science', ects: '5', status: 'passed', grade: 'B' },
      ],
      schedule: [],
    });
  });

  it('unauthenticated requests to POST /api/chat/plan/add return 401', async () => {
    const res = await request(app).post('/api/chat/plan/add').send({ courseCode: 'CS 201' });
    expect(res.status).toBe(401);
  });

  it('QA Scenario 1: Assistant returns eligible CS 201 card and student adds it to plan with updated ECTS', async () => {
    const chatRes = await chatService.sendMessage(studentPlanUser, 'Can I take CS 201 next semester?');
    const cards = chatRes.assistantMessage.courseCards;
    expect(Array.isArray(cards)).toBe(true);
    const cs201Card = cards.find((c) => c.code === 'CS 201');
    expect(cs201Card).toBeDefined();
    expect(cs201Card.eligible).toBe(true);
    expect(cs201Card.eligibilityStatus).toBe('eligible');

    const addRes = await chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 201' });
    expect(addRes.success).toBe(true);
    expect(addRes.totalEcts).toBe(5);
    expect(addRes.confirmationMessage.content).toContain('CS 201');
    expect(addRes.confirmationMessage.content).toContain('5 / 21 ECTS');

    const saved = await planRepository.getPlan(studentPlanUser);
    expect(saved).toBeDefined();
    expect(saved.total_ects).toBe(5);
    expect(saved.courses.some((c) => c.code === 'CS 201')).toBe(true);
  });

  it('QA Scenario 2: Ineligible course card (CS 301) shows not_eligible + missing prerequisites and blocks adding to plan', async () => {
    const chatRes = await chatService.sendMessage(studentPlanUser, 'Can I take CS 301?');
    const cs301Card = chatRes.assistantMessage.courseCards.find((c) => c.code === 'CS 301');
    expect(cs301Card).toBeDefined();
    expect(cs301Card.eligible).toBe(false);
    expect(cs301Card.eligibilityStatus).toBe('not_eligible');
    expect(cs301Card.missingPrerequisites.some((m) => m.code === 'CS 201')).toBe(true);

    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 301' })
    ).rejects.toThrow(/Missing prerequisites/i);

    const saved = await planRepository.getPlan(studentPlanUser);
    expect(saved).toBeNull();
  });

  it('rejects adding already completed or in-progress courses and enforces ECTS policy limit', async () => {
    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 101' })
    ).rejects.toThrow(/already completed/i);

    await cacheRepository.setStudentData(studentPlanUser, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'CS 101', name: 'Introduction to Computer Science', ects: '5', status: 'passed', grade: 'B' },
        { code: 'CSS 105', name: 'Fundamentals of Programming', ects: '5', status: 'taken', grade: 'IP' },
      ],
      schedule: [
        { code: 'INF 451', kind: 'N', section: '01', slots: [{ day: 4, time: '08:30' }] },
      ],
    });

    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CSS 105' })
    ).rejects.toThrow(/already in progress/i);

    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'INF 451' })
    ).rejects.toThrow(/already in progress/i);

    // Pre-fill plan to 20 ECTS, then try adding another 5 ECTS course (> 21 max)
    await planRepository.savePlan(
      studentPlanUser,
      1,
      [
        { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5 },
        { code: 'MAT 137', name: 'Mathematics 1', ects: 5 },
        { code: 'MATH 101', name: 'Calculus I', ects: 5 },
        { code: 'HIST 101', name: 'History of Kazakhstan', ects: 5 },
      ],
      20,
      true
    );

    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 201', targetSemester: 1 })
    ).rejects.toThrow(/exceed.*21 ECTS/i);
  });

  it('allows removing an added course from the study plan and updates ECTS total', async () => {
    await chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 201' });
    await chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'MAT 137' });

    const midPlan = await planRepository.getPlan(studentPlanUser);
    expect(midPlan.total_ects).toBe(10);

    const rem1 = await chatService.removeCourseFromPlanFromChat(studentPlanUser, { courseCode: 'CS 201' });
    expect(rem1.success).toBe(true);
    expect(rem1.totalEcts).toBe(5);
    expect(rem1.confirmationMessage.content).toContain('Removed **CS 201**');
    expect(rem1.confirmationMessage.content).toContain('5 / 21 ECTS');

    const rem2 = await chatService.removeCourseFromPlanFromChat(studentPlanUser, { courseCode: 'MAT 137' });
    expect(rem2.totalEcts).toBe(0);
    expect(rem2.plan).toBeNull();
    const afterEmpty = await planRepository.getPlan(studentPlanUser);
    expect(afterEmpty).toBeNull();
  });

  it('matches passed courses by title too (e.g. MDE 171 passed blocks HIST 101 History of Kazakhstan)', async () => {
    await cacheRepository.setStudentData(studentPlanUser, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'cs_track', title: 'CS Track' },
      progTrack: 'Computer Science',
      approved: [
        { code: 'MDE 171', name: 'History of Kazakhstan', ects: '5', status: 'passed', grade: 'B+' },
      ],
      schedule: [],
    });

    const ctx = await ragService.buildStudentContext(studentPlanUser);
    const histCard = ctx.coursesMap.get('HIST 101');
    expect(histCard.status).toBe('passed');

    const chatRes = await chatService.sendMessage(studentPlanUser, 'Can I take HIST 101?');
    const card = chatRes.assistantMessage.courseCards.find((c) => c.code === 'HIST 101');
    expect(card.alreadyCompleted).toBe(true);

    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'HIST 101' })
    ).rejects.toThrow(/already completed/i);
  });

  it('fixes greeting interception, substring guardrail false-positives, XXX placeholders, and saved reason', async () => {
    // Greeting + real question -> answers CS 201 question directly
    const greetWithQ = await chatService.sendMessage(studentPlanUser, 'Hello, can I take CS 201 next semester?');
    expect(greetWithQ.assistantMessage.content).toContain('CS 201');
    expect(greetWithQ.assistantMessage.courseCards.some((c) => c.code === 'CS 201')).toBe(true);

    // Off-topic substring traps -> cleanly declined
    const planeRes = await chatService.sendMessage(studentPlanUser, 'Who will win the airplane race?');
    expect(planeRes.assistantMessage.content.toLowerCase()).toContain('academic');

    const currencyRes = await chatService.sendMessage(studentPlanUser, 'Какой сейчас курс доллара?');
    expect(currencyRes.assistantMessage.content).toContain('академическ');

    // Placeholder elective cannot be added directly to plan
    await expect(
      chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'XXX 10X' })
    ).rejects.toThrow(/specific elective course/i);

    // Saved course from chat retains non-empty reason for RecommendationsPage
    const addRes = await chatService.addCourseToPlanFromChat(studentPlanUser, { courseCode: 'CS 201' });
    const savedCourse = addRes.plan.courses.find((c) => c.code === 'CS 201');
    expect(typeof savedCourse.reason).toBe('string');
    expect(savedCourse.reason.length).toBeGreaterThan(5);
  });
});
