import mongoose from "mongoose";
import InventoryLog from "../model/InventoryLog.js";
import Product from "../model/Product.js";

// Helper: Safely resolve vendor/user ID from any token structure
const getVendorId = (req) => {
  return (
    req.user?.vendorId ||
    req.user?._id ||
    req.user?.id ||
    req.user?.userId ||
    (typeof req.user === "string" ? req.user : null) ||
    req.user?.user?._id ||
    req.user?.user?.id ||
    req.vendor?._id ||          
    req.user?.vendorProfile ||  
    null
  );
};

// 1. GET VENDOR INVENTORY LIST & STATS
export const getVendorInventory = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: "Vendor authentication failed. User ID missing.",
      });
    }

    // Fetch all products belonging to this vendor with populated category
    const products = await Product.find({
      $or: [
        { vendor: vendorId },
        { vendorId: vendorId },
        { vendor: req.user?._id },
        { vendorId: req.user?._id },
      ],
    })
      .populate("category", "name")
      .select(
        "name title sku stock price category images image lowStockThreshold updatedAt createdAt",
      )
      .sort({ updatedAt: -1 });

    const formattedInventory = products.map((prod) => {
      const currentStock = Number(prod.stock ?? 0);
      const lowThreshold = Number(prod.lowStockThreshold || 10);
      const reservedStock = 0; // Reserved units in pending orders

      return {
        id: prod._id,
        _id: prod._id,
        productName: prod.name || prod.title || "Unnamed Product",
        sku: prod.sku || `SKU-${prod._id.toString().slice(-6).toUpperCase()}`,
        category:
          typeof prod.category === "object"
            ? prod.category?.name || "General"
            : prod.category || "General",
        currentStock,
        reservedStock,
        availableStock: Math.max(0, currentStock - reservedStock),
        lowStockThreshold: lowThreshold,
        price: prod.price || 0,
        images: prod.images || (prod.image ? [prod.image] : []),
        lastUpdated: new Date(prod.updatedAt).toLocaleDateString("en-IN", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      };
    });

    const totalProducts = formattedInventory.length;
    const inStockCount = formattedInventory.filter(
      (i) => i.currentStock > 10,
    ).length;
    const lowStockCount = formattedInventory.filter(
      (i) => i.currentStock > 0 && i.currentStock <= 10,
    ).length;
    const outOfStockCount = formattedInventory.filter(
      (i) => i.currentStock === 0,
    ).length;

    res.json({
      success: true,
      inventory: formattedInventory,
      metrics: {
        totalProducts,
        inStockCount,
        lowStockCount,
        outOfStockCount,
      },
    });
  } catch (error) {
    console.error("Get vendor inventory error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to load inventory data." });
  }
};

// 2. GET SINGLE INVENTORY PRODUCT (FOR UPDATE PAGE)
export const getInventoryItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const vendorId = getVendorId(req);

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product ID." });
    }

    const prod = await Product.findOne({
      _id: productId,
      $or: [
        { vendor: vendorId },
        { vendorId: vendorId },
        { vendor: req.user?._id },
        { vendorId: req.user?._id },
      ],
    }).populate("category", "name");

    if (!prod) {
      return res.status(404).json({
        success: false,
        message: "Product not found or unauthorized.",
      });
    }

    const currentStock = Number(prod.stock ?? 0);
    const item = {
      id: prod._id,
      _id: prod._id,
      productName: prod.name || prod.title || "Unnamed Product",
      sku: prod.sku || `SKU-${prod._id.toString().slice(-6).toUpperCase()}`,
      category:
        typeof prod.category === "object"
          ? prod.category?.name || "General"
          : prod.category || "General",
      currentStock,
      reservedStock: 0,
      availableStock: currentStock,
      lowStockThreshold: prod.lowStockThreshold || 10,
      price: prod.price || 0,
      images: prod.images || (prod.image ? [prod.image] : []),
    };

    res.json({ success: true, product: item });
  } catch (error) {
    console.error("Get inventory item error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching product." });
  }
};

