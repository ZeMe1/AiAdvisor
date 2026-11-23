import { chatService } from '../services/chat.service.mjs';

export class ChatController {
  async getMessages(req, res) {
    const username = req.client?.localUsername || req.session?.username || 'Student';
    const messages = await chatService.getChatHistory(username);
    res.json({ messages });
  }

  async sendMessage(req, res) {
    const username = req.client?.localUsername || req.session?.username || 'Student';
    const result = await chatService.sendMessage(username, req.body.message, req.client);
    res.status(201).json(result);
  }

  async addCourseToPlan(req, res) {
    const username = req.client?.localUsername || req.session?.username || 'Student';
    const result = await chatService.addCourseToPlanFromChat(username, req.body, req.client);
    res.status(200).json(result);
  }

  async removeCourseFromPlan(req, res) {
    const username = req.client?.localUsername || req.session?.username || 'Student';
    const result = await chatService.removeCourseFromPlanFromChat(username, req.body, req.client);
    res.status(200).json(result);
  }

  async clearMessages(req, res) {
    const username = req.client?.localUsername || req.session?.username || 'Student';
    const result = await chatService.clearChatHistory(username);
    res.json(result);
  }
}

export const chatController = new ChatController();
