import OpenAI from "openai";
import Product from "../model/Product.js";

// Initialize OpenAI client pointing to Gemini's free OpenAI-compatible endpoint
const ai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Format products into clear text for Gemini prompt
const formatProductsForPrompt = (products) => {
  return products
    .map((p, idx) => {
      const price = Number(p.discountPrice || p.price || 0);
      const mrp = Number(p.mrp || p.price || price);
      const discount =
        mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
      const category =
        typeof p.category === "object"
          ? p.category?.name
          : p.category || "General";
      const vendor =
        typeof p.vendor === "object"
          ? p.vendor?.storeName ||
            `${p.vendor?.firstName || ""} ${p.vendor?.lastName || ""}`.trim()
          : p.vendor || "Verified Vendor";

      const specs = Array.isArray(p.specifications)
        ? p.specifications
            .map((s) =>
              typeof s === "object"
                ? `${s.field || s.name || s.key}: ${s.value || s.text || ""}`
                : String(s),
            )
            .join("; ")
        : "None provided";

      return `Product #${idx + 1}:
- ID: ${String(p._id || p.id)}
- Name: ${p.name}
- Category: ${category}
- Selling Price: ₹${price} (Original MRP: ₹${mrp}, Discount: ${discount}%)
- Stock: ${(p.stock ?? 10) > 0 ? `${p.stock ?? 10} units available` : "Out of stock"}
- Vendor: ${vendor}
- Specifications: ${specs}
- Description: ${p.description || "N/A"}`;
    })
    .join("\n\n");
};

export const compareProductsWithAI = async (req, res) => {
  try {
    let { products, productIds } = req.body;

    // Optional MongoDB lookup if product IDs are passed
    if (Array.isArray(productIds) && productIds.length >= 2 && Product) {
      const dbProducts = await Product.find({ _id: { $in: productIds } })
        .populate("category", "name")
        .populate("vendor", "storeName firstName lastName")
        .lean();
      if (dbProducts && dbProducts.length >= 2) {
        products = dbProducts;
      }
    }

    if (!Array.isArray(products) || products.length < 2) {
      return res.status(400).json({
        success: false,
        errorMessage: "Please select at least 2 products to compare.",
      });
    }

    const productsText = formatProductsForPrompt(products);

    const systemPrompt = `You are a senior e-commerce buying advisor.
Analyze the provided products that a customer is comparing side by side.
Choose the SINGLE BEST product that offers the highest value for money, best specifications, and overall customer satisfaction.

Respond STRICTLY in valid JSON with no markdown wrapping and no backticks:
{
  "bestPick": {
    "productId": "Exact ID string of the winning product",
    "productName": "Exact name of the winning product",
    "badgeTitle": "e.g., Best Overall, Best Value For Money, or Flagship Pick",
    "reason": "2-3 concise sentences detailing why this product beats the others",
    "highlightFeature": "Key winning feature (e.g., 40% cheaper with superior battery)"
  },
  "verdictSummary": "2 sentences summarizing the overall comparison",
  "productAnalysis": [
    {
      "productId": "Exact ID string matching each product",
      "productName": "Name",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "idealFor": "Target audience (e.g. Budget buyers, Professionals, Everyday users)",
      "score": 9.4
    }
  ]
}`;

    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Compare these products and declare the winning best pick:\n\n${productsText}`,
        },
      ],
      temperature: 0.2,
    });

    let rawReply = completion.choices[0]?.message?.content?.trim() || "";
    if (rawReply.startsWith("```")) {
      rawReply = rawReply
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/, "")
        .trim();
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawReply);
    } catch {
      parsedResult = {
        bestPick: {
          productId: String(products[0]._id || products[0].id),
          productName: products[0].name,
          badgeTitle: "AI Suggested Choice",
          reason: rawReply.slice(0, 180),
          highlightFeature: "Top rated across specifications",
        },
        verdictSummary: rawReply,
        productAnalysis: [],
      };
    }

    return res.status(200).json({
      success: true,
      data: parsedResult,
    });
  } catch (error) {
    console.error("AI Comparison Error:", error?.status, error?.message);
    const busy = error?.status === 429 || error?.status === 503;
    return res.status(error?.status || 500).json({
      success: false,
      errorMessage: busy
        ? "AI service is busy right now. Please retry in 30 seconds."
        : "Failed to generate AI recommendation.",
    });
  }
};

export const askAboutComparedProducts = async (req, res) => {
  try {
    const { products, question, history = [] } = req.body;

    if (!Array.isArray(products) || products.length < 2) {
      return res.status(400).json({
        success: false,
        errorMessage: "At least two products must be compared.",
      });
    }

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        errorMessage: "Please provide a valid question.",
      });
    }

    const productsText = formatProductsForPrompt(products);

    const systemPrompt = `You are a helpful e-commerce buying assistant.
Answer the customer's question strictly comparing the following products:
${productsText}

RULES:
- Answer in 2 to 3 concise, friendly sentences.
- Quote actual prices, differences, or specs from the products.
- If asked an unrelated question, guide them back to these products.`;

    const sanitizedHistory = history
      .filter(
        (m) =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string",
      )
      .slice(-6);

    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        ...sanitizedHistory,
        { role: "user", content: question },
      ],
      temperature: 0.3,
    });

    return res.status(200).json({
      success: true,
      reply: completion.choices[0]?.message?.content?.trim(),
    });
  } catch (error) {
    console.error("AI Ask Error:", error?.status, error?.message);
    return res.status(500).json({
      success: false,
      errorMessage: "Unable to get an answer from AI.",
    });
  }
};
