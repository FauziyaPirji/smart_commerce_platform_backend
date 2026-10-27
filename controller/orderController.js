import Razorpay from "razorpay";
import crypto from "crypto";
import mongoose from "mongoose";
import Order from "../model/Order.js";
import OrderItem from "../model/OrderItem.js";
import Cart from "../model/Cart.js";
import Payment from "../model/Payment.js";
import Product from "../model/Product.js";
import InventoryLog from "../model/InventoryLog.js";
import VendorEarning from "../model/VendorEarning.js";
import VendorProfile from "../model/VendorProfile.js";

// Razorpay instance — requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Generate unique order number: SC-XXXXXXXX
const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `SC-${timestamp}${random}`;
};

// Multi-format user ID extraction
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

// MASTER ORDER STATUS AGGREGATOR
// Auto-calculates parent Order status and COD payment status from OrderItems
export const syncMasterOrderStatus = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  const items = await OrderItem.find({ order: order._id });
  if (!items || items.length === 0) return order;

  const statuses = items.map((i) => (i.status || "pending").toLowerCase());
  const isCod = String(order.paymentMethod || "").toLowerCase() === "cod";

  const totalItems = statuses.length;
  const deliveredCount = statuses.filter((s) => s === "delivered").length;
  const shippedCount = statuses.filter((s) => s === "shipped").length;
  const processingCount = statuses.filter((s) => s === "processing").length;
  const cancelledCount = statuses.filter((s) => s === "cancelled").length;
  const activeItemsCount = totalItems - cancelledCount;

  let newOrderStatus = order.orderStatus;

  // 1. ALL CANCELLED
  if (cancelledCount === totalItems) {
    newOrderStatus = "cancelled";
    order.cancelledAt = order.cancelledAt || new Date();
  }
  // 2. ALL ACTIVE ITEMS DELIVERED
  else if (activeItemsCount > 0 && deliveredCount === activeItemsCount) {
    newOrderStatus = "delivered";
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
  }
  // 3. PARTIALLY DELIVERED
  else if (deliveredCount > 0) {
    newOrderStatus = "partially_delivered";
    if (isCod) order.paymentStatus = "partially_paid";
  }
  // 4. ALL ACTIVE ITEMS SHIPPED
  else if (
    activeItemsCount > 0 &&
    shippedCount + deliveredCount === activeItemsCount
  ) {
    newOrderStatus = "shipped";
  }
  // 5. PARTIALLY SHIPPED
  else if (shippedCount > 0) {
    newOrderStatus = "partially_shipped";
  }
  // 6. PROCESSING
  else if (processingCount > 0) {
    newOrderStatus = "processing";
  } else {
    newOrderStatus = "placed";
  }

  order.orderStatus = newOrderStatus;
  await order.save();
  return order;
};

// SHARED HELPER: VALIDATE STOCK AND RESOLVE CART ITEMS
// Accepts custom deliveryCharge from body or calculates server-side
const resolveAndValidateItems = async (
  bodyItems,
  userId,
  shippingAddress,
  customDeliveryCharge,
) => {
  let rawItems = [];

  if (Array.isArray(bodyItems) && bodyItems.length > 0) {
    rawItems = bodyItems;
  } else {
    const dbCart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select: "name title price mrp discountPrice stock images image vendor",
    });

    if (!dbCart || !dbCart.items || dbCart.items.length === 0) {
      throw {
        status: 400,
        message:
          "Your cart is empty. Please add items before placing an order.",
      };
    }

    rawItems = dbCart.items.map((ci) => ({
      product: ci.product?._id || ci.product,
      productName: ci.product?.name || ci.product?.title || "Product",
      productImage: ci.product?.images?.[0] || ci.product?.image || "",
      unitPrice: Number(ci.product?.discountPrice || ci.product?.price || 0),
      quantity: ci.quantity || 1,
      vendor: ci.product?.vendor,
    }));
  }

  if (!rawItems.length) {
    throw {
      status: 400,
      message: "Cart is empty. Add items before placing an order.",
    };
  }

  const validatedProducts = [];

  for (const item of rawItems) {
    const pId = item.product || item._id || item.id;
    const productDoc = await Product.findById(pId);

    if (!productDoc) {
      throw {
        status: 404,
        message: `"${item.productName || "A product"}" is no longer available. Please remove it from your cart.`,
      };
    }

    const availableStock = Number(productDoc.stock ?? 0);
    const requestedQty = Number(item.quantity || 1);

    if (availableStock <= 0) {
      throw {
        status: 400,
        message: `"${productDoc.name || productDoc.title}" is currently out of stock. Please remove it to continue.`,
      };
    }

    if (requestedQty > availableStock) {
      throw {
        status: 400,
        message: `Only ${availableStock} units of "${productDoc.name || productDoc.title}" are available. Please adjust your quantity.`,
      };
    }

    validatedProducts.push({ item, productDoc, requestedQty, availableStock });
  }

  const subtotal = validatedProducts.reduce((sum, { item, requestedQty }) => {
    return sum + Number(item.unitPrice || item.price || 0) * requestedQty;
  }, 0);

  // Resolve deliveryCharge: use request value if provided, else auto-calculate
  let deliveryCharge = 0;
  if (
    customDeliveryCharge !== undefined &&
    customDeliveryCharge !== null &&
    !isNaN(customDeliveryCharge)
  ) {
    deliveryCharge = Math.max(0, Number(customDeliveryCharge));
  } else {
    const country = (shippingAddress?.country || "India").trim().toLowerCase();
    deliveryCharge = country === "india" ? (subtotal >= 999 ? 0 : 100) : 1500;
  }

  const totalAmount = subtotal + deliveryCharge;

  return { validatedProducts, subtotal, deliveryCharge, totalAmount };
};

