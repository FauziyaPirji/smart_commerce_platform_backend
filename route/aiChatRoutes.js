import express from "express";
import authenticateToken from "../utils/authMiddleware.js";
import { adminAIChat, vendorAIChat } from "../controller/aiChatController.js";

const aiChatRouter = express.Router();

aiChatRouter.post("/api/admin/chat", authenticateToken, adminAIChat);
aiChatRouter.post("/api/vendor/chat", authenticateToken, vendorAIChat);

export default aiChatRouter;