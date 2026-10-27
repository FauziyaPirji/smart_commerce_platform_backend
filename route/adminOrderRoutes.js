import express from "express";
import { getAllAdminOrders, getAdminOrderById, updateAdminOrderStatus, } from "../controller/adminOrderController.js";

const adminOrderRouter = express.Router();

adminOrderRouter.get("/api/admin/orders", getAllAdminOrders);
adminOrderRouter.get("/api/admin/orders/:id", getAdminOrderById);
adminOrderRouter.put("/api/admin/orders/:id/status", updateAdminOrderStatus);

export default adminOrderRouter;