// SHARED HELPER: PERSIST ORDER & MULTI-VENDOR ITEMS
const persistOrder = async ({
  userId,
  validatedProducts,
  subtotal,
  deliveryCharge,
  totalAmount,
  shippingAddress,
  paymentMethod,
  paymentData,
}) => {
  const orderNumber = generateOrderNumber();
  const isCod = String(paymentMethod).toLowerCase() === "cod";

  let safePaymentMethod = "upi";
  if (isCod) {
    safePaymentMethod = "cod";
  } else if (paymentMethod) {
    const pm = String(paymentMethod).toLowerCase().trim();
    if (["card", "netbanking", "upi", "cod", "online", "wallet"].includes(pm)) {
      safePaymentMethod = pm;
    } else {
      safePaymentMethod = "upi";
    }
  }

  // 1. Create Parent Order with deliveryCharge saved!
  const newOrder = new Order({
    orderNumber,
    user: userId,
    subtotal,
    discountAmount: 0,
    deliveryCharge: Number(deliveryCharge || 0),
    totalAmount,
    paymentMethod: safePaymentMethod,
    paymentStatus: isCod ? "pending" : "paid",
    orderStatus: "placed",
    shippingAddress: {
      fullName:
        shippingAddress?.fullName || shippingAddress?.name || "Customer",
      phone: shippingAddress?.phone || "",
      addressLine1:
        shippingAddress?.addressLine1 || shippingAddress?.address || "Address",
      addressLine2: shippingAddress?.addressLine2 || "",
      city: shippingAddress?.city || "City",
      state: shippingAddress?.state || "State",
      pincode: shippingAddress?.pincode || "000000",
      country: shippingAddress?.country || "India",
    },
    placedAt: new Date(),
  });

  await newOrder.save();

  // 2. Create Multi-Vendor OrderItems with individual tracking and status
  const orderItemsPayload = validatedProducts.map(
    ({ item, productDoc, requestedQty }) => {
      const unitPrice = Number(
        item.unitPrice ||
          item.price ||
          productDoc.discountPrice ||
          productDoc.price ||
          0,
      );

      let resolvedVendor = null;
      if (
        productDoc.vendor &&
        mongoose.Types.ObjectId.isValid(productDoc.vendor)
      ) {
        resolvedVendor = productDoc.vendor;
      } else if (item.vendor && mongoose.Types.ObjectId.isValid(item.vendor)) {
        resolvedVendor = item.vendor;
      }

      return {
        order: newOrder._id,
        product: productDoc._id,
        vendor: resolvedVendor,
        productName:
          productDoc.name || productDoc.title || item.productName || "Product",
        productImage:
          item.productImage || productDoc.images?.[0] || productDoc.image || "",
        quantity: requestedQty,
        unitPrice,
        subtotal: unitPrice * requestedQty,
        status: "pending",
        carrier: "",
        trackingNumber: "",
        isPaid: !isCod,
        paidAt: !isCod ? new Date() : null,
      };
    },
  );

  const savedItems = await OrderItem.insertMany(orderItemsPayload);

  // 3. Deduct stock atomically and record inventory logs
  for (const {
    productDoc,
    requestedQty,
    availableStock,
  } of validatedProducts) {
    const newStock = Math.max(0, availableStock - requestedQty);
    await Product.findByIdAndUpdate(productDoc._id, {
      $set: { stock: newStock },
    });

    try {
      if (InventoryLog) {
        await InventoryLog.create({
          product: productDoc._id,
          vendor:
            productDoc.vendor &&
            mongoose.Types.ObjectId.isValid(productDoc.vendor)
              ? productDoc.vendor
              : userId,
          type: "subtract",
          quantity: requestedQty,
          previousStock: availableStock,
          newStock,
          reason: "order_placed",
          referenceType: "order",
          referenceId: newOrder._id,
          auditNote: `Purchased in Order #${orderNumber}`,
          adjustedBy: userId,
        });
      }
    } catch (logErr) {
      console.error(
        "Inventory log creation error (non-fatal):",
        logErr.message,
      );
    }
  }

  // 4. Record Payment
  const newPayment = new Payment({
    order: newOrder._id,
    user: userId,
    paymentMethod: safePaymentMethod,
    amount: totalAmount,
    currency: "INR",
    status: isCod ? "pending" : "success",
    razorpayOrderId: paymentData?.razorpayOrderId || null,
    razorpayPaymentId: paymentData?.razorpayPaymentId || null,
    razorpaySignature: paymentData?.razorpaySignature || null,
    transactionId:
      paymentData?.razorpayPaymentId ||
      (!isCod
        ? `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
        : null),
    paidAt: isCod ? null : new Date(),
  });

  await newPayment.save();

  try {
    // Group purchased items by vendor
    const vendorSalesMap = {};
    savedItems.forEach((item) => {
      const vId = item.vendor?.toString();
      if (vId) {
        if (!vendorSalesMap[vId]) {
          vendorSalesMap[vId] = 0;
        }
        vendorSalesMap[vId] += Number(item.subtotal || 0);
      }
    });
    // Create VendorEarning records for each participating vendor
    for (const [vendorId, grossAmount] of Object.entries(vendorSalesMap)) {
      // Find matching VendorProfile
      let profile = await VendorProfile.findOne({
        $or: [{ _id: vendorId }, { user: vendorId }],
      });
      if (profile && grossAmount > 0) {
        const commissionAmount = Math.round(grossAmount * 0.02); // Standard 10% platform fee
        const netAmount = grossAmount - commissionAmount; // 90% Vendor share
        await VendorEarning.create({
          vendor: profile._id,
          order: newOrder._id,
          grossAmount,
          commissionAmount,
          netAmount,
          earningStatus: "available_for_payout",
          availableAt: new Date(),
        });
      }
    }
  } catch (earningErr) {
    console.error(
      "Vendor earning creation error (non-fatal):",
      earningErr.message,
    );
  }

  // 5. Clear cart
  try {
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });
  } catch (e) {
    console.log("Cart clear warning:", e.message);
  }

  return { order: newOrder, items: savedItems, payment: newPayment };
};

// 1. CREATE RAZORPAY ORDER
export const createRazorpayOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const {
      items: bodyItems,
      shippingAddress,
      paymentMethod,
      deliveryCharge: bodyDeliveryCharge,
      deliveryCharges,
    } = req.body;

    if (!shippingAddress) {
      return res
        .status(400)
        .json({ success: false, message: "Shipping address is required." });
    }

    const incomingDeliveryCharge = bodyDeliveryCharge ?? deliveryCharges;

    const { subtotal, deliveryCharge, totalAmount } =
      await resolveAndValidateItems(
        bodyItems,
        userId,
        shippingAddress,
        incomingDeliveryCharge,
      );

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100),
      currency: "INR",
      receipt: `SC-${Date.now().toString().slice(-8)}`,
      notes: {
        userId: String(userId),
        paymentMethod: paymentMethod || "online",
      },
    });

    return res.status(200).json({
      success: true,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
      subtotal,
      deliveryCharge,
      totalAmount,
    });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ success: false, message: err.message });
    }
    console.error("Create Razorpay Order Error:", err);
    return res.status(500).json({
      success: false,
      message:
        err.message || "Failed to initiate payment gateway. Please try again.",
      error: err.message,
    });
  }
};

// 2. VERIFY RAZORPAY PAYMENT & CREATE ORDER
export const verifyAndCreateOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      shippingAddress,
      items: bodyItems,
      deliveryCharge: bodyDeliveryCharge,
      deliveryCharges,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message:
          "Payment verification data is missing. Please contact support.",
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "Payment configuration error: RAZORPAY_KEY_SECRET is missing.",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({
        success: false,
        message:
          "Payment signature verification failed. Please contact support.",
      });
    }

    let resolvedPaymentMethod = "upi";
    if (razorpayPaymentId) {
      try {
        const rzpPayment = await razorpay.payments.fetch(razorpayPaymentId);
        if (rzpPayment && rzpPayment.method) {
          const m = String(rzpPayment.method).toLowerCase().trim();
          if (["card", "netbanking", "upi", "online"].includes(m)) {
            resolvedPaymentMethod = m;
          }
        }
      } catch (fetchErr) {
        console.warn(
          "Could not fetch payment method from Razorpay (falling back to upi):",
          fetchErr.message,
        );
      }
    }

    const incomingDeliveryCharge = bodyDeliveryCharge ?? deliveryCharges;

    const { validatedProducts, subtotal, deliveryCharge, totalAmount } =
      await resolveAndValidateItems(
        bodyItems,
        userId,
        shippingAddress,
        incomingDeliveryCharge,
      );

    const { order, items, payment } = await persistOrder({
      userId,
      validatedProducts,
      subtotal,
      deliveryCharge,
      totalAmount,
      shippingAddress,
      paymentMethod: resolvedPaymentMethod,
      paymentData: { razorpayOrderId, razorpayPaymentId, razorpaySignature },
    });

    return res.status(201).json({
      success: true,
      message: "Payment verified and order placed successfully!",
      order,
      items,
      payment,
    });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ success: false, message: err.message });
    }
    console.error("Verify & Create Order Error:", err);
    return res.status(500).json({
      success: false,
      message:
        err.message ||
        "Payment was received but order creation failed. Please contact support.",
      error: err.message,
    });
  }
};

// 3. CREATE COD ORDER
export const createOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const {
      shippingAddress,
      paymentMethod,
      items: bodyItems,
      deliveryCharge: bodyDeliveryCharge,
      deliveryCharges,
    } = req.body;

    if (!shippingAddress) {
      return res
        .status(400)
        .json({ success: false, message: "Shipping address is required." });
    }

    if ((paymentMethod || "").toLowerCase() !== "cod") {
      return res.status(400).json({
        success: false,
        message: "Online payments must use the Razorpay checkout flow.",
      });
    }

    const incomingDeliveryCharge = bodyDeliveryCharge ?? deliveryCharges;

    const { validatedProducts, subtotal, deliveryCharge, totalAmount } =
      await resolveAndValidateItems(
        bodyItems,
        userId,
        shippingAddress,
        incomingDeliveryCharge,
      );

    const { order, items, payment } = await persistOrder({
      userId,
      validatedProducts,
      subtotal,
      deliveryCharge,
      totalAmount,
      shippingAddress,
      paymentMethod: "cod",
      paymentData: null,
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully! Pay on delivery.",
      order,
      items,
      payment,
    });
  } catch (err) {
    if (err.status) {
      return res
        .status(err.status)
        .json({ success: false, message: err.message });
    }
    console.error("Create COD Order Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to place order. Please try again.",
      error: err.message,
    });
  }
};

// 4. UPDATE INDIVIDUAL ORDER ITEM (VENDOR / ADMIN ACTION)
export const updateOrderItemStatus = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { status, carrier, trackingNumber } = req.body;

    const item = await OrderItem.findById(itemId);
    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: "Order item not found." });
    }

    const parentOrder = await Order.findById(item.order);
    if (!parentOrder) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Associated parent order not found.",
        });
    }

    if (status) item.status = status;
    if (carrier) item.carrier = carrier;
    if (trackingNumber) item.trackingNumber = trackingNumber;

    const isDelivered = (status || "").toLowerCase() === "delivered";
    const isCod =
      String(parentOrder.paymentMethod || "").toLowerCase() === "cod";

    if (isDelivered) {
      item.deliveredAt = new Date();
      if (isCod) {
        item.isPaid = true;
        item.paidAt = new Date();
      }
    }

    await item.save();

    const updatedOrder = await syncMasterOrderStatus(item.order);

    return res.status(200).json({
      success: true,
      message: `Item updated to ${status}. Master Order is '${updatedOrder.orderStatus}'.`,
      item,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Update Order Item Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. GET ALL ORDERS FOR CURRENT USER
export const getUserOrders = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });

    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await OrderItem.find({ order: order._id })
          .populate("product", "name title images image price")
          .populate("vendor", "name storeName email phone");

        const paymentDetails = await Payment.findOne({ order: order._id });

        return {
          ...order.toObject(),
          items,
          paymentDetails,
        };
      }),
    );

    return res.status(200).json({ success: true, orders: ordersWithItems });
  } catch (error) {
    console.error("Get User Orders Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve orders.",
      error: error.message,
    });
  }
};

// 6. GET SINGLE ORDER BY ID
export const getOrderById = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const order = await Order.findOne({ _id: req.params.id, user: userId });

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    const items = await OrderItem.find({ order: order._id })
      .populate("product", "name title images image price mrp discountPrice")
      .populate("vendor", "name storeName email phone");

    const paymentDetails = await Payment.findOne({ order: order._id });

    return res.status(200).json({
      success: true,
      order: {
        ...order.toObject(),
        items,
        paymentDetails,
      },
    });
  } catch (error) {
    console.error("Get Order By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order details.",
      error: error.message,
    });
  }
};

// 7. CANCEL A SPECIFIC ITEM (PARTIAL ORDER CANCELLATION)
export const cancelOrderItem = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { itemId } = req.params;

    const item = await OrderItem.findById(itemId);
    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: "Order item not found." });
    }

    const order = await Order.findOne({ _id: item.order, user: userId });
    if (!order) {
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized to cancel this item." });
    }

    if (
      ["shipped", "delivered", "cancelled"].includes(
        (item.status || "").toLowerCase(),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `This item is already ${item.status} and cannot be cancelled.`,
      });
    }

    item.status = "cancelled";
    await item.save();

    const productDoc = await Product.findById(item.product);
    if (productDoc) {
      const previousStock = Number(productDoc.stock ?? 0);
      const qtyToRestore = Number(item.quantity || 1);
      const newStock = previousStock + qtyToRestore;

      await Product.findByIdAndUpdate(productDoc._id, {
        $set: { stock: newStock },
      });

      try {
        if (InventoryLog) {
          await InventoryLog.create({
            product: productDoc._id,
            vendor: item.vendor || productDoc.vendor || userId,
            type: "add",
            quantity: qtyToRestore,
            previousStock,
            newStock,
            reason: "item_cancelled",
            referenceType: "order",
            referenceId: order._id,
            auditNote: `Restocked single item from Order #${order.orderNumber}`,
            adjustedBy: userId,
          });
        }
      } catch (logErr) {
        console.error("Restock log error:", logErr.message);
      }
    }

    const updatedOrder = await syncMasterOrderStatus(order._id);

    return res.status(200).json({
      success: true,
      message: "Item cancelled and inventory restored.",
      item,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Cancel Order Item Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 8. CANCEL FULL ORDER
export const cancelOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const order = await Order.findOne({ _id: req.params.id, user: userId });

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    if (
      !["placed", "confirmed", "pending"].includes(
        order.orderStatus.toLowerCase(),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled at this stage (current status: ${order.orderStatus}).`,
      });
    }

    order.orderStatus = "cancelled";
    order.cancelledAt = new Date();
    order.cancellationReason = req.body.reason || "Cancelled by customer";
    await order.save();

    await OrderItem.updateMany({ order: order._id }, { status: "cancelled" });

    const orderItems = await OrderItem.find({ order: order._id });

    for (const item of orderItems) {
      if (!item.product) continue;

      const productDoc = await Product.findById(item.product);
      if (!productDoc) continue;

      const previousStock = Number(productDoc.stock ?? 0);
      const qtyToRestore = Number(item.quantity || 1);
      const newStock = previousStock + qtyToRestore;

      await Product.findByIdAndUpdate(productDoc._id, {
        $set: { stock: newStock },
      });

      try {
        if (InventoryLog) {
          await InventoryLog.create({
            product: productDoc._id,
            vendor: item.vendor || productDoc.vendor || userId,
            type: "add",
            quantity: qtyToRestore,
            previousStock,
            newStock,
            reason: "order_cancelled",
            referenceType: "order",
            referenceId: order._id,
            auditNote: `Restocked after Order #${order.orderNumber} was cancelled`,
            adjustedBy: userId,
          });
        }
      } catch (logErr) {
        console.error(
          "Restock log creation error (non-fatal):",
          logErr.message,
        );
      }
    }

    await Payment.findOneAndUpdate(
      { order: order._id },
      {
        status: "failed",
        failureReason: `Order cancelled by customer at ${new Date().toISOString()}`,
      },
    );

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully. All vendor items were restocked.",
      order,
    });
  } catch (error) {
    console.error("Cancel Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel order.",
      error: error.message,
    });
  }
};
