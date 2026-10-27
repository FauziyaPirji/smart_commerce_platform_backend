import express from "express";
import { getAdminCustomers, getCustomerById, updateCustomerStatus, getContactMessages, replyContactMessage } from "../controller/adminCustomerController.js";
import { getAllAdminPayments, getAdminPaymentById, updateAdminPayment, } from "../controller/adminPaymentController.js";
import { getAdminPayouts, getAdminPayoutById, createAdminPayout, } from "../controller/adminPayoutController.js";
import authenticateToken from "../utils/authMiddleware.js";

const adminRouter = express.Router();

adminRouter.get("/api/admin/customers", authenticateToken, getAdminCustomers);
adminRouter.get("/api/admin/customers/:id", authenticateToken, getCustomerById);
adminRouter.put("/api/admin/customers/:id/status", authenticateToken, updateCustomerStatus);

adminRouter.get("/api/admin/payments", authenticateToken, getAllAdminPayments);
adminRouter.get("/api/admin/payments/:id", authenticateToken, getAdminPaymentById);
adminRouter.put("/api/admin/payments/:id", authenticateToken, updateAdminPayment);

adminRouter.get("/api/admin/contact-messages", getContactMessages);
adminRouter.post("/api/admin/contact-messages/:messageId/reply", replyContactMessage);

adminRouter.get("/api/admin/payouts", authenticateToken, getAdminPayouts);
adminRouter.get("/api/admin/payouts/:id", authenticateToken, getAdminPayoutById);
adminRouter.post("/api/admin/payouts", authenticateToken, createAdminPayout);

export default adminRouter ;