import express from "express";
import { getVendorInventory, adjustStock, getInventoryLogs, } from "../controller/inventoryController.js";
import authenticateToken from "../utils/authMiddleware.js";

const inventoryRouter = express.Router();

inventoryRouter.get("/api/vendor/inventory/", authenticateToken, getVendorInventory);
inventoryRouter.post("/api/vendor/inventory/adjust", authenticateToken, adjustStock);
inventoryRouter.get("/api/vendor/inventory/logs", authenticateToken, getInventoryLogs);

export default inventoryRouter;