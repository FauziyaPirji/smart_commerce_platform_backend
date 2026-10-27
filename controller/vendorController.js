import User from "../model/User.js";
import VendorProfile from "../model/VendorProfile.js";
import Category from "../model/Category.js";
import Product from "../model/Product.js";
import Order from "../model/Order.js";
import OrderItem from "../model/OrderItem.js";
import Payment from "../model/Payment.js";
import VendorEarning from "../model/VendorEarning.js";
import Payout from "../model/Payout.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import generateToken from "../utils/jwtUtils.js";
import cloudinary from "../config/cloudinary.js";

const uploadToCloudinary = (buffer, folder = "smartcommerce_vendors") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

// HELPER: Comprehensive User ID extraction
const getUserId = (req) => {
  if (req.user) {
    if (typeof req.user === "string") return req.user;
    if (req.user._id) return req.user._id.toString();
    if (req.user.id) return req.user.id.toString();
    if (req.user.userId) return req.user.userId.toString();
    if (req.user.user?._id) return req.user.user._id.toString();
    if (req.user.user?.id) return req.user.user.id.toString();
  }
  const fallback =
    req.query?.userId || req.body?.userId || req.headers["x-user-id"] || null;
  return fallback && mongoose.Types.ObjectId.isValid(fallback)
    ? fallback.toString()
    : null;
};

// HELPER: Gather all vendor identity IDs (User ID & VendorProfile ID)
const resolveAllVendorIds = async (userId, userEmail = "") => {
  const ids = [];
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    ids.push(new mongoose.Types.ObjectId(userId));
  }
  const profile = await VendorProfile.findOne({
    $or: [
      { user: userId },
      { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
      { email: userEmail || "" },
    ].filter(Boolean),
  }).select("_id user");

  if (profile) {
    if (profile._id) ids.push(profile._id);
    if (profile.user) ids.push(profile.user);
  }
  return ids;
};

