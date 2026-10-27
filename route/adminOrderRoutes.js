import express from "express";
import { getAllAdminOrders, getAdminOrderById, updateAdminOrderStatus, } from "../controller/adminOrderController.js";
import authenticateToken from "../utils/authMiddleware.js";

const adminOrderRouter = express.Router();

adminOrderRouter.get("/api/admin/orders", authenticateToken, getAllAdminOrders);
adminOrderRouter.get("/api/admin/orders/:id", authenticateToken, getAdminOrderById);
adminOrderRouter.put("/api/admin/orders/:id/status", authenticateToken, updateAdminOrderStatus);

export default adminOrderRouter;