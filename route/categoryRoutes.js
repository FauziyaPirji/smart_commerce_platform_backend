import express from "express";
import { getCategories, getCategoryById, createCategory, updateCategory, deleteCategory, getCategoriesAll } from "../controller/categoryController.js";
import authenticateToken from "../utils/authMiddleware.js";
import upload from "../utils/uploadMiddleware.js";

const categoryRouter = express.Router();

categoryRouter.get("/api/categories", authenticateToken, getCategories);
categoryRouter.get("/api/categories-list", getCategories);
categoryRouter.get("/api/categories-all", authenticateToken, getCategoriesAll)
categoryRouter.post("/api/categories", authenticateToken, upload.single("image"), createCategory);
categoryRouter.get("/api/categories/:id", authenticateToken, getCategoryById);
categoryRouter.put("/api/categories/:id", authenticateToken, upload.single("image"), updateCategory);
categoryRouter.delete("/api/categories/:id", authenticateToken, deleteCategory);

export default categoryRouter;