// 3. ADJUST INVENTORY STOCK & CREATE AUDIT LOG
export const adjustStock = async (req, res) => {
  try {
    const {
      productId,
      type,
      quantity,
      reason,
      auditNote,
      referenceType,
      referenceId,
    } = req.body;
    const vendorId = getVendorId(req);
    const userId = req.user?._id || req.user?.id || vendorId;

    if (!productId || !type || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        message:
          "Product ID, action type (add/subtract), quantity, and reason are required.",
      });
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive number.",
      });
    }

    if (!["add", "subtract"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Type must be either 'add' or 'subtract'.",
      });
    }

    // Find Product & verify vendor ownership
    const product = await Product.findOne({
      _id: productId,
      $or: [
        { vendor: vendorId },
        { vendorId: vendorId },
        { vendor: req.user?._id },
        { vendorId: req.user?._id },
      ],
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Product not found or you are not authorized to adjust this stock.",
      });
    }

    const previousStock = Number(product.stock || 0);
    let newStock = previousStock;

    if (type === "add") {
      newStock = previousStock + qty;
    } else {
      if (qty > previousStock) {
        return res.status(400).json({
          success: false,
          message: `Cannot subtract ${qty} units. Current stock is only ${previousStock} units.`,
        });
      }
      newStock = previousStock - qty;
    }

    // 1. Update Product stock in database
    product.stock = newStock;
    await product.save();

    // 2. Create Audit Log entry (with safe vendor fallback)
    const log = await InventoryLog.create({
      product: product._id,
      vendor: product.vendor || vendorId,
      type,
      quantity: qty,
      previousStock,
      newStock,
      reason,
      referenceType: referenceType || "manual",
      referenceId:
        referenceId && mongoose.Types.ObjectId.isValid(referenceId)
          ? referenceId
          : null,
      auditNote: auditNote?.trim() || "",
      adjustedBy: userId,
    });

    res.json({
      success: true,
      message: `Stock successfully ${type === "add" ? "increased" : "decreased"} to ${newStock} units.`,
      product: {
        id: product._id,
        currentStock: newStock,
        updatedAt: product.updatedAt,
      },
      log,
    });
  } catch (error) {
    console.error("Adjust stock error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update stock." });
  }
};

// 4. GET INVENTORY AUDIT LOGS (FAILSAFE & SCOPED)
export const getInventoryLogs = async (req, res) => {
  try {
    // ✅ KEY FIX: JWT has User._id but InventoryLog.vendor = VendorProfile._id
    // So we must look up VendorProfile first using the User._id from token
    const userId = req.user?.id || req.user?._id;
    const vendorProfile = await VendorProfile.findOne({ user: userId }).select("_id");
    if (!vendorProfile) {
      return res.status(403).json({
        success: false,
        message: "Vendor profile not found for this account.",
      });
    }
    const vendorId = vendorProfile._id; // ✅ This is VendorProfile._id — matches InventoryLog.vendor
    const { productId, type, reason, page = 1, limit = 20 } = req.query;
    // Find all products belonging to this vendor (for fallback matching)
    const vendorProducts = await Product.find({
      $or: [
        { vendor: vendorId },
        { vendorId: vendorId },
      ],
    }).select("_id name sku");
    const vendorProductIds = vendorProducts.map((p) => p._id);
    // Base scope — only this vendor's logs
    const baseScope = {
      $or: [
        { vendor: vendorId },
        { product: { $in: vendorProductIds } },
      ],
    };
    // Build filtered query — always wrapped in vendor scope
    const query = { $and: [{ $or: baseScope.$or }] };
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      query.$and.push({ product: new mongoose.Types.ObjectId(productId) });
    }
    if (type && ["add", "subtract"].includes(type)) {
      query.$and.push({ type });
    }
    if (reason && reason !== "All") {
      query.$and.push({ reason });
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, parseInt(limit, 10) || 20);
    const skip = (pageNum - 1) * limitNum;
    // Run all queries in parallel for performance
    const [totalLogs, logs, allVendorLogs] = await Promise.all([
      InventoryLog.countDocuments(query),
      InventoryLog.find(query)
        .populate("product", "name title sku images image price")
        .populate("adjustedBy", "name firstName lastName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      // Summary always uses full vendor scope (ignores current page filters)
      InventoryLog.find({ $or: baseScope.$or }).select("type quantity"),
    ]);
    const totalAdded = allVendorLogs
      .filter((l) => l.type === "add")
      .reduce((sum, l) => sum + (l.quantity || 0), 0);
    const totalSubtracted = allVendorLogs
      .filter((l) => l.type === "subtract")
      .reduce((sum, l) => sum + (l.quantity || 0), 0);
    res.json({
      success: true,
      logs,
      pagination: {
        totalLogs,
        totalPages: Math.ceil(totalLogs / limitNum) || 1,
        currentPage: pageNum,
        limit: limitNum,
      },
      summary: {
        totalTransactions: allVendorLogs.length,
        totalAdded,
        totalSubtracted,
        netChange: totalAdded - totalSubtracted,
      },
    });
  } catch (error) {
    console.error("Get inventory logs error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch inventory logs." });
  }
};