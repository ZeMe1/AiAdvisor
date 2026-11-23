import { chatRepository } from '../repositories/chat.repository.mjs';
import { planRepository } from '../repositories/plan.repository.mjs';
import { guardrailConfigRepository } from '../repositories/guardrail-config.repository.mjs';
import { guardrailService } from './guardrail.service.mjs';
import { ragService, normalizeCourseCode } from './rag.service.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class ChatService {
  async getChatHistory(username) {
    if (!username) throw HttpError.unauthorized('User not authenticated');
    return chatRepository.getMessages(username);
  }

  async sendMessage(username, messageText, client = null) {
    if (!username) throw HttpError.unauthorized('User not authenticated');
    const cleanText = String(messageText || '').trim();
    if (!cleanText) throw HttpError.badRequest('Message cannot be empty');

    // Fetch brief recent conversation history and active guardrail rules
    const [history, guardrailConfig] = await Promise.all([
      chatRepository.getMessages(username, 12),
      guardrailConfigRepository.getActiveConfig(),
    ]);

    // Pre-execution input guardrail: redact PII/passwords/cards BEFORE saving to chat logs & check blocked topics
    const inputCheck = guardrailService.moderateInput(cleanText, guardrailConfig);

    // 1. Save sanitized user's message (never store raw sensitive secrets/cards)
    const userMsg = await chatRepository.addMessage(username, 'user', inputCheck.sanitizedQuery);

    let reply;
    if (inputCheck.blocked) {
      reply = {
        content: guardrailService.redactSensitiveData(inputCheck.refusalReply).text,
        links: [
          { label: 'Curriculum Roadmap', url: '/roadmap', type: 'page' },
          { label: 'Course Recommendations', url: '/recommendations', type: 'page' },
        ],
        courseCards: [],
        wasRefusal: true,
      };
    } else {
      // 2. Generate grounded curriculum RAG answer + actionable courseCards
      const rawReply = await ragService.answerCurriculumQuestion({
        username,
        query: inputCheck.sanitizedQuery,
        history,
        client,
      });

      // 3. Post-generation output guardrail: redact & attach mandatory disclaimer for deadlines/rules
      reply = {
        ...rawReply,
        content: guardrailService.moderateOutput(
          rawReply.content,
          inputCheck.sanitizedQuery,
          guardrailConfig
        ),
      };
    }

    // 4. Save assistant's reply + verified clickable links & course cards
    const assistantMsg = await chatRepository.addMessage(
      username,
      'assistant',
      reply.content,
      {
        links: reply.links || [],
        courseCards: reply.courseCards || [],
        wasRefusal: Boolean(inputCheck.blocked || reply.wasRefusal),
      }
    );

    return {
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    };
  }

  /**
   * US23: Validates and adds a suggested course directly from the chat card into the student's semester plan.
   */
  async addCourseToPlanFromChat(username, { courseCode, targetSemester } = {}, client = null) {
    if (!username) throw HttpError.unauthorized('User not authenticated');
    const cleanCode = normalizeCourseCode(courseCode);
    if (!cleanCode) throw HttpError.badRequest('Course code is required');

    const studentContext = await ragService.buildStudentContext(username, client);
    if (/^XXX/i.test(cleanCode)) {
      throw HttpError.badRequest(
        `Please select a specific elective course rather than the elective placeholder group (${cleanCode})`
      );
    }

    const course = studentContext.coursesMap.get(cleanCode);
    if (!course) {
      throw HttpError.notFound(`Course '${cleanCode}' was not found in the curriculum or catalog`);
    }

    if (course.status === 'passed') {
      throw HttpError.badRequest(`Course ${course.code} is already completed`);
    }

    if (course.status === 'taken' || course.grade === 'IP' || studentContext.inProgressCodes?.has(course.code)) {
      throw HttpError.badRequest(`Course ${course.code} is already in progress in your current semester`);
    }

    // Strict prerequisite eligibility check (matches Plan / Eligibility validation)
    if (!course.eligible) {
      throw HttpError.badRequest(
        course.eligibilityReason || `Course ${course.code} prerequisites are not satisfied`
      );
    }

    const existingLatest = await planRepository.getPlan(username, targetSemester || null);
    const sem = Number(targetSemester) || Number(existingLatest?.target_semester) || studentContext.targetSemester || 1;
    const planForSem =
      existingLatest && Number(existingLatest.target_semester) === sem
        ? existingLatest
        : await planRepository.getPlan(username, sem);

    const existingCourses = Array.isArray(planForSem?.courses) ? [...planForSem.courses] : [];
    const alreadyInSem = existingCourses.some((c) => normalizeCourseCode(c.code) === course.code);
    const currentEcts = existingCourses.reduce((sum, c) => sum + (Number(c.ects) || 5), 0);
    const courseEcts = Number(course.ects) || 5;

    if (alreadyInSem) {
      return {
        success: true,
        alreadyInPlan: true,
        targetSemester: sem,
        totalEcts: currentEcts,
        maxEcts: studentContext.maxEcts,
        plan: planForSem,
        confirmationMessage: null,
      };
    }

    if (currentEcts + courseEcts > studentContext.maxEcts) {
      throw HttpError.badRequest(
        `Adding ${course.code} (${courseEcts} ECTS) would exceed the ${studentContext.maxEcts} ECTS semester limit (current plan: ${currentEcts} ECTS)`
      );
    }

    const updatedCourses = [
      ...existingCourses,
      {
        code: course.code,
        name: course.name,
        ects: courseEcts,
        semester: course.semester || sem,
        isMandatory: String(course.type || '').toLowerCase() !== 'elective',
        isRetake: course.status === 'failed',
        reason: course.reason || course.eligibilityReason || (course.status === 'failed'
          ? 'Previously failed course — retake prioritized'
          : `Added from AI Academic Assistant for Semester ${sem}`),
      },
    ];
    const updatedTotalEcts = currentEcts + courseEcts;

    const savedPlan = await planRepository.savePlan(
      username,
      sem,
      updatedCourses,
      updatedTotalEcts,
      true
    );

    const replyText = `Added **${course.code}** (${course.name}, ${courseEcts} ECTS) to your **Semester ${sem}** study plan.\nUpdated plan total: **${updatedTotalEcts} / ${studentContext.maxEcts} ECTS** (${updatedCourses.length} course(s)).`;
    const confirmationMessage = await chatRepository.addMessage(
      username,
      'assistant',
      replyText,
      {
        links: ragService.validateLinks([], ['/recommendations', '/roadmap'], studentContext),
        courseCards: [],
      }
    );

    return {
      success: true,
      alreadyInPlan: false,
      targetSemester: sem,
      totalEcts: updatedTotalEcts,
      maxEcts: studentContext.maxEcts,
      plan: savedPlan,
      confirmationMessage,
    };
  }

  /**
   * US23: Removes a course from the student's semester study plan (from chat card or plan page) and recalculates ECTS.
   */
  async removeCourseFromPlanFromChat(username, { courseCode, targetSemester } = {}, client = null) {
    if (!username) throw HttpError.unauthorized('User not authenticated');
    const cleanCode = normalizeCourseCode(courseCode);
    if (!cleanCode) throw HttpError.badRequest('Course code is required');

    const studentContext = await ragService.buildStudentContext(username, client);
    const existingLatest = await planRepository.getPlan(username, targetSemester || null);
    if (!existingLatest) {
      throw HttpError.notFound('No saved study plan found for this semester');
    }

    const sem = Number(targetSemester) || Number(existingLatest.target_semester) || 1;
    const planForSem =
      Number(existingLatest.target_semester) === sem
        ? existingLatest
        : await planRepository.getPlan(username, sem);

    if (!planForSem || !Array.isArray(planForSem.courses)) {
      throw HttpError.notFound(`No saved study plan found for Semester ${sem}`);
    }

    const updatedCourses = planForSem.courses.filter((c) => normalizeCourseCode(c.code) !== cleanCode);
    const updatedTotalEcts = updatedCourses.reduce((sum, c) => sum + (Number(c.ects) || 5), 0);

    let savedPlan = null;
    if (updatedCourses.length === 0) {
      await planRepository.deletePlan(username, sem);
    } else {
      savedPlan = await planRepository.savePlan(
        username,
        sem,
        updatedCourses,
        updatedTotalEcts,
        true
      );
    }

    const replyText = `Removed **${cleanCode}** from your **Semester ${sem}** study plan.\nUpdated plan total: **${updatedTotalEcts} / ${studentContext.maxEcts} ECTS** (${updatedCourses.length} course(s)).`;
    const confirmationMessage = await chatRepository.addMessage(
      username,
      'assistant',
      replyText,
      {
        links: ragService.validateLinks([], ['/recommendations', '/roadmap'], studentContext),
        courseCards: [],
      }
    );

    return {
      success: true,
      targetSemester: sem,
      totalEcts: updatedTotalEcts,
      maxEcts: studentContext.maxEcts,
      plan: savedPlan,
      confirmationMessage,
    };
  }

  async clearChatHistory(username) {
    if (!username) throw HttpError.unauthorized('User not authenticated');
    await chatRepository.clearMessages(username);
    return { success: true };
  }
}

export const chatService = new ChatService();
