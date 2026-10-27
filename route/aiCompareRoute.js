import express from "express";
import { compareProductsWithAI, askAboutComparedProducts, } from "../controller/aiCompareController.js";

const aiRouter = express.Router();

aiRouter.post("/api/ai/compare-products", compareProductsWithAI);
aiRouter.post("/api/ai/compare-ask", askAboutComparedProducts);

export default aiRouter;