export const registerVendor = async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      email,
      password,
      phone,
      gender,
      storeName,
      storeDescription,
      category,
      categories,
      website,
      businessAddress,
      businessType,
      panNumber,
      gstNumber,
      bankDetails,
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      firstName,
      middleName,
      lastName,
      email,
      password: hashedPassword,
      phone,
      gender,
      role: "vendor",
    });
    await user.save();

    let categoryIds = [];
    const selectedCat =
      category || (Array.isArray(categories) ? categories[0] : null);

    if (!selectedCat) {
      return res.status(400).json({
        success: false,
        message: "Category is required.",
      });
    }

    let catDoc;
    if (mongoose.Types.ObjectId.isValid(selectedCat)) {
      catDoc = await Category.findById(selectedCat);
    } else {
      catDoc = await Category.findOne({
        $or: [
          { name: { $regex: `^${selectedCat}$`, $options: "i" } },
          { slug: selectedCat.toLowerCase() },
        ],
      });
    }

    if (!catDoc) {
      return res.status(400).json({
        success: false,
        message: `Category "${selectedCat}" not found.`,
      });
    }

    categoryIds.push(catDoc._id);

    const vendorProfile = new VendorProfile({
      user: user._id,
      storeName,
      storeDescription,
      storeLogo: "",
      storeBanner: "",
      categories: categoryIds,
      website,
      businessAddress,
      businessType,
      panNumber,
      gstNumber,
      bankDetails,
      status: "pending",
    });
    await vendorProfile.save();

    return res.status(201).json({
      success: true,
      message: "Vendor application submitted successfully!",
      vendorProfile,
    });
  } catch (error) {
    console.error("Register Vendor Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const loginVendor = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter both business email and password.",
      });
    }
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    if (user.role !== "vendor") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Not a vendor account.",
      });
    }
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message:
          "Password hash missing for this account. Please reset your password.",
      });
    }
    const isMatch = await bcrypt.compare(
      String(password),
      String(user.password),
    );
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    const vendorProfile = await VendorProfile.findOne({ user: user._id });
    const token = await generateToken(user);
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: user._id,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
      vendorProfile,
      token: token,
    });
  } catch (error) {
    console.error("Vendor Login Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendors = async (req, res) => {
  try {
    const vendors = await VendorProfile.find()
      .populate("categories", "name")
      .populate("user", "firstName middleName lastName email phone")
      .sort({ createdAt: -1 })
      .lean();

    const productCounts = await Product.aggregate([
      {
        $group: {
          _id: "$vendor",
          count: { $sum: 1 },
        },
      },
    ]);
    const countMap = {};
    productCounts.forEach((item) => {
      countMap[String(item._id)] = item.count;
    });
    const vendorsWithCounts = vendors.map((vendor) => ({
      ...vendor,
      productCount: countMap[String(vendor._id)] || 0,
    }));
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

// export const getVendorById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     // Route bypass for nested endpoints
//     if (id === "dashboard") return next();
//     if (id === "customers") return getVendorCustomers(req, res);
//     if (id === "orders") return getVendorOrders(req, res);
//     if (id === "profile") return getVendorProfile(req, res);
//     if (id === "store") return getVendorStore(req, res);
//     if (id === "payouts") return getVendorPayouts(req, res);

//     // If ID is an order number pattern (e.g. SC-123456)
//     if (String(id).startsWith("SC-")) {
//       return getVendorOrderById(req, res);
//     }

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid Vendor ID format.",
//       });
//     }

//     const vendor = await VendorProfile.findById(id)
//       .populate("categories", "name")
//       .populate("user", "firstName middleName lastName email phone")
//       .lean();

//     if (!vendor) {
//       return res.status(404).json({
//         success: false,
//         message: "Vendor profile not found.",
//       });
//     }

//     const productCount = await Product.countDocuments({ vendor: id });
//     vendor.productCount = productCount;

//     return res.status(200).json({
//       success: true,
//       vendor,
//     });
//   } catch (error) {
//     console.error("Get Vendor By ID Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch vendor profile.",
//       error: error.message,
//     });
//   }
// };

export const getVendorById = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Safety bypass: if a sub-route was caught, pass to next middleware or delegate
    if (id === "dashboard") {
      if (typeof next === "function") return next();
      return res.status(404).json({ success: false, message: "Route not found" });
    }
    if (id === "customers") return getVendorCustomers(req, res);
    if (id === "orders") return getVendorOrders(req, res);
    if (id === "profile") return getVendorProfile(req, res);
    if (id === "store") return getVendorStore(req, res);
    if (id === "earnings") return getVendorEarnings(req, res);
    if (id === "payouts") return getVendorPayouts(req, res);
    // Validate MongoDB ObjectId format
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      if (typeof next === "function") return next();
      return res.status(400).json({ success: false, message: "Invalid Vendor ID format." });
    }
    const vendor = await VendorProfile.findById(id).populate("user", "name email role");
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }
    return res.status(200).json({ success: true, vendor });
  } catch (error) {
    console.error("Get Vendor By ID Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Vendor ID format." });
    }
    const updatedVendor = await VendorProfile.findByIdAndUpdate(
      id,
      { $set: req.body },
      { new: true, runValidators: true },
    ).populate("categories", "name");

    if (!updatedVendor) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Vendor profile not found for update.",
        });
    }
    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully!",
      vendor: updatedVendor,
    });
  } catch (error) {
    console.error("Update Vendor Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveVendor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Vendor ID format." });
    }
    const vendor = await VendorProfile.findById(id);
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found." });
    }
    vendor.status = "approved";
    vendor.isActive = true;
    const updatedVendor = await vendor.save();
    return res.status(200).json({
      success: true,
      message: "Vendor approved successfully!",
      vendor: updatedVendor,
    });
  } catch (error) {
    console.error("Approve Vendor Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const suspendVendor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Vendor ID format." });
    }
    const vendor = await VendorProfile.findById(id);
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found." });
    }
    vendor.status = "rejected";
    vendor.isActive = false;
    const updatedVendor = await vendor.save();
    return res.status(200).json({
      success: true,
      message: "Vendor suspended successfully!",
      vendor: updatedVendor,
    });
  } catch (error) {
    console.error("Suspend Vendor Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Vendor ID format." });
    }
    const deletedVendor = await VendorProfile.findByIdAndDelete(id);
    if (!deletedVendor) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Vendor profile not found for deletion.",
        });
    }
    return res.status(200).json({
      success: true,
      message: "Vendor deleted successfully!",
      vendor: deletedVendor,
    });
  } catch (error) {
    console.error("Delete Vendor Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorCustomers = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Missing vendor token.",
      });
    }

    // 1. Gather all potential vendor identity IDs (User ID & VendorProfile ID)
    const allVendorIds = [];
    if (mongoose.Types.ObjectId.isValid(userId)) {
      allVendorIds.push(new mongoose.Types.ObjectId(userId));
    }

    const vendorProfile = await VendorProfile.findOne({
      $or: [
        { user: userId },
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: req.user?.email || "" },
      ].filter(Boolean),
    });

    if (vendorProfile) {
      if (vendorProfile._id) allVendorIds.push(vendorProfile._id);
      if (vendorProfile.user) allVendorIds.push(vendorProfile.user);
    }

    // 2. Find all Products owned by this vendor
    const vendorProducts = await Product.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { "vendor._id": { $in: allVendorIds } },
      ],
    }).select("_id");
    const vendorProductIds = vendorProducts.map((p) => p._id);

    // 3. Find orders from OrderItem collection
    const orderItems = await OrderItem.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { product: { $in: vendorProductIds } },
      ],
    }).populate({
      path: "order",
      populate: {
        path: "user",
        select: "firstName lastName email phone",
      },
    });

    const customerMap = {};

    for (const item of orderItems) {
      if (!item.order) continue;
      const orderDoc = item.order;
      const email =
        orderDoc.shippingAddress?.email ||
        orderDoc.user?.email ||
        orderDoc.customerEmail ||
        `guest-${orderDoc._id}`;

      const name =
        orderDoc.shippingAddress?.fullName ||
        orderDoc.shippingAddress?.name ||
        "Customer";
      const phone =
        orderDoc.shippingAddress?.phone || orderDoc.customerPhone || "";
      const itemTotal = Number(
        item.subtotal || item.unitPrice * (item.quantity || 1) || 0,
      );
      const orderDate =
        orderDoc.placedAt || orderDoc.createdAt || item.createdAt;

      if (!customerMap[email]) {
        customerMap[email] = {
          id: orderDoc.user?._id || orderDoc._id,
          name,
          email: email.startsWith("guest-") ? "—" : email,
          phone: phone || "—",
          orderCount: 0,
          totalSpent: 0,
          lastOrderDate: orderDate,
          status: "Active Buyer",
        };
      }

      customerMap[email].orderCount += 1;
      customerMap[email].totalSpent += itemTotal;
      if (new Date(orderDate) > new Date(customerMap[email].lastOrderDate)) {
        customerMap[email].lastOrderDate = orderDate;
      }
    }

    // 4. Also check direct Order collection (if items were embedded in Order)
    const directOrders = await Order.find({
      $or: [
        { "items.vendor": { $in: allVendorIds } },
        { "items.product": { $in: vendorProductIds } },
        { vendor: { $in: allVendorIds } },
      ],
    });

    for (const orderDoc of directOrders) {
      const email =
        orderDoc.shippingAddress?.email ||
        orderDoc.customerEmail ||
        `order-${orderDoc._id}`;
      if (customerMap[email] && !email.startsWith("order-")) continue;

      const vendorItems = (orderDoc.items || []).filter((it) => {
        const itemVendorId = it.vendor?._id || it.vendor;
        const itemProductId = it.product?._id || it.product;
        return (
          allVendorIds.some((vId) => String(vId) === String(itemVendorId)) ||
          vendorProductIds.some((pId) => String(pId) === String(itemProductId))
        );
      });

      const itemsToUse =
        vendorItems.length > 0 ? vendorItems : orderDoc.items || [];
      const computedTotal = itemsToUse.reduce(
        (sum, it) =>
          sum +
          Number(
            it.subtotal || (it.price || it.unitPrice || 0) * (it.quantity || 1),
          ),
        0,
      );

      const name =
        orderDoc.shippingAddress?.fullName ||
        orderDoc.shippingAddress?.name ||
        "Customer";
      const phone =
        orderDoc.shippingAddress?.phone || orderDoc.customerPhone || "";
      const orderDate = orderDoc.placedAt || orderDoc.createdAt;

      if (!customerMap[email]) {
        customerMap[email] = {
          id: orderDoc.user || orderDoc._id,
          name,
          email: email.startsWith("order-") ? "—" : email,
          phone: phone || "—",
          orderCount: 1,
          totalSpent: computedTotal,
          lastOrderDate: orderDate,
          status: "Active Buyer",
        };
      } else {
        customerMap[email].orderCount += 1;
        customerMap[email].totalSpent += computedTotal;
        if (new Date(orderDate) > new Date(customerMap[email].lastOrderDate)) {
          customerMap[email].lastOrderDate = orderDate;
        }
      }
    }

    // Format output dates nicely
    const customers = Object.values(customerMap).map((c) => ({
      ...c,
      lastOrderDate: c.lastOrderDate
        ? new Date(c.lastOrderDate).toLocaleDateString("en-US", {
            month: "short",
            day: "2-digit",
            year: "numeric",
          })
        : "—",
    }));

    return res.status(200).json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (error) {
    console.error("Get Vendor Customers Error:", error);
    return res.status(200).json({
      success: true,
      count: 0,
      customers: [],
    });
  }
};

