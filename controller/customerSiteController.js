import Product from "../model/Product.js";
import Category from "../model/Category.js";
import VendorProfile from "../model/VendorProfile.js";
import Cart from "../model/Cart.js";
import Wishlist from "../model/Wishlist.js";
import ContactMessage from "../model/ContactMessage.js";
import mongoose from "mongoose";

// Helper: Multi-format user ID extraction
const getUserId = (req) => {
  return (
    req.user?._id ||
    req.user?.id ||
    req.user?.userId ||
    (typeof req.user === "string" ? req.user : null) ||
    req.user?.user?._id ||
    req.user?.user?.id ||
    null
  );
};

// Helper: Retrieve VendorProfile by vendor ID (checks both _id and user fields)
const getVendorProfileForProduct = async (vendorId) => {
  if (!vendorId) return null;
  return await VendorProfile.findOne({
    $or: [{ user: vendorId }, { _id: vendorId }],
  }).select("storeName storeLogo businessStatus status user");
};

// Helper: Build vendor map from a list of VendorProfiles keyed by _id and user
const buildVendorMap = (vendorProfiles) => {
  const vpMap = {};
  vendorProfiles.forEach((vp) => {
    vpMap[String(vp._id)] = vp;
    if (vp.user) vpMap[String(vp.user)] = vp;
  });
  return vpMap;
};

// 1. GET ALL PRODUCTS (Includes vacationing vendors with isVacationMode flags)
export const getProducts = async (req, res) => {
  try {
    const approvedVendors = await VendorProfile.find({
      status: { $in: ["approved", "verified"] },
    }).select("_id user businessStatus storeName storeLogo");

    const approvedVendorIds = [];
    const vendorMap = {};

    approvedVendors.forEach((vp) => {
      approvedVendorIds.push(vp._id);
      if (vp.user) approvedVendorIds.push(vp.user);
      vendorMap[String(vp._id)] = vp;
      if (vp.user) vendorMap[String(vp.user)] = vp;
    });

    const activeCategories = await Category.find({ isActive: true }).select(
      "_id",
    );
    const activeCategoryIds = activeCategories.map((c) => c._id);

    const products = await Product.find({
      isActive: true,
      stock: { $gt: 0 },
      vendor: { $in: approvedVendorIds },
      category: { $in: activeCategoryIds },
    })
      .populate("category", "name slug")
      .populate("vendor", "firstName lastName email storeName storeLogo")
      .sort({ createdAt: -1 })
      .lean();

    const enrichedProducts = products.map((prod) => {
      const vId = String(prod.vendor?._id || prod.vendor || "");
      const vp = vendorMap[vId];
      const businessStatus = vp?.businessStatus || "accepting_orders";
      const isVacationMode = businessStatus !== "accepting_orders";
      const vendorLogo = vp?.storeLogo || prod.vendor?.storeLogo || null;

      return {
        ...prod,
        isVacationMode,
        businessStatus,
        canAddToCart: !isVacationMode,
        vendor:
          prod.vendor && typeof prod.vendor === "object"
            ? {
                ...prod.vendor,
                storeLogo: vendorLogo,
                businessStatus,
                isVacationMode,
              }
            : prod.vendor,
        vendorProfile: vp
          ? {
              storeName: vp.storeName,
              storeLogo: vendorLogo,
              businessStatus,
              isVacationMode,
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      count: enrichedProducts.length,
      products: enrichedProducts,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
      error: error.message,
    });
  }
};

// 2. GET SINGLE PRODUCT BY ID OR SLUG
// This endpoint is called by guest cart re-hydration to get live vendor status.
// It MUST return businessStatus, isVacationMode, and storeLogo at both product root
// and product.vendor so the frontend can read either location.
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    let product;

    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id)
        .populate("category", "name slug")
        .populate("vendor", "firstName lastName email storeName storeLogo")
        .lean();
    } else {
      product = await Product.findOne({ slug: id })
        .populate("category", "name slug")
        .populate("vendor", "firstName lastName email storeName storeLogo")
        .lean();
    }

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }

    // Always query VendorProfile for live status — never trust User model fields
    const vId = product.vendor?._id || product.vendor;
    const vp = await getVendorProfileForProduct(vId);

    const businessStatus = vp?.businessStatus || "accepting_orders";
    const isVacationMode = businessStatus !== "accepting_orders";

    // Prefer VendorProfile storeLogo, fall back to populated vendor.storeLogo
    const vendorLogo =
      vp?.storeLogo ||
      (typeof product.vendor === "object" ? product.vendor?.storeLogo : null) ||
      null;

    return res.status(200).json({
      success: true,
      product: {
        ...product,
        isVacationMode,
        businessStatus,
        canAddToCart: !isVacationMode,
        // Inject live status onto product.vendor so guests reading this field get correct data
        vendor:
          product.vendor && typeof product.vendor === "object"
            ? {
                ...product.vendor,
                storeLogo: vendorLogo,
                businessStatus,
                isVacationMode,
              }
            : product.vendor,
        vendorProfile: vp
          ? {
              storeName: vp.storeName,
              storeLogo: vendorLogo,
              businessStatus,
              isVacationMode,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Get Product By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve product details.",
      error: error.message,
    });
  }
};

