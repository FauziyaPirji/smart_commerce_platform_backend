import OpenAI from "openai";
import mongoose from "mongoose";
import Order from "../model/Order.js";
import OrderItem from "../model/OrderItem.js";
import Product from "../model/Product.js";
import User from "../model/User.js";
import VendorProfile from "../model/VendorProfile.js";
import Payout from "../model/Payout.js";

// Initialize OpenAI client pointed to Gemini's free OpenAI-compatible endpoint
const ai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const NO_INFO_REPLY =
  "I don't have information about that in the database. Please ask regarding store sales, products, orders, payouts, or customers.";

// ============================================================================
// 1. ADMIN AI CHATBOT (FULL PLATFORM VISION)
// ============================================================================
export const adminAIChat = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ success: false, errorMessage: "messages must be an array" });
    }

    const history = messages
      .filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-8);

    // Fetch live platform metrics
    const [totalUsers, activeVendors, allOrders, allProducts, payouts] = await Promise.all([
      User.countDocuments({ role: { $nin: ["admin", "vendor"] } }),
      VendorProfile.countDocuments({ status: "approved" }),
      Order.find().select("totalAmount totalPrice orderStatus createdAt").lean(),
      Product.countDocuments(),
      Payout.find().select("amount status").lean(),
    ]);

    const totalGrossRevenue = allOrders.reduce(
      (sum, ord) => sum + Number(ord.totalAmount || ord.totalPrice || 0),
      0
    );

    const platformCommissionEarned = Math.round(totalGrossRevenue * 0.02);

    let deliveredCount = 0;
    let pendingOrdersCount = 0;
    allOrders.forEach((o) => {
      const st = String(o.orderStatus || "").toLowerCase();
      if (st === "delivered") deliveredCount++;
      else pendingOrdersCount++;
    });

    const totalDisbursedPayouts = payouts
      .filter((p) => ["paid", "completed"].includes(String(p.status).toLowerCase()))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const adminStats = `
- Total Platform Customers: ${totalUsers}
- Active Approved Vendors: ${activeVendors}
- Total Catalog Products: ${allProducts}
- Total Orders Placed: ${allOrders.length}
- Orders Delivered: ${deliveredCount}
- Orders Pending Processing/Delivery: ${pendingOrdersCount}
- Platform Gross Sales Volume: ₹${totalGrossRevenue.toLocaleString("en-IN")}
- Platform Revenue (2% Commission): ₹${platformCommissionEarned.toLocaleString("en-IN")}
- Total Payouts Disbursed to Vendors: ₹${totalDisbursedPayouts.toLocaleString("en-IN")}
`;

    const systemPrompt = `You are the executive AI Business Assistant for the Platform Administrator.
Answer questions using ONLY the live telemetry provided below.
Rules:
1. Platform fee is 2%; vendor share is 98%.
2. If the user asks for passwords, card info, or data not in the stats, reply: "${NO_INFO_REPLY}".
3. Be professional, concise, and helpful. You may reply politely to greetings.

LIVE PLATFORM TELEMETRY:
${adminStats}`;

    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      messages: [{ role: "system", content: systemPrompt }, ...history],
      temperature: 0.2,
    });

    return res.status(200).json({
      success: true,
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("Admin AI Error:", error);
    const busy = error.status === 429 || error.status === 503;
    return res.status(error.status || 500).json({
      success: false,
      errorMessage: busy
        ? "AI service is momentarily busy. Please try again in a few seconds."
        : "Failed to connect to AI assistant.",
    });
  }
};