export const getVendorCustomerById = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    const { id } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Missing vendor token.",
      });
    }

    // 1. Gather all potential vendor identity IDs
    const allVendorIds = [];
    if (mongoose.Types.ObjectId.isValid(userId)) {
      allVendorIds.push(new mongoose.Types.ObjectId(userId));
    }

    const vendorProfile = await VendorProfile.findOne({
      $or: [
        { user: userId },
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: req.user?.email || "" },
      ].filter(Boolean),
    });

    if (vendorProfile) {
      if (vendorProfile._id) allVendorIds.push(vendorProfile._id);
      if (vendorProfile.user) allVendorIds.push(vendorProfile.user);
    }

    // 2. Find all product IDs owned by this vendor
    const vendorProducts = await Product.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { "vendor._id": { $in: allVendorIds } },
      ],
    }).select("_id name title price images image");
    const vendorProductIds = vendorProducts.map((p) => p._id);

    // 3. Resolve Customer Identity (handles User ID, Order ID, or Email)
    let targetUserId = null;
    let targetEmail = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      const userDoc = await User.findById(id).lean();
      if (userDoc) {
        targetUserId = userDoc._id;
        targetEmail = userDoc.email;
      } else {
        const orderDoc = await Order.findById(id).lean();
        if (orderDoc) {
          targetUserId = orderDoc.user;
          targetEmail =
            orderDoc.shippingAddress?.email || orderDoc.customerEmail;
        }
      }
    } else if (typeof id === "string" && id.includes("@")) {
      targetEmail = id.trim().toLowerCase();
    }

    // 4. Query ALL orders placed by this customer that include this vendor's products
    const customerFilter = [];
    if (targetUserId) customerFilter.push({ user: targetUserId });
    if (targetEmail) {
      customerFilter.push({ "shippingAddress.email": targetEmail });
      customerFilter.push({ customerEmail: targetEmail });
    }
    if (mongoose.Types.ObjectId.isValid(id)) {
      customerFilter.push({ _id: id });
    }

    const orders = await Order.find({
      $and: [
        { $or: customerFilter.length > 0 ? customerFilter : [{ _id: id }] },
        {
          $or: [
            { "items.vendor": { $in: allVendorIds } },
            { "items.product": { $in: vendorProductIds } },
            { vendor: { $in: allVendorIds } },
          ],
        },
      ],
    })
      .populate("user", "firstName lastName email phone address")
      .populate("items.product", "name title price images image")
      .sort({ createdAt: -1 })
      .lean();

    // Also fetch items from OrderItem collection if applicable
    const orderItemDocs = await OrderItem.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { product: { $in: vendorProductIds } },
      ],
    })
      .populate({
        path: "order",
        match:
          customerFilter.length > 0 ? { $or: customerFilter } : { _id: id },
      })
      .populate("product", "name title price images image")
      .lean();

    // 5. Build Unified Store Order History
    const ordersMap = {};

    // Helper: Safely resolve and format full address from order or user
    const extractAddress = (orderDoc, userDoc) => {
      const addr = orderDoc?.shippingAddress || userDoc?.address || {};
      if (typeof addr === "string" && addr.trim()) return addr.trim();

      const line1 =
        addr.street || addr.addressLine1 || addr.address || addr.line1 || "";
      const line2 = addr.addressLine2 || addr.landmark || addr.line2 || "";
      const city = addr.city || "";
      const state = addr.state || "";
      const pin = addr.pincode || addr.postalCode || addr.zipCode || "";
      const country = addr.country || "India";

      const parts = [
        line1,
        line2,
        city,
        state,
        pin ? `- ${pin}` : "",
        country,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(", ") : "Address not provided";
    };

    // Process Direct Orders
    for (const ord of orders) {
      const orderId = ord._id.toString();
      const vendorItems = (ord.items || []).filter((it) => {
        const itemVendorId = it.vendor?._id || it.vendor;
        const itemProductId = it.product?._id || it.product;
        return (
          allVendorIds.some((vId) => String(vId) === String(itemVendorId)) ||
          vendorProductIds.some((pId) => String(pId) === String(itemProductId))
        );
      });

      const itemsToUse = vendorItems.length > 0 ? vendorItems : ord.items || [];
      const orderAmount = itemsToUse.reduce((sum, it) => {
        const unitPrice = Number(
          it.price || it.unitPrice || it.product?.price || 0,
        );
        const qty = Number(it.quantity || 1);
        return sum + Number(it.subtotal || unitPrice * qty);
      }, 0);

      ordersMap[orderId] = {
        id: ord.orderNumber || `#${orderId.slice(-6).toUpperCase()}`,
        orderDocId: orderId,
        date: ord.placedAt || ord.createdAt,
        amount: orderAmount,
        status: ord.orderStatus || ord.status || "Processing",
        paymentMethod: ord.paymentMethod || "Online",
        paymentStatus: ord.paymentStatus || "Paid",
        shippingAddress: extractAddress(ord, ord.user),
        customerName:
          ord.shippingAddress?.fullName ||
          ord.shippingAddress?.name ||
          (ord.user
            ? `${ord.user.firstName || ""} ${ord.user.lastName || ""}`.trim()
            : "Customer"),
        customerEmail:
          ord.shippingAddress?.email ||
          ord.user?.email ||
          ord.customerEmail ||
          "—",
        customerPhone:
          ord.shippingAddress?.phone ||
          ord.user?.phone ||
          ord.customerPhone ||
          "—",
        items: itemsToUse.map((it) => ({
          productName:
            it.name ||
            it.title ||
            it.productName ||
            it.product?.name ||
            "Product",
          productImage:
            it.productImage ||
            it.image ||
            it.product?.images?.[0] ||
            it.product?.image ||
            "",
          quantity: Number(it.quantity || 1),
          price: Number(it.price || it.unitPrice || it.product?.price || 0),
          subtotal: Number(
            it.subtotal ||
              Number(it.price || it.unitPrice || 0) * Number(it.quantity || 1),
          ),
        })),
      };
    }

    // Incorporate OrderItem records
    for (const item of orderItemDocs) {
      if (!item.order) continue;
      const ord = item.order;
      const orderId = ord._id.toString();

      const itemTotal = Number(
        item.subtotal || (item.unitPrice || 0) * (item.quantity || 1),
      );

      if (!ordersMap[orderId]) {
        ordersMap[orderId] = {
          id: ord.orderNumber || `#${orderId.slice(-6).toUpperCase()}`,
          orderDocId: orderId,
          date: ord.placedAt || ord.createdAt || item.createdAt,
          amount: itemTotal,
          status: item.status || ord.orderStatus || "Processing",
          paymentMethod: ord.paymentMethod || "Online",
          paymentStatus: ord.paymentStatus || "Paid",
          shippingAddress: extractAddress(ord, null),
          customerName:
            ord.shippingAddress?.fullName ||
            ord.shippingAddress?.name ||
            "Customer",
          customerEmail: ord.shippingAddress?.email || ord.customerEmail || "—",
          customerPhone: ord.shippingAddress?.phone || ord.customerPhone || "—",
          items: [],
        };
      } else {
        // If not already in items list, update amount and push item
        const exists = ordersMap[orderId].items.some(
          (i) => i.productName === (item.productName || item.product?.name),
        );
        if (!exists) {
          ordersMap[orderId].amount += itemTotal;
        }
      }

      ordersMap[orderId].items.push({
        productName:
          item.productName ||
          item.product?.name ||
          item.product?.title ||
          "Product",
        productImage:
          item.productImage ||
          item.product?.images?.[0] ||
          item.product?.image ||
          "",
        quantity: Number(item.quantity || 1),
        price: Number(item.unitPrice || item.price || 0),
        subtotal: itemTotal,
      });
    }

    const orderList = Object.values(ordersMap).sort(
      (a, b) => new Date(b.date) - new Date(a.date),
    );

    // 6. Compute Total Spent & Aggregate Customer Profile
    const totalSpent = orderList.reduce(
      (acc, curr) => acc + Number(curr.amount || 0),
      0,
    );
    const primaryOrder = orderList[0] || {};

    const customerData = {
      id: id,
      name: primaryOrder.customerName || "Customer",
      email: targetEmail || userDoc?.email || primaryOrder.customerEmail || "—",
      phone: primaryOrder.customerPhone || "—",
      address: primaryOrder.shippingAddress || "Address not provided",
      totalSpent: totalSpent,
      orderCount: orderList.length,
      status: "Active Buyer",
      recentVendorOrders: orderList.map((ord) => ({
        id: ord.id,
        orderDocId: ord.orderDocId,
        date: ord.date
          ? new Date(ord.date).toLocaleDateString("en-US", {
              month: "short",
              day: "2-digit",
              year: "numeric",
            })
          : "—",
        amount: ord.amount,
        status: ord.status,
        paymentMethod: ord.paymentMethod,
        paymentStatus: ord.paymentStatus,
        product:
          ord.items
            .map((i) => `${i.productName} (x${i.quantity})`)
            .join(", ") || "Store Item",
        items: ord.items,
      })),
    };

    return res.status(200).json({
      success: true,
      customer: customerData,
    });
  } catch (error) {
    console.error("Error in getVendorCustomerById:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching customer details.",
      error: error.message,
    });
  }
};

