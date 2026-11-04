import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDb, pool } from '../server/db.mjs';
import { simulationService, advanceTerm, calculateOverloadRisk } from '../server/services/simulation.service.mjs';
import { scheduleService } from '../server/services/schedule.service.mjs';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';

describe("US18: Simulate 'What-if' Scenarios", () => {
  beforeAll(async () => {
    await initDb();
  });

  const mockCurriculum = {
    program: { title: 'Computer Science', track: 'General', year: 2024 },
    semesters: [
      {
        no: 1,
        courses: [
          { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, credits: 3, status: 'passed', grade: 'B+' },
          { code: 'MAT 137', name: 'Mathematics 1', ects: 5, credits: 3, status: 'passed', grade: 'B' },
          { code: 'MDE 162', name: 'Academic English 1', ects: 5, credits: 3, status: 'passed', grade: 'B+' },
        ],
      },
      {
        no: 2,
        courses: [
          { code: 'CSS 108', name: 'Programming Technologies', ects: 5, credits: 3, status: 'passed', grade: 'B' },
          { code: 'MAT 138', name: 'Mathematics 2', ects: 5, credits: 3, status: 'passed', grade: 'B+' },
          { code: 'MDE 171', name: 'Academic English 2', ects: 5, credits: 3, status: 'passed', grade: 'B' },
        ],
      },
      {
        no: 3,
        courses: [
          { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'CSS 216', name: 'Mobile Application Development', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'INF 318', name: 'Computer Networks', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'MDE 291', name: 'Philosophy', ects: 5, credits: 3, status: 'available', grade: null },
        ],
      },
      {
        no: 4,
        courses: [
          { code: 'CSS 311', name: 'Software Engineering', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'INF 325', name: 'Database Systems', ects: 5, credits: 3, status: 'available', grade: null },
        ],
      },
    ],
  };

  it('Unit: advanceTerm correctly advances semester terms', () => {
    expect(advanceTerm('2026 - 2027 Fall', 1)).toBe('2026 - 2027 Spring');
    expect(advanceTerm('2026 - 2027 Fall', 2)).toBe('2027 - 2028 Fall');
    expect(advanceTerm('2026 - 2027 Fall', 3)).toBe('2027 - 2028 Spring');
    expect(advanceTerm('2026 - 2027 Fall', 4)).toBe('2028 - 2029 Fall');
  });

  it('Unit: calculateOverloadRisk correctly assigns risk categories based on load and GPA', () => {
    // 12 ECTS must trigger 'Medium overload risk' as required by QA Acceptance Criteria
    const lightRisk = calculateOverloadRisk(12, '3.20');
    expect(lightRisk.riskLevel).toBe('Medium');
    expect(lightRisk.riskWarning).toBe('Medium overload risk');

    // 21 ECTS standard load -> Low risk
    const standardRisk = calculateOverloadRisk(21, '3.20');
    expect(standardRisk.riskLevel).toBe('Low');
    expect(standardRisk.riskWarning).toBe('Low risk');

    // 32 ECTS heavy load with low GPA -> High overload risk
    const heavyLowGpa = calculateOverloadRisk(32, '2.40');
    expect(heavyLowGpa.riskLevel).toBe('High');
    expect(heavyLowGpa.riskWarning).toBe('High overload risk');
  });

  it('Scenario 1: Student runs a light-load simulation (12 ECTS) — shows later graduation date than with 21 ECTS and Medium overload risk', async () => {
    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CSS 215': { eligible: true },
        'CSS 216': { eligible: true },
        'INF 318': { eligible: true },
        'MDE 291': { eligible: true },
      },
    });

    const client = { localUsername: 'test_sim_user_1', term: '2026 - 2027 Fall' };

    // 1. Run simulation with 12 ECTS
    const sim12 = await simulationService.simulateWhatIf(client, { targetEctsPerSemester: 12, numSemesters: 2 });

    // 2. Run simulation with 21 ECTS
    const sim21 = await simulationService.simulateWhatIf(client, { targetEctsPerSemester: 21, numSemesters: 2 });

    // System: (Pass) The simulation with 12 ECTS shows a later graduation date than with 21 ECTS
    expect(sim12.projection.semestersNeeded).toBeGreaterThan(sim21.projection.semestersNeeded);
    expect(sim12.projection.delayInSemesters).toBeGreaterThan(0);

    // QA Scenario: The system shows the projected graduation date and the risk warning 'Medium overload risk'
    expect(sim12.risk.riskWarning).toBe('Medium overload risk');
    expect(sim12.risk.riskLevel).toBe('Medium');
    expect(sim12.projection.projectedGraduationTerm).toBeDefined();

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
  });

  it('Scenario 2: Simulation enforces strict non-persistence and includes simulation watermark', async () => {
    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'CSS 215': { eligible: true } },
    });

    const client = { localUsername: 'test_sim_user_no_side_effects', term: '2026 - 2027 Fall' };

    // Record DB count before
    const beforeFeedbacks = await pool.query("SELECT COUNT(*) FROM recommendation_feedback WHERE username = 'test_sim_user_no_side_effects'");
    const beforeSessions = await pool.query("SELECT COUNT(*) FROM sessions WHERE username = 'test_sim_user_no_side_effects'");

    // Run simulation
    const sim = await simulationService.simulateWhatIf(client, { targetEctsPerSemester: 15, numSemesters: 2 });

    // Record DB count after
    const afterFeedbacks = await pool.query("SELECT COUNT(*) FROM recommendation_feedback WHERE username = 'test_sim_user_no_side_effects'");
    const afterSessions = await pool.query("SELECT COUNT(*) FROM sessions WHERE username = 'test_sim_user_no_side_effects'");

    // Constraint: System must create 0 database records during simulation
    expect(beforeFeedbacks.rows[0].count).toBe('0');
    expect(afterFeedbacks.rows[0].count).toBe('0');
    expect(beforeSessions.rows[0].count).toBe('0');
    expect(afterSessions.rows[0].count).toBe('0');

    // Constraint: Simulation results must be marked with a 'simulation' watermark to avoid confusion
    expect(sim.isSimulation).toBe(true);
    expect(sim.watermark).toContain('SIMULATION');
    expect(sim.simulationNotice).toContain('sandbox simulation');

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
  });

  it('Scenario 3: Simulates next 2 semesters with chained prerequisite progression', async () => {
    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CSS 215': { eligible: true },
        'CSS 216': { eligible: true },
        'INF 318': { eligible: true },
        'MDE 291': { eligible: true },
        'CSS 311': { eligible: true },
        'INF 325': { eligible: true },
      },
    });

    const client = { localUsername: 'test_sim_chain_user', term: '2026 - 2027 Fall' };
    const sim = await simulationService.simulateWhatIf(client, { targetEctsPerSemester: 10, numSemesters: 2 });

    expect(sim.simulatedSemesters).toHaveLength(2);
    expect(sim.simulatedSemesters[0].semesterIndex).toBe(1);
    expect(sim.simulatedSemesters[0].termName).toBe('2026 - 2027 Spring');
    expect(sim.simulatedSemesters[0].totalEcts).toBeLessThanOrEqual(10);

    expect(sim.simulatedSemesters[1].semesterIndex).toBe(2);
    expect(sim.simulatedSemesters[1].termName).toBe('2027 - 2028 Fall');
    expect(sim.simulatedSemesters[1].totalEcts).toBeLessThanOrEqual(10);

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
  });
});
