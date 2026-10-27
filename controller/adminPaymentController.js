import Payment from "../model/Payment.js";
import Order from "../model/Order.js";
import OrderItem from "../model/OrderItem.js";
import User from "../model/User.js";
import mongoose from "mongoose";

// Helper: Normalize payment status to UI representation
const normalizeStatus = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "success" || s === "paid") return "Paid";
  if (s === "refunded") return "Refunded";
  if (s === "failed") return "Failed";
  return "Pending";
};

// Helper: Format date
const formatDate = (date) => {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

export const getAllAdminPayments = async (req, res) => {
  try {
    // 1. Fetch all Payment documents
    const paymentDocs = await Payment.find()
      .populate("user", "firstName lastName email phone")
      .populate(
        "order",
        "orderNumber totalAmount paymentMethod paymentStatus subtotal deliveryCharge discountAmount placedAt createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    // 2. Also retrieve orders that might not have a separate Payment doc yet (e.g. COD or legacy orders)
    const orderDocIdsWithPayment = new Set(
      paymentDocs.map((p) => p.order?._id?.toString()).filter(Boolean),
    );

    const standaloneOrders = await Order.find({
      _id: { $nin: Array.from(orderDocIdsWithPayment) },
    })
      .populate("user", "firstName lastName email phone")
      .sort({ createdAt: -1 })
      .lean();

    // 3. Format Payment records
    const formattedPayments = [];

    // Add records from Payment model
    for (const p of paymentDocs) {
      const order = p.order || {};
      const user = p.user || {};

      formattedPayments.push({
        id: p._id.toString(),
        paymentDocId: p._id.toString(),
        orderId: order.orderNumber || order._id?.toString() || "N/A",
        orderDocId: order._id?.toString() || null,
        transactionId:
          p.transactionId ||
          p.razorpayPaymentId ||
          `TXN-${p._id.toString().slice(-6).toUpperCase()}`,
        gateway: p.razorpayPaymentId
          ? "Razorpay"
          : p.paymentMethod === "cod"
            ? "Cash On Delivery"
            : "Manual / Direct",
        amount: Number(p.amount || order.totalAmount || 0),
        currency: p.currency || "INR",
        method: (
          p.paymentMethod ||
          order.paymentMethod ||
          "online"
        ).toUpperCase(),
        status: normalizeStatus(p.status || order.paymentStatus),
        date: formatDate(p.paidAt || p.createdAt),
        createdAt: p.createdAt,
        customer: {
          name:
            `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
            user.email ||
            "Customer",
          email: user.email || "—",
          phone: user.phone || "—",
        },
      });
    }

    // Add records synthesized from Order model
    for (const ord of standaloneOrders) {
      const user = ord.user || {};
      formattedPayments.push({
        id: ord._id.toString(),
        paymentDocId: null,
        orderId: ord.orderNumber || ord._id.toString(),
        orderDocId: ord._id.toString(),
        transactionId: `ORD-${ord._id.toString().slice(-6).toUpperCase()}`,
        gateway:
          ord.paymentMethod === "cod" ? "Cash On Delivery" : "Online Gateway",
        amount: Number(ord.totalAmount || 0),
        currency: "INR",
        method: String(ord.paymentMethod || "online").toUpperCase(),
        status: normalizeStatus(ord.paymentStatus),
        date: formatDate(ord.placedAt || ord.createdAt),
        createdAt: ord.createdAt,
        customer: {
          name:
            `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
            user.email ||
            "Customer",
          email: user.email || "—",
          phone: user.phone || "—",
        },
      });
    }

    // Sort by latest created
    formattedPayments.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    // Calculate live aggregated totals
    const totalProcessed = formattedPayments.reduce(
      (sum, p) => sum + p.amount,
      0,
    );
    const paidAmount = formattedPayments
      .filter((p) => p.status === "Paid")
      .reduce((sum, p) => sum + p.amount, 0);
    const pendingAmount = formattedPayments
      .filter((p) => p.status === "Pending")
      .reduce((sum, p) => sum + p.amount, 0);
    const refundedAmount = formattedPayments
      .filter((p) => p.status === "Refunded")
      .reduce((sum, p) => sum + p.amount, 0);

    return res.status(200).json({
      success: true,
      count: formattedPayments.length,
      metrics: {
        totalProcessed,
        paidAmount,
        pendingAmount,
        refundedAmount,
      },
      payments: formattedPayments,
    });
  } catch (error) {
    console.error("Get All Admin Payments Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve payments from database.",
      error: error.message,
    });
  }
};

export const getAdminPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    let paymentDoc = null;
    let orderDoc = null;

    // 1. Search in Payment collection by _id or transactionId
    if (mongoose.Types.ObjectId.isValid(id)) {
      paymentDoc = await Payment.findById(id)
        .populate("user", "firstName lastName email phone")
        .populate("order")
        .lean();
    }

    if (!paymentDoc) {
      paymentDoc = await Payment.findOne({
        $or: [
          { transactionId: id },
          { razorpayPaymentId: id },
          { razorpayOrderId: id },
        ],
      })
        .populate("user", "firstName lastName email phone")
        .populate("order")
        .lean();
    }

    // If order was referenced
    if (paymentDoc?.order) {
      orderDoc = paymentDoc.order;
    } else if (mongoose.Types.ObjectId.isValid(id)) {
      // Check if ID was an Order ID
      orderDoc = await Order.findById(id)
        .populate("user", "firstName lastName email phone")
        .lean();
    }

    if (!paymentDoc && !orderDoc) {
      return res.status(404).json({
        success: false,
        message: "Payment transaction record not found.",
      });
    }

    // Resolve Customer
    const user = paymentDoc?.user || orderDoc?.user || {};
    const shipping = orderDoc?.shippingAddress || {};

    // 2. Fetch Order Items & Vendors for Settlement breakdown
    let vendorNames = [];
    let subtotal = orderDoc?.subtotal || paymentDoc?.amount || 0;
    let shippingFee = orderDoc?.deliveryCharge || 0;
    let discount = orderDoc?.discountAmount || 0;
    let totalAmount = paymentDoc?.amount || orderDoc?.totalAmount || 0;

    if (orderDoc?._id) {
      const items = await OrderItem.find({ order: orderDoc._id })
        .populate("vendor", "storeName businessName")
        .lean();

      items.forEach((it) => {
        const vName = it.vendor?.storeName || it.vendor?.businessName;
        if (vName && !vendorNames.includes(vName)) {
          vendorNames.push(vName);
        }
      });
    }

    // Standard platform commission model: 10% Platform fee, 90% Vendor payout
    const commission = Math.round(totalAmount * 0.02);
    const vendorPayout = totalAmount - commission;

    const rawStatus =
      paymentDoc?.status || orderDoc?.paymentStatus || "pending";
    const status = normalizeStatus(rawStatus);

    const paymentDetails = {
      id: paymentDoc?._id?.toString() || orderDoc?._id?.toString(),
      paymentDocId: paymentDoc?._id?.toString() || null,
      orderId: orderDoc?.orderNumber || orderDoc?._id?.toString() || "N/A",
      orderDocId: orderDoc?._id?.toString() || null,
      transactionId:
        paymentDoc?.transactionId ||
        paymentDoc?.razorpayPaymentId ||
        `TXN-${(paymentDoc?._id || orderDoc?._id).toString().slice(-6).toUpperCase()}`,
      gateway: paymentDoc?.razorpayPaymentId
        ? "Razorpay Payment Gateway"
        : paymentDoc?.paymentMethod === "cod" ||
            orderDoc?.paymentMethod === "cod"
          ? "Cash On Delivery"
          : "Direct Online Settlement",
      razorpayOrderId: paymentDoc?.razorpayOrderId || null,
      razorpayPaymentId: paymentDoc?.razorpayPaymentId || null,
      method: (
        paymentDoc?.paymentMethod ||
        orderDoc?.paymentMethod ||
        "online"
      ).toUpperCase(),
      currency: paymentDoc?.currency || "INR",
      amount: totalAmount,
      subtotal: subtotal,
      shipping: shippingFee,
      discount: discount,
      tax: 0,
      status: status,
      date: formatDate(
        paymentDoc?.paidAt ||
          paymentDoc?.createdAt ||
          orderDoc?.placedAt ||
          orderDoc?.createdAt,
      ),
      vendor:
        vendorNames.length > 0
          ? vendorNames.join(", ")
          : "SmartCommerce Marketplace",
      commission: commission,
      vendorPayout: vendorPayout,
      customer: {
        name:
          shipping.fullName ||
          `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
          "Customer",
        email: user.email || shipping.email || "—",
        phone: shipping.phone || user.phone || "—",
        address: [
          shipping.addressLine1,
          shipping.city,
          shipping.state,
          shipping.pincode,
        ]
          .filter(Boolean)
          .join(", "),
      },
      refund:
        status === "Refunded"
          ? {
              amount: totalAmount,
              status: "Completed",
              reason:
                paymentDoc?.failureReason ||
                "Order cancellation / Customer dispute resolved.",
            }
          : null,
    };

    return res.status(200).json({
      success: true,
      payment: paymentDetails,
    });
  } catch (error) {
    console.error("Get Admin Payment By Id Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment details.",
      error: error.message,
    });
  }
};

export const updateAdminPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, transactionId, adminNote, refundReason, refundAmount } =
      req.body;

    const dbStatusMap = {
      Paid: "success",
      Pending: "pending",
      Failed: "failed",
      Refunded: "refunded",
    };

    const targetDbStatus = dbStatusMap[status] || status.toLowerCase();

    // 1. Update Payment doc if exists
    let payment = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      payment = await Payment.findById(id);
    }

    if (payment) {
      payment.status = targetDbStatus;
      if (transactionId) payment.transactionId = transactionId;
      if (refundReason) payment.failureReason = refundReason;
      if (targetDbStatus === "success" && !payment.paidAt)
        payment.paidAt = new Date();
      await payment.save();

      // Sync with Order
      if (payment.order) {
        await Order.findByIdAndUpdate(payment.order, {
          paymentStatus: targetDbStatus === "success" ? "paid" : targetDbStatus,
        });
      }
    } else if (mongoose.Types.ObjectId.isValid(id)) {
      // ID was an Order ID
      const order = await Order.findById(id);
      if (order) {
        order.paymentStatus =
          targetDbStatus === "success" ? "paid" : targetDbStatus;
        await order.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${status}.`,
    });
  } catch (error) {
    console.error("Update Admin Payment Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update payment.",
      error: error.message,
    });
  }
};