export const getVendorProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Valid authenticated vendor user ID is required.",
        });
    }
    const vendor = await VendorProfile.findOne({ user: userId })
      .populate("user", "firstName middleName lastName email phone role")
      .populate("categories", "name")
      .lean();

    if (!vendor) {
      return res
        .status(404)
        .json({
          success: false,
          message: "No vendor profile found for this account.",
        });
    }
    const addr = vendor.businessAddress || {};
    const formattedProfile = {
      _id: vendor._id,
      storeName: vendor.storeName || "",
      storeDescription: vendor.storeDescription || "",
      storeLogo: vendor.storeLogo || "",
      ownerName: vendor.user
        ? [vendor.user.firstName, vendor.user.middleName, vendor.user.lastName]
            .filter(Boolean)
            .join(" ")
        : "",
      firstName: vendor.user?.firstName || "",
      middleName: vendor.user?.middleName || "",
      lastName: vendor.user?.lastName || "",
      email: vendor.user?.email || "",
      phone: vendor.user?.phone || "",
      businessType: vendor.businessType || "",
      businessCategory: vendor.businessCategory || "",
      gstNumber: vendor.gstNumber || "Not Provided",
      panNumber: vendor.panNumber || "Not Provided",
      businessAddress: {
        addressLine1: addr.addressLine1 || "",
        addressLine2: addr.addressLine2 || "",
        city: addr.city || "",
        state: addr.state || "",
        pincode: addr.pincode || "",
        country: addr.country || "India",
      },
      status: vendor.status || "pending",
      categories: vendor.categories || [],
      createdAt: vendor.createdAt,
    };
    return res.status(200).json({ success: true, profile: formattedProfile });
  } catch (error) {
    console.error("getVendorProfile error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVendorProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Valid authenticated vendor user ID is required.",
        });
    }
    const {
      vendorName,
      ownerFirstName,
      ownerMiddleName,
      ownerLastName,
      businessName,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      country,
      email,
      phone,
    } = req.body;

    const vendor = await VendorProfile.findOne({ user: userId });
    if (!vendor) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor profile not found." });
    }

    if (vendorName?.trim()) vendor.storeName = vendorName.trim();
    if (businessName !== undefined) vendor.businessType = businessName.trim();

    vendor.businessAddress = {
      ...(vendor.businessAddress || {}),
      addressLine1: addressLine1?.trim() || "",
      addressLine2: addressLine2?.trim() || "",
      city: city?.trim() || "",
      state: state?.trim() || "",
      pincode: pincode?.trim() || "",
      country: country?.trim() || "India",
    };
    await vendor.save();

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor user account not found." });
    }

    if (ownerFirstName !== undefined) user.firstName = ownerFirstName.trim();
    if (ownerMiddleName !== undefined) user.middleName = ownerMiddleName.trim();
    if (ownerLastName !== undefined) user.lastName = ownerLastName.trim();
    if (email !== undefined) user.email = email.trim().toLowerCase();
    if (phone !== undefined) user.phone = phone.trim();
    await user.save();

    const updatedVendor = await VendorProfile.findById(vendor._id)
      .populate("user", "firstName middleName lastName email phone role")
      .populate("categories", "name");

    return res.status(200).json({
      success: true,
      message: "Vendor profile updated successfully!",
      vendor: updatedVendor,
    });
  } catch (error) {
    console.error("updateVendorProfile error:", error);
    if (error.code === 11000) {
      return res
        .status(400)
        .json({
          success: false,
          message: "This email address is already registered.",
        });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorStore = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized. Missing user ID." });
    }
    let profile = await VendorProfile.findOne({ user: userId }).populate(
      "user",
      "name email phone firstName lastName",
    );
    if (!profile) {
      const user = await User.findById(userId);
      const defaultStoreName =
        user?.name ||
        `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
        "My Vendor Store";
      profile = await VendorProfile.create({
        user: userId,
        storeName: defaultStoreName,
        storeDescription: "Welcome to our store on SmartCommerce.",
        storeLogo: "",
        businessAddress: {
          addressLine1: "",
          city: "",
          state: "",
          pincode: "",
          country: "India",
        },
        businessType: "Individual",
        panNumber: "ABCDE1234F",
        bankDetails: {
          accountHolderName: defaultStoreName,
          bankName: "State Bank of India",
          accountNumber: "00000000000",
          ifscCode: "SBIN0000001",
        },
        businessStatus: "accepting_orders",
      });
    }
    return res.status(200).json({
      success: true,
      store: {
        _id: profile._id,
        id: profile._id,
        storeName: profile.storeName,
        storeDescription: profile.storeDescription,
        storeLogo: profile.storeLogo,
        website: profile.website || "",
        contactEmail: profile.user?.email || "",
        contactPhone: profile.contactPhone || profile.user?.phone || "",
        address: profile.businessAddress?.addressLine1 || "",
        city: profile.businessAddress?.city || "",
        state: profile.businessAddress?.state || "",
        pincode: profile.businessAddress?.pincode || "",
        country: profile.businessAddress?.country || "India",
        businessStatus: profile.businessStatus || "accepting_orders",
      },
    });
  } catch (error) {
    console.error("getVendorStore error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVendorStore = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized. Missing user ID." });
    }
    const {
      storeName,
      storeDescription,
      website,
      contactPhone,
      address,
      city,
      state,
      pincode,
      country,
      businessStatus,
      existingLogo,
    } = req.body;

    if (!storeName || !storeName.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Store name is required." });
    }

    let finalLogoUrl = existingLogo !== undefined ? existingLogo : undefined;
    if (req.file && req.file.buffer) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "smartcommerce_vendors",
      );
      finalLogoUrl = uploadResult.secure_url;
    }

    const updateFields = {
      storeName: storeName.trim(),
      storeDescription: storeDescription || "",
      website: website || "",
      contactPhone: contactPhone || "",
      "businessAddress.addressLine1": address || "",
      "businessAddress.city": city || "",
      "businessAddress.state": state || "",
      "businessAddress.pincode": pincode || "",
      "businessAddress.country": country || "India",
      businessStatus: businessStatus || "accepting_orders",
    };
    if (finalLogoUrl !== undefined) {
      updateFields.storeLogo = finalLogoUrl;
    }
    const updatedProfile = await VendorProfile.findOneAndUpdate(
      { user: userId },
      { $set: updateFields },
      { new: true, upsert: true, runValidators: true },
    );
    return res.status(200).json({
      success: true,
      message: "Store settings updated successfully.",
      store: updatedProfile,
    });
  } catch (error) {
    console.error("updateVendorStore error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const changeVendorPassword = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized. Missing user ID." });
    }
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please fill in all password fields.",
        });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({
          success: false,
          message: "New password must be at least 8 characters long.",
        });
    }
    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({
          success: false,
          message: "New password and confirm password do not match.",
        });
    }
    if (currentPassword === newPassword) {
      return res
        .status(400)
        .json({
          success: false,
          message: "New password must be different from current password.",
        });
    }
    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor user account not found." });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Current password does not match our records.",
        });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    return res
      .status(200)
      .json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("changeVendorPassword error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVendorOrders = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized. Missing vendor token.",
        });
    }

    const allVendorIds = await resolveAllVendorIds(userId, req.user?.email);

    // Find all products owned by this vendor
    const vendorProducts = await Product.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { "vendor._id": { $in: allVendorIds } },
      ],
    }).select("_id");
    const vendorProductIds = vendorProducts.map((p) => p._id);

    // Query OrderItems matching this vendor
    const orderItems = await OrderItem.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { product: { $in: vendorProductIds } },
      ],
    })
      .populate("order")
      .populate("product", "name title price images image")
      .sort({ createdAt: -1 });

    const ordersMap = {};

    for (const item of orderItems) {
      if (!item.order) continue;
      const orderDoc = item.order;
      const orderId = orderDoc._id.toString();

      if (!ordersMap[orderId]) {
        ordersMap[orderId] = {
          _id: orderDoc._id,
          orderNumber:
            orderDoc.orderNumber || `#${orderId.slice(-6).toUpperCase()}`,
          customerName:
            orderDoc.shippingAddress?.fullName ||
            orderDoc.shippingAddress?.name ||
            "Customer",
          customerPhone: orderDoc.shippingAddress?.phone || "",
          customerEmail: orderDoc.shippingAddress?.email || "",
          shippingAddress: orderDoc.shippingAddress || {},
          totalAmount: 0,
          paymentMethod: orderDoc.paymentMethod || "online",
          paymentStatus: item.isPaid
            ? "Paid"
            : orderDoc.paymentStatus || "pending",
          // Vendor-specific package status takes precedence
          orderStatus: item.status || "pending",
          courier: item.carrier || "",
          trackingNumber: item.trackingNumber || "",
          date: orderDoc.placedAt || orderDoc.createdAt || item.createdAt,
          items: [],
        };
      }

      const itemTotal = Number(
        item.subtotal || item.unitPrice * (item.quantity || 1) || 0,
      );
      ordersMap[orderId].totalAmount += itemTotal;
      ordersMap[orderId].items.push({
        _id: item._id,
        id: item._id,
        productName:
          item.productName ||
          item.product?.name ||
          item.product?.title ||
          "Product",
        productImage:
          item.productImage ||
          item.product?.images?.[0] ||
          item.product?.image ||
          "",
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        subtotal: itemTotal,
        status: item.status || "pending",
        carrier: item.carrier || "",
        trackingNumber: item.trackingNumber || "",
      });
    }

    const orders = Object.values(ordersMap);

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get Vendor Orders Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve vendor orders.",
      error: error.message,
    });
  }
};