// 3. GET CATEGORIES WITH PRODUCT COUNTS
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .select("_id name slug description image")
      .sort({ name: 1 });

    const approvedVendors = await VendorProfile.find({
      status: { $in: ["approved", "verified"] },
    }).select("_id user");

    const approvedVendorIds = [];
    approvedVendors.forEach((v) => {
      approvedVendorIds.push(v._id);
      if (v.user) approvedVendorIds.push(v.user);
    });

    const productCounts = await Product.aggregate([
      {
        $match: {
          isActive: true,
          stock: { $gt: 0 },
          vendor: { $in: approvedVendorIds },
        },
      },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);

    const countMap = {};
    productCounts.forEach(({ _id, count }) => {
      if (_id) countMap[String(_id)] = count;
    });

    const categoriesWithCount = categories.map((cat) => ({
      ...cat.toObject(),
      productsCount: countMap[String(cat._id)] || 0,
    }));

    return res.status(200).json({
      success: true,
      count: categoriesWithCount.length,
      categories: categoriesWithCount,
    });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. GET ALL VENDORS (Includes businessStatus and storeLogo)
export const getVendors = async (req, res) => {
  try {
    const vendors = await VendorProfile.find({
      status: { $in: ["approved", "verified"] },
    })
      .populate("categories", "name")
      .populate("user", "firstName middleName lastName email phone")
      .sort({ createdAt: -1 })
      .lean();

    const productCounts = await Product.aggregate([
      { $group: { _id: "$vendor", count: { $sum: 1 } } },
    ]);

    const countMap = {};
    productCounts.forEach((item) => {
      countMap[String(item._id)] = item.count;
    });

    const vendorsWithCounts = vendors.map((vendor) => {
      const businessStatus = vendor.businessStatus || "accepting_orders";
      return {
        ...vendor,
        isVacationMode: businessStatus !== "accepting_orders",
        businessStatus,
        productCount:
          (countMap[String(vendor._id)] || 0) +
          (vendor.user
            ? countMap[String(vendor.user._id || vendor.user)] || 0
            : 0),
      };
    });

    return res.status(200).json({
      success: true,
      count: vendorsWithCounts.length,
      vendors: vendorsWithCounts,
    });
  } catch (error) {
    console.error("Get Vendors Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendors list.",
      error: error.message,
    });
  }
};

