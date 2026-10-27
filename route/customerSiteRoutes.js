import express from "express";
import { getProducts, getProductById, getCategories, getVendors, getCart, addToCart, updateCartItem, removeFromCart, clearCart, syncCart, getWishlist, toggleWishlist, syncWishlist, submitContactMessage } from "../controller/customerSiteController.js";
import authenticateToken from "../utils/authMiddleware.js";

const customerRouter = express.Router();

customerRouter.get("/api/customer/products", getProducts);
customerRouter.get("/api/customer/products/:id", getProductById);
customerRouter.get("/api/customer/categories", getCategories);
customerRouter.get("/api/customer/vendors", getVendors);

customerRouter.get("/api/customer/cart", authenticateToken, getCart);
customerRouter.post("/api/customer/cart/add", authenticateToken, addToCart);
customerRouter.put("/api/customer/cart/:productId", authenticateToken, updateCartItem);
customerRouter.delete("/api/customer/cart/:productId", authenticateToken, removeFromCart);
customerRouter.delete("/api/customer/cart", authenticateToken, clearCart);
customerRouter.post("/api/customer/cart/sync", authenticateToken, syncCart);

customerRouter.get("/api/customer/wishlist", authenticateToken, getWishlist);
customerRouter.post("/api/customer/wishlist/toggle", authenticateToken, toggleWishlist);
customerRouter.post("/api/customer/wishlist/sync", authenticateToken, syncWishlist);

customerRouter.post("/api/customer/contact", submitContactMessage);

export default customerRouter;