export const getVendorOrderById = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    const { id } = req.params;
    const userId = getUserId(req);

    if (!userId) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized. Missing vendor token.",
        });
    }

    const allVendorIds = await resolveAllVendorIds(userId, req.user?.email);

    // Find Master Order
    const order = await Order.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { orderNumber: id },
      ],
    }).lean();

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    // Find ONLY this vendor's items in this order
    const vendorProducts = await Product.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { "vendor._id": { $in: allVendorIds } },
      ],
    }).select("_id");
    const vendorProductIds = vendorProducts.map((p) => p._id);

    const vendorItems = await OrderItem.find({
      order: order._id,
      $or: [
        { vendor: { $in: allVendorIds } },
        { product: { $in: vendorProductIds } },
      ],
    })
      .populate("product")
      .lean();

    if (!vendorItems || vendorItems.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You do not have products in this order.",
      });
    }

    // Calculate vendor-specific revenue and package status
    const vendorTotal = vendorItems.reduce(
      (sum, item) =>
        sum + (item.subtotal || item.unitPrice * item.quantity || 0),
      0,
    );
    const vendorPackageStatus = vendorItems[0]?.status || "pending";
    const vendorCarrier = vendorItems[0]?.carrier || "";
    const vendorTracking = vendorItems[0]?.trackingNumber || "";

    const isCod = String(order.paymentMethod || "").toLowerCase() === "cod";
    const isVendorPackagePaid = isCod
      ? vendorItems.every((item) => item.isPaid)
      : true;

    return res.status(200).json({
      success: true,
      order: {
        ...order,
        items: vendorItems,
        totalAmount: vendorTotal,
        orderStatus: vendorPackageStatus,
        courier: vendorCarrier,
        trackingNumber: vendorTracking,
        paymentStatus: isVendorPackagePaid ? "Paid" : "Pending",
        masterOrderStatus: order.orderStatus,
      },
    });
  } catch (error) {
    console.error("Get Vendor Order By ID Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVendorOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, orderStatus, courier, carrier, trackingNumber } = req.body;
    const userId = getUserId(req);
    if (!userId) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized. Missing vendor token.",
        });
    }
    const newStatus = (orderStatus || status || "").trim().toLowerCase();
    if (!newStatus) {
      return res
        .status(400)
        .json({ success: false, message: "Status is required." });
    }
    const allVendorIds = await resolveAllVendorIds(userId, req.user?.email);
    // 1. Find the Master Order
    const order = await Order.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { orderNumber: id },
      ],
    });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }
    // 2. Find THIS VENDOR'S items in this order
    const vendorProducts = await Product.find({
      $or: [
        { vendor: { $in: allVendorIds } },
        { "vendor._id": { $in: allVendorIds } },
      ],
    }).select("_id");
    const vendorProductIds = vendorProducts.map((p) => p._id);
    const vendorItems = await OrderItem.find({
      order: order._id,
      $or: [
        { vendor: { $in: allVendorIds } },
        { product: { $in: vendorProductIds } },
      ],
    });
    if (!vendorItems || vendorItems.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this order.",
      });
    }
    for (const item of vendorItems) {
      const currentStatus = (item.status || "pending").toLowerCase();
      // Guard 1: If already Cancelled -> Cannot change to any other status
      if (currentStatus === "cancelled" && newStatus !== "cancelled") {
        return res.status(400).json({
          success: false,
          message:
            "This package has been cancelled and its status cannot be modified.",
        });
      }
      // Guard 2: If already Shipped or Delivered -> Cannot be Cancelled
      if (
        newStatus === "cancelled" &&
        ["shipped", "delivered"].includes(currentStatus)
      ) {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel a package that is already ${currentStatus.toUpperCase()}.`,
        });
      }
    }
    const isDelivered = newStatus === "delivered";
    const isCod = String(order.paymentMethod || "").toLowerCase() === "cod";
    const shippingCarrier = courier || carrier || "";
    // 3. Update ONLY THIS VENDOR'S items
    for (const item of vendorItems) {
      item.status = newStatus;
      if (shippingCarrier) item.carrier = shippingCarrier;
      if (trackingNumber) item.trackingNumber = trackingNumber;
      if (isDelivered) {
        item.deliveredAt = new Date();
        if (isCod) {
          item.isPaid = true;
          item.paidAt = new Date();
        }
      }
      await item.save();
    }
    // 4. AUTOMATICALLY COMPUTE & RE-AGGREGATE MASTER ORDER STATUS
    const allOrderItems = await OrderItem.find({ order: order._id });
    if (allOrderItems.length > 0) {
      const statuses = allOrderItems.map((it) =>
        (it.status || "pending").toLowerCase(),
      );
      const total = statuses.length;
      const deliveredCount = statuses.filter((s) => s === "delivered").length;
      const shippedCount = statuses.filter((s) => s === "shipped").length;
      const cancelledCount = statuses.filter((s) => s === "cancelled").length;
      const activeCount = total - cancelledCount;
      if (cancelledCount === total) {
        order.orderStatus = "cancelled";
        order.cancelledAt = order.cancelledAt || new Date();
      } else if (activeCount > 0 && deliveredCount === activeCount) {
        order.orderStatus = "delivered";
        order.deliveredAt = order.deliveredAt || new Date();
        if (isCod) {
          order.paymentStatus = "paid";
          order.isPaid = true;
          order.paidAt = order.paidAt || new Date();
          await Payment.findOneAndUpdate(
            { order: order._id },
            { status: "success", paymentStatus: "paid", paidAt: new Date() },
          ).catch(() => null);
        }
      } else if (deliveredCount > 0) {
        order.orderStatus = "partially_delivered";
        if (isCod) order.paymentStatus = "partially_paid";
      } else if (
        activeCount > 0 &&
        shippedCount + deliveredCount === activeCount
      ) {
        order.orderStatus = "shipped";
      } else if (shippedCount > 0) {
        order.orderStatus = "partially_shipped";
      } else {
        order.orderStatus = "processing";
      }
      await order.save();
    }
    return res.status(200).json({
      success: true,
      message: `Your package updated to ${newStatus}. Master order status is '${order.orderStatus}'.`,
      packageStatus: newStatus,
      masterOrderStatus: order.orderStatus,
      vendorItems,
      order,
    });
  } catch (error) {
    console.error("Error updating vendor order status:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update vendor order status.",
    });
  }
};

export const getVendorEarnings = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    const vendorIds = await resolveAllVendorIds(userId, req.user?.email);
    if (!vendorIds || vendorIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found for this account.",
      });
    }
    // 1. Fetch all Vendor Earnings
    const earnings = await VendorEarning.find({
      vendor: { $in: vendorIds },
    })
      .populate("order", "orderNumber totalAmount paymentMethod createdAt")
      .sort({ createdAt: -1 });
    // 2. Fetch all completed Payout disbursements
    const payouts = await Payout.find({
      vendor: { $in: vendorIds },
      status: "completed",
    }).sort({ createdAt: -1 });
    // Compute live metrics
    let grossSales = 0;
    let platformCommission = 0;
    let netEarnings = 0;
    earnings.forEach((e) => {
      grossSales += Number(e.grossAmount || 0);
      platformCommission += Number(e.commissionAmount || 0);
      netEarnings += Number(e.netAmount || 0);
    });
    const paidOut = payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const availableBalance = Math.max(netEarnings - paidOut, 0);
    const pendingPayout = availableBalance;
    // 3. Compute Monthly Revenue Bar Performance (Current Calendar Year)
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const currentYear = new Date().getFullYear();
    const monthlyMap = {};
    months.forEach((m) => (monthlyMap[m] = 0));
    earnings.forEach((e) => {
      const d = new Date(e.createdAt || Date.now());
      if (d.getFullYear() === currentYear) {
        const mName = months[d.getMonth()];
        monthlyMap[mName] += Number(e.grossAmount || 0);
      }
    });
    const monthlyChart = months.map((month) => ({
      month,
      sales: monthlyMap[month],
    }));
    // 4. Construct Audit Transaction Feed
    const recentTransactions = [];
    // Add Sales Credits
    earnings.slice(0, 15).forEach((e) => {
      const orderNum = e.order?.orderNumber || "ORDER";
      const orderDate = new Date(e.createdAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      // Sale Credit
      recentTransactions.push({
        id: `TXN-${e._id.toString().slice(-6).toUpperCase()}`,
        date: orderDate,
        type: "Sale Credit",
        orderId: `#${orderNum}`,
        amount: e.netAmount,
        status: e.earningStatus === "paid_out" ? "Paid Out" : "Available",
        timestamp: new Date(e.createdAt).getTime(),
      });
      // Commission Deduction
      recentTransactions.push({
        id: `COM-${e._id.toString().slice(-6).toUpperCase()}`,
        date: orderDate,
        type: "Platform Commission (2%)",
        orderId: `#${orderNum}`,
        amount: -e.commissionAmount,
        status: "Deducted",
        timestamp: new Date(e.createdAt).getTime() - 1,
      });
    });
    // Add Payout Disbursals
    payouts.forEach((p) => {
      recentTransactions.push({
        id: p.payoutNumber || `PO-${p._id.toString().slice(-6).toUpperCase()}`,
        date: new Date(p.paidAt || p.createdAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        type: "Payout Settlement",
        orderId: p.paymentReference || "Bank UTR",
        amount: -Number(p.amount || 0),
        status: "Disbursed",
        timestamp: new Date(p.paidAt || p.createdAt).getTime(),
      });
    });
    // Sort audit log newest first
    recentTransactions.sort((a, b) => b.timestamp - a.timestamp);
    return res.status(200).json({
      success: true,
      earnings: {
        grossSales,
        platformCommission,
        netEarnings,
        paidOut,
        pendingPayout,
        availableBalance,
        monthlyChart,
        recentTransactions: recentTransactions.slice(0, 20),
      },
    });
  } catch (error) {
    console.error("Error in getVendorEarnings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve vendor financial earnings.",
    });
  }
};

