import { messagesService } from '../services/messages.service.mjs';
import { presenceService } from '../services/presence.service.mjs';

function getAuthContext(req) {
  const username = req.client?.localUsername || req.session?.username || null;
  const role = req.client?.localRole || req.session?.role || 'Student';
  return { username, role };
}

export class MessagesController {
  async sync(req, res) {
    const { username, role } = getAuthContext(req);
    const result = await messagesService.syncForUser(username, role, req.query?.since || null);
    res.json(result);
  }

  async getMyPresence(req, res) {
    const { username } = getAuthContext(req);
    const result = await presenceService.getMyPresence(username);
    res.json(result);
  }

  async updateOfficeHours(req, res) {
    const { username, role } = getAuthContext(req);
    const result = await presenceService.updateMyOfficeHours(username, role, req.body);
    res.json(result);
  }

  async getStudentAdvisorPresence(req, res) {
    const { username } = getAuthContext(req);
    const result = await presenceService.getAdvisorPresenceForStudent(username, req.query?.advisor || null);
    res.json(result);
  }

  async getStudentDialog(req, res) {
    const { username } = getAuthContext(req);
    const result = await messagesService.getStudentConversation(username, req.query?.advisor || null);
    res.json(result);
  }

  async sendStudentMessage(req, res) {
    const { username } = getAuthContext(req);
    const message = await messagesService.sendStudentMessage(username, req.body);
    res.status(201).json({ message });
  }

  async getStudentAnnouncements(req, res) {
    const { username } = getAuthContext(req);
    const result = await messagesService.getStudentAnnouncements(username, { markAsRead: false });
    res.json(result);
  }

  async markStudentAnnouncementsRead(req, res) {
    const { username } = getAuthContext(req);
    const result = await messagesService.markStudentAnnouncementsRead(username);
    res.json(result);
  }

  async getAdvisorInbox(req, res) {
    const { username, role } = getAuthContext(req);
    const result = await messagesService.getAdvisorInbox(username, role);
    res.json(result);
  }

  async getAdvisorThread(req, res) {
    const { username, role } = getAuthContext(req);
    const result = await messagesService.getAdvisorStudentThread(username, role, req.params.studentUsername);
    res.json(result);
  }

  async sendAdvisorMessage(req, res) {
    const { username, role } = getAuthContext(req);
    const message = await messagesService.sendAdvisorMessage(username, role, req.params.studentUsername, req.body);
    res.status(201).json({ message });
  }

  async getGroupAnnouncements(req, res) {
    const { username, role } = getAuthContext(req);
    const result = await messagesService.getGroupAnnouncementsForAdvisor(username, role, req.params.groupId);
    res.json(result);
  }

  async sendGroupAnnouncement(req, res) {
    const { username, role } = getAuthContext(req);
    const announcement = await messagesService.sendGroupAnnouncement(username, role, req.params.groupId, req.body);
    res.status(201).json({ announcement });
  }
}

export const messagesController = new MessagesController();
