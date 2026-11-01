import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage if not present
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('ScheduleStore Local-First Caching', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads curriculum from API and caches it in localStorage', async () => {
    const { api } = await import('../web/src/api.js');
    const mockCurriculum = { program: { title: 'Test Prog' }, semesters: [] };
    const curriculumSpy = vi.spyOn(api, 'curriculum').mockResolvedValue(mockCurriculum);

    const { useScheduleStore } = await import('../web/src/stores/scheduleStore.js');

    useScheduleStore.setState({ curriculum: null, coursesCache: {} });

    const result = await useScheduleStore.getState().loadCurriculum(true);
    expect(result).toEqual(mockCurriculum);
    expect(curriculumSpy).toHaveBeenCalledTimes(1);

    // Verify written to localStorage
    const saved = JSON.parse(localStorage.getItem('zeme_curriculum_cache_v1'));
    expect(saved).toEqual(mockCurriculum);

    // Subsequent call should use memory / cache and NOT call API again
    curriculumSpy.mockClear();
    const cachedResult = await useScheduleStore.getState().loadCurriculum(false);
    expect(cachedResult).toEqual(mockCurriculum);
    expect(curriculumSpy).not.toHaveBeenCalled();

    curriculumSpy.mockRestore();
  });

  it('serves course sections from cache instantly without API call', async () => {
    const { api } = await import('../web/src/api.js');
    const mockSections = {
      course: { code: 'CSS 101', name: 'Intro to CS' },
      theory: [{ id: '101', section: '01', teacher: 'Turing', schedule: [] }],
      practice: [],
      lab: [],
    };

    const sectionsSpy = vi.spyOn(api, 'sections').mockResolvedValue(mockSections);
    const { useScheduleStore } = await import('../web/src/stores/scheduleStore.js');

    useScheduleStore.setState({ openCourse: null, coursesCache: {} });

    // First load -> calls API and caches in localStorage
    const firstLoad = await useScheduleStore.getState().loadCourse('CSS 101');
    expect(firstLoad.code).toBe('CSS 101');
    expect(sectionsSpy).toHaveBeenCalledTimes(1);

    // Verify localStorage has the cached course
    const savedCourses = JSON.parse(localStorage.getItem('zeme_courses_cache_v1'));
    expect(savedCourses['CSS 101:norm']).toBeDefined();
    expect(savedCourses['CSS 101:norm'].course.code).toBe('CSS 101');

    // Second load -> immediately from cache, API is NOT called
    sectionsSpy.mockClear();
    const secondLoad = await useScheduleStore.getState().loadCourse('CSS 101');
    expect(secondLoad.code).toBe('CSS 101');
    expect(sectionsSpy).not.toHaveBeenCalled();

    sectionsSpy.mockRestore();
  });

  it('clearAllCache removes cached courses and curriculum from memory and localStorage', async () => {
    const { useScheduleStore } = await import('../web/src/stores/scheduleStore.js');

    useScheduleStore.setState({
      curriculum: { dummy: 1 },
      coursesCache: { 'TEST:norm': { data: true } },
    });
    localStorage.setItem('zeme_curriculum_cache_v1', JSON.stringify({ dummy: 1 }));
    localStorage.setItem('zeme_courses_cache_v1', JSON.stringify({ 'TEST:norm': { data: true } }));

    useScheduleStore.getState().clearAllCache();

    expect(useScheduleStore.getState().curriculum).toBeNull();
    expect(useScheduleStore.getState().coursesCache).toEqual({});
    expect(localStorage.getItem('zeme_curriculum_cache_v1')).toBeNull();
    expect(localStorage.getItem('zeme_courses_cache_v1')).toBeNull();
  });
});
