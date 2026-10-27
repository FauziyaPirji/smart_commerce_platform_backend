import express from "express";
import { createProduct, getProducts, getProductById, updateProduct, deleteProduct } from "../controller/productController.js";
import authenticateToken from "../utils/authMiddleware.js";
import upload from "../utils/uploadMiddleware.js";

const router = express.Router();

router.post("/api/products", authenticateToken, upload.any(), createProduct);
router.get("/api/products", authenticateToken, getProducts);
router.get("/api/products/:id", authenticateToken, getProductById);
router.put("/api/products/:id", authenticateToken, upload.any(), updateProduct);
router.delete("/api/products/:id", authenticateToken, deleteProduct);

export default router;