// 5. GET USER CART (Live vacation mode check via VendorProfile batch query)
export const getCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select:
        "name title price mrp discountPrice stock tone mark rating reviews vendor category images image shortDescription",
      populate: [
        { path: "category", select: "name" },
        { path: "vendor", select: "storeName firstName lastName storeLogo" },
      ],
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.json({
        success: true,
        cart: [],
        hasUnserviceableItems: false,
      });
    }

    // Collect unique vendor IDs for a single batch VendorProfile query
    const vendorIds = [
      ...new Set(
        cart.items
          .map((i) => String(i.product?.vendor?._id || i.product?.vendor || ""))
          .filter(Boolean),
      ),
    ];

    const vendorProfiles = await VendorProfile.find({
      $or: [{ user: { $in: vendorIds } }, { _id: { $in: vendorIds } }],
    }).select("user storeName businessStatus storeLogo");

    const vpMap = buildVendorMap(vendorProfiles);

    let hasUnserviceableItems = false;

    const enrichedItems = cart.items.map((item) => {
      const itemObj = item.toObject ? item.toObject() : item;
      const vId = String(
        item.product?.vendor?._id || item.product?.vendor || "",
      );
      const vp = vpMap[vId];

      const businessStatus = vp?.businessStatus || "accepting_orders";
      const isVacationMode = businessStatus !== "accepting_orders";

      if (isVacationMode) hasUnserviceableItems = true;

      const vendorLogo =
        vp?.storeLogo ||
        (typeof item.product?.vendor === "object"
          ? item.product.vendor.storeLogo
          : null) ||
        null;

      return {
        ...itemObj,
        isServiceable: !isVacationMode,
        isVacationMode,
        businessStatus,
        unserviceableReason: isVacationMode
          ? `Seller (${vp?.storeName || "Vendor"}) is temporarily in Vacation Mode and cannot fulfill orders right now.`
          : null,
        vendorProfile: vp
          ? { storeName: vp.storeName, businessStatus, storeLogo: vendorLogo }
          : null,
        product: {
          ...itemObj.product,
          vendor:
            itemObj.product?.vendor &&
            typeof itemObj.product.vendor === "object"
              ? {
                  ...itemObj.product.vendor,
                  storeLogo: vendorLogo,
                  businessStatus,
                  isVacationMode,
                }
              : itemObj.product?.vendor,
        },
      };
    });

    return res.json({
      success: true,
      cart: enrichedItems,
      hasUnserviceableItems,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 6. ADD TO CART (Blocks products from vacation mode vendors)
export const addToCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized. Please log in." });
    }

    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    const vendorProfile = await getVendorProfileForProduct(product.vendor);
    if (vendorProfile && vendorProfile.businessStatus !== "accepting_orders") {
      return res.status(400).json({
        success: false,
        isVacationMode: true,
        vendorName: vendorProfile.storeName || "This vendor",
        message: `"${vendorProfile.storeName || "This seller"}" is currently in Vacation Mode and temporarily unable to receive orders. You can save this item to your Wishlist for later!`,
      });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({
        user: userId,
        items: [{ product: productId, quantity }],
      });
    } else {
      const existingItem = cart.items.find(
        (item) => String(item.product) === String(productId),
      );
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity });
      }
      await cart.save();
    }

    await cart.populate(
      "items.product",
      "name price mrp discountPrice stock tone mark rating reviews vendor images image",
    );

    return res.status(200).json({
      success: true,
      message: "Added to cart successfully",
      cart: cart.items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 7. UPDATE CART ITEM QUANTITY (Guards against vacation mode vendors)
export const updateCartItem = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Quantity must be >= 1" });
    }

    const product = await Product.findById(req.params.productId);
    if (product) {
      const vendorProfile = await getVendorProfileForProduct(product.vendor);
      if (
        vendorProfile &&
        vendorProfile.businessStatus !== "accepting_orders"
      ) {
        return res.status(400).json({
          success: false,
          isVacationMode: true,
          message: `Cannot update quantity. "${vendorProfile.storeName || "Seller"}" is currently away in Vacation Mode.`,
        });
      }
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    const item = cart.items.find(
      (item) => String(item.product) === String(req.params.productId),
    );
    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: "Item not in cart" });
    }

    item.quantity = quantity;
    await cart.save();

    return res.json({
      success: true,
      message: "Quantity updated",
      cart: cart.items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 8. REMOVE ITEM FROM CART
export const removeFromCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    cart.items = cart.items.filter(
      (item) => String(item.product) !== String(req.params.productId),
    );
    await cart.save();

    return res.json({
      success: true,
      message: "Item removed from cart",
      cart: cart.items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 9. CLEAR ENTIRE CART
export const clearCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });
    return res.json({ success: true, message: "Cart cleared successfully" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 10. SYNC CART (Guest → signed-in merge; skips vacation mode vendor products)
export const syncCart = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ success: true, message: "Nothing to sync" });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    const skippedVacationItems = [];

    for (const { productId, quantity = 1 } of items) {
      if (!productId) continue;

      const product = await Product.findById(productId);
      if (!product) continue;

      const vendorProfile = await getVendorProfileForProduct(product.vendor);
      if (
        vendorProfile &&
        vendorProfile.businessStatus !== "accepting_orders"
      ) {
        skippedVacationItems.push(product.name || productId);
        continue;
      }

      const existing = cart.items.find(
        (item) => String(item.product) === String(productId),
      );

      if (existing) {
        existing.quantity = Math.max(existing.quantity, quantity);
      } else {
        cart.items.push({ product: productId, quantity });
      }
    }

    await cart.save();
    await cart.populate(
      "items.product",
      "name price mrp discountPrice stock tone mark rating reviews vendor images image",
    );

    return res.json({
      success: true,
      cart: cart.items,
      skippedVacationItems,
      skippedCount: skippedVacationItems.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 11. GET WISHLIST (Unrestricted — works for all products including vacationing vendors)
// Uses batch VendorProfile lookup for live businessStatus instead of trusting
// the User model's vendor field which does not carry businessStatus.
export const getWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);

    const wl = await Wishlist.findOne({ user: userId }).populate({
      path: "products.product",
      select:
        "name title price mrp discountPrice stock tone mark rating reviews vendor category images image shortDescription specs",
      populate: [
        {
          path: "vendor",
          select: "storeName firstName lastName name storeLogo",
        },
        { path: "category", select: "name" },
      ],
    });

    const rawItems = wl?.products || [];
    if (rawItems.length === 0) {
      return res.json({ success: true, wishlist: [] });
    }

    // Batch fetch VendorProfiles for all wishlist items in one query
    const vendorIds = [
      ...new Set(
        rawItems
          .map((item) =>
            String(item.product?.vendor?._id || item.product?.vendor || ""),
          )
          .filter(Boolean),
      ),
    ];

    const vendorProfiles = await VendorProfile.find({
      $or: [{ user: { $in: vendorIds } }, { _id: { $in: vendorIds } }],
    }).select("user storeName businessStatus storeLogo");

    const vpMap = buildVendorMap(vendorProfiles);

    const enrichedItems = rawItems.map((item) => {
      const product = item.product;
      if (!product) return item.toObject ? item.toObject() : item;

      const vId = String(product.vendor?._id || product.vendor || "");
      const vp = vpMap[vId];

      // Live businessStatus from VendorProfile — never trust stale User model data
      const businessStatus = vp?.businessStatus || "accepting_orders";
      const isVacationMode = businessStatus !== "accepting_orders";

      const vendorLogo =
        vp?.storeLogo ||
        (typeof product.vendor === "object"
          ? product.vendor?.storeLogo
          : null) ||
        null;

      const productObj = product.toObject ? product.toObject() : product;

      return {
        ...(item.toObject ? item.toObject() : item),
        product: {
          ...productObj,
          isVacationMode,
          businessStatus,
          vendor:
            productObj.vendor && typeof productObj.vendor === "object"
              ? {
                  ...productObj.vendor,
                  storeLogo: vendorLogo,
                  businessStatus,
                  isVacationMode,
                }
              : productObj.vendor,
          vendorProfile: vp
            ? {
                storeName: vp.storeName,
                storeLogo: vendorLogo,
                businessStatus,
                isVacationMode,
              }
            : null,
        },
      };
    });

    return res.json({ success: true, wishlist: enrichedItems });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 12. TOGGLE WISHLIST (Fully permitted for vacationing vendors)
export const toggleWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { productId } = req.body;

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "productId is required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    let wl = await Wishlist.findOne({ user: userId });
    if (!wl) {
      wl = await Wishlist.create({ user: userId, products: [] });
    }

    const idx = wl.products.findIndex(
      (item) => String(item.product) === String(productId),
    );

    let added;
    if (idx > -1) {
      wl.products.splice(idx, 1);
      added = false;
    } else {
      wl.products.push({ product: productId });
      added = true;
    }

    await wl.save();
    const wishlistIds = wl.products.map((item) => String(item.product));

    return res.json({ success: true, added, wishlistIds });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 13. SYNC WISHLIST
export const syncWishlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.json({ success: true, message: "Nothing to sync" });
    }

    let wl = await Wishlist.findOne({ user: userId });
    if (!wl) {
      wl = await Wishlist.create({ user: userId, products: [] });
    }

    for (const pid of productIds) {
      if (!pid) continue;
      const exists = wl.products.some(
        (item) => String(item.product) === String(pid),
      );
      if (!exists) {
        wl.products.push({ product: pid });
      }
    }

    await wl.save();
    const wishlistIds = wl.products.map((item) => String(item.product));

    return res.json({ success: true, wishlistIds });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 14. SUBMIT CONTACT MESSAGE
export const submitContactMessage = async (req, res) => {
  try {
    const { name, email, phone, subject, orderId, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message:
          "Please fill in all required fields (name, email, subject, message).",
      });
    }

    const newMessage = await ContactMessage.create({
      name: name.trim(),
      email: email.trim(),
      phone: phone ? phone.trim() : "",
      subject,
      orderId: orderId ? orderId.trim() : "",
      message: message.trim(),
    });

    return res.status(201).json({
      success: true,
      message:
        "Your message has been received! Our support team will contact you shortly.",
      data: newMessage,
    });
  } catch (error) {
    console.error("Submit Contact Message Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit message.",
      error: error.message,
    });
  }
};