// ============================================================================
// 2. VENDOR AI CHATBOT (STRICT VENDOR STORE & BUYER ISOLATION)
// ============================================================================
export const vendorAIChat = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ success: false, errorMessage: "messages must be an array" });
    }

    const history = messages
      .filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-8);

    const userId = req.user?.id || req.user?._id || req.user?.userId;

    // Resolve vendor profile
    const profile = await VendorProfile.findOne({
      $or: [
        { user: userId },
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
      ].filter(Boolean),
    }).lean();

    const vendorIds = [userId];
    if (profile?._id) vendorIds.push(profile._id);
    const storeName = profile?.storeName || profile?.name || "Your Store";

    // 1. Vendor Products
    const products = await Product.find({
      $or: [{ vendor: { $in: vendorIds } }, { vendorId: { $in: vendorIds.map(String) } }],
    }).lean();

    const lowStockList = products
      .filter((p) => Number(p.stock ?? 10) <= 5)
      .map((p) => `${p.name} (${p.stock} units left)`);

    // 2. Vendor Order Items
    const vendorItems = await OrderItem.find({
      $or: [
        { vendor: { $in: vendorIds } },
        { vendorId: { $in: vendorIds.map(String) } },
        { product: { $in: products.map((p) => p._id) } },
      ],
    }).lean();

    const orderIds = [
      ...new Set(
        vendorItems.map((item) => String(item.order?._id || item.order || item.orderId || "")).filter(Boolean)
      ),
    ];

    // 3. Orders & Customers who bought from THIS vendor ONLY
    const orders = await Order.find({ _id: { $in: orderIds } })
      .populate("user", "name firstName lastName email")
      .lean();

    // Collect verified buyers for this vendor
    const uniqueCustomerNames = new Set();
    orders.forEach((ord) => {
      const name =
        ord.user?.name ||
        `${ord.user?.firstName || ""} ${ord.user?.lastName || ""}`.trim() ||
        ord.shippingAddress?.fullName;
      if (name) uniqueCustomerNames.add(name);
    });

    let storeGrossSales = 0;
    vendorItems.forEach((it) => {
      const p = Number(it.price || it.unitPrice || 0);
      const q = Number(it.quantity || it.qty || 1);
      storeGrossSales += Number(it.subtotal || p * q);
    });

    const netEarnings = Math.round(storeGrossSales * 0.98);

    // 4. Vendor Payouts
    const payouts = await Payout.find({
      $or: [{ vendor: { $in: vendorIds } }, { vendorId: { $in: vendorIds.map(String) } }],
    }).lean();

    let totalPaid = 0;
    let pendingPayout = 0;
    payouts.forEach((p) => {
      const amt = Number(p.amount || 0);
      const st = String(p.status || "").toLowerCase();
      if (st === "paid" || st === "completed") totalPaid += amt;
      else if (st === "pending" || st === "processing") pendingPayout += amt;
    });

    const availablePayoutBalance = Math.max(0, netEarnings - totalPaid - pendingPayout);

    const vendorStats = `
STORE: ${storeName}
- Total Catalog Products: ${products.length}
- Low Stock Items: ${lowStockList.length > 0 ? lowStockList.join(", ") : "None. All products healthy."}
- Total Orders for your store: ${orders.length}
- Lifetime Store Sales Volume: ₹${storeGrossSales.toLocaleString("en-IN")}
- Net Revenue Accrued (98% after 2% platform fee): ₹${netEarnings.toLocaleString("en-IN")}
- Total Payouts Received to date: ₹${totalPaid.toLocaleString("en-IN")}
- Pending Settlement: ₹${pendingPayout.toLocaleString("en-IN")}
- Available Payout Balance: ₹${availablePayoutBalance.toLocaleString("en-IN")}
- Unique Verified Customers Who Purchased From You: ${uniqueCustomerNames.size} customer(s) (${Array.from(uniqueCustomerNames).slice(0, 10).join(", ") || "None yet"})
`;

    const systemPrompt = `You are the personal AI Store Assistant for ${storeName}.
Answer questions using ONLY the store-specific telemetry provided below.
Rules:
1. You represent this store only. Do not reveal or discuss any other vendor or whole-platform metrics.
2. Only mention customers who purchased from THIS vendor: (${Array.from(uniqueCustomerNames).join(", ")}). Never share passwords or payment card details.
3. If an answer cannot be determined from the provided data, reply: "${NO_INFO_REPLY}".
4. Keep replies friendly, concise, and professional.

LIVE STORE DATA:
${vendorStats}`;

    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      messages: [{ role: "system", content: systemPrompt }, ...history],
      temperature: 0.2,
    });

    return res.status(200).json({
      success: true,
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("Vendor AI Error:", error);
    const busy = error.status === 429 || error.status === 503;
    return res.status(error.status || 500).json({
      success: false,
      errorMessage: busy
        ? "AI assistant is busy. Please try again in a few moments."
        : "Failed to query store AI assistant.",
    });
  }
};