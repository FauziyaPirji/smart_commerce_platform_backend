import express from "express";
import authenticateToken from "../utils/authMiddleware.js";
import { createRazorpayOrder, verifyAndCreateOrder, createOrder, getUserOrders, getOrderById, cancelOrder, updateOrderItemStatus, cancelOrderItem, } from "../controller/orderController.js";

const router = express.Router();

router.post("/api/customer/orders/razorpay-order", authenticateToken, createRazorpayOrder);
router.post("/api/customer/orders/verify-payment", authenticateToken, verifyAndCreateOrder);
router.post("/api/customer/orders", authenticateToken, createOrder);
router.get("/api/customer/orders", authenticateToken, getUserOrders);
router.get("/api/customer/orders/:id", authenticateToken, getOrderById);
router.put("/api/customer/orders/:id/cancel", authenticateToken, cancelOrder);
router.put("/items/:itemId/status", authenticateToken, updateOrderItemStatus);
router.put("/items/:itemId/cancel", authenticateToken, cancelOrderItem);

export default router;