export const getVendorPayouts = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    const vendorIds = await resolveAllVendorIds(userId, req.user?.email);
    if (!vendorIds || vendorIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }
    const payouts = await Payout.find({
      vendor: { $in: vendorIds },
    })
      .populate("vendor", "storeName bankDetails")
      .sort({ createdAt: -1 });
    const formattedList = payouts.map((p) => {
      const netAmount = Number(p.amount || 0);
      const grossSales = Math.round(netAmount / 0.98); // Reverse-calc based on 2% commission
      const commission = grossSales - netAmount;
      const dateStr = new Date(p.paidAt || p.createdAt).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
        },
      );
      const periodStr =
        p.periodStart && p.periodEnd
          ? `${new Date(p.periodStart).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
            })} – ${new Date(p.periodEnd).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}`
          : dateStr;
      const bank = p.vendor?.bankDetails || {};
      const methodDisplay =
        p.payoutMethod === "upi"
          ? `UPI (${p.paymentReference || "Direct"})`
          : `Bank Transfer (${bank.bankName || "NEFT/RTGS"})`;
      return {
        id: p.payoutNumber || `PO-${p._id.toString().slice(-6).toUpperCase()}`,
        _id: p._id.toString(),
        period: periodStr,
        grossSales,
        commission,
        netAmount,
        payoutDate: dateStr,
        paymentMethod: methodDisplay,
        transactionId: p.paymentReference || "—",
        status:
          p.status === "completed"
            ? "Paid"
            : p.status === "processing"
              ? "Processing"
              : "Failed",
        adminNote: p.adminNote || "",
      };
    });
    return res.status(200).json({
      success: true,
      payouts: formattedList,
    });
  } catch (error) {
    console.error("Error in getVendorPayouts:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve vendor payouts.",
    });
  }
};

export const getVendorPayoutById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    const vendorIds = await resolveAllVendorIds(userId, req.user?.email);
    let payout = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      payout = await Payout.findOne({
        _id: id,
        vendor: { $in: vendorIds },
      }).populate("vendor");
    }
    if (!payout) {
      payout = await Payout.findOne({
        payoutNumber: id,
        vendor: { $in: vendorIds },
      }).populate("vendor");
    }
    if (!payout) {
      return res.status(404).json({
        success: false,
        message: "Payout record not found.",
      });
    }
    const netAmount = Number(payout.amount || 0);
    const grossSales = Math.round(netAmount / 0.98);
    const commission = grossSales - netAmount;
    const bank = payout.vendor?.bankDetails || {};
    return res.status(200).json({
      success: true,
      payout: {
        id:
          payout.payoutNumber ||
          `PO-${payout._id.toString().slice(-6).toUpperCase()}`,
        _id: payout._id.toString(),
        period: `${new Date(
          payout.periodStart || payout.createdAt,
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        })} – ${new Date(
          payout.periodEnd || payout.createdAt,
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`,
        grossSales,
        commission,
        netAmount,
        status: payout.status === "completed" ? "Paid" : "Processing",
        payoutDate: new Date(
          payout.paidAt || payout.createdAt,
        ).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        transactionId: payout.paymentReference,
        bankName: bank.bankName || "Authorized Bank",
        accountNumber: bank.accountNumber
          ? `•••• •••• ${bank.accountNumber.slice(-4)}`
          : "Verified Account",
        ifscCode: bank.ifscCode || "—",
        adminNote: payout.adminNote || "",
      },
    });
  } catch (error) {
    console.error("Error in getVendorPayoutById:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve payout details.",
    });
  }
};
