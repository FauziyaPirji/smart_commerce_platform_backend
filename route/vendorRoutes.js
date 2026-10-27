import express from "express";
import { registerVendor, loginVendor, getVendors, getVendorById, getVendorCustomers, getVendorCustomerById, updateVendor, deleteVendor, approveVendor, suspendVendor, getVendorProfile, updateVendorProfile, getVendorStore, updateVendorStore, changeVendorPassword, getVendorOrders, updateVendorOrderStatus, getVendorEarnings, getVendorPayouts, getVendorPayoutById } from "../controller/vendorController.js";
import authenticateToken from "../utils/authMiddleware.js";
import upload from "../utils/uploadMiddleware.js";

const vendorRouter = express.Router();

vendorRouter.get("/api/vendors/store", authenticateToken, getVendorStore);
vendorRouter.put("/api/vendors/store", authenticateToken, upload.single("logo"), updateVendorStore);
vendorRouter.put("/api/vendors/change-password", authenticateToken, changeVendorPassword);

vendorRouter.get("/api/vendors/earnings", authenticateToken, getVendorEarnings);
vendorRouter.get("/api/vendors/payouts", authenticateToken, getVendorPayouts);
vendorRouter.get("/api/vendors/payouts/:id", authenticateToken, getVendorPayoutById);

vendorRouter.post("/api/vendors/register", registerVendor);
vendorRouter.post("/api/vendors/login", loginVendor);
vendorRouter.get("/api/vendors", authenticateToken, getVendors);
vendorRouter.get("/api/vendors/profile", authenticateToken, getVendorProfile);
vendorRouter.put("/api/vendors/profile", authenticateToken, updateVendorProfile);
vendorRouter.get("/api/vendors/:id", authenticateToken, getVendorById);
vendorRouter.get("/api/vendors/customers", authenticateToken, getVendorCustomers);
vendorRouter.get("/api/vendors/customers/:id", authenticateToken, getVendorCustomerById);
vendorRouter.delete("/api/vendors/:id", authenticateToken, deleteVendor);
vendorRouter.put("/api/vendors/:id/approve", authenticateToken, approveVendor);
vendorRouter.put("/api/vendors/:id/suspend", authenticateToken, suspendVendor);

vendorRouter.get("/api/vendors/orders", authenticateToken, getVendorOrders);
vendorRouter.patch("/api/vendors/orders/:id/status", authenticateToken, updateVendorOrderStatus);
vendorRouter.put("/api/vendors/orders/:id", authenticateToken, updateVendorOrderStatus);

export default vendorRouter;
