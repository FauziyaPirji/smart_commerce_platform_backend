import express from "express";
import { getAdminDashboard, getVendorDashboard, } from "../controller/dashboardController.js";
import authenticateToken from "../utils/authMiddleware.js";

const dashboardRouter = express.Router();

dashboardRouter.get("/api/admin/dashboard", authenticateToken, getAdminDashboard);
dashboardRouter.get("/api/vendors/dashboard", authenticateToken, getVendorDashboard);

export default dashboardRouter;