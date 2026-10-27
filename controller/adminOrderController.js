import mongoose from "mongoose";
import Order from "../model/Order.js";
import OrderItem from "../model/OrderItem.js";

export const getAllAdminOrders = async (req, res) => {
  try {
    const { status, paymentStatus, page = 1, limit = 100 } = req.query;

    const query = {};

    // Filter by order status
    if (status && status !== "All") {
      query.orderStatus = status.toLowerCase();
    }

    // Filter by payment status
    if (paymentStatus && paymentStatus !== "All") {
      query.paymentStatus = paymentStatus.toLowerCase();
    }

    // 1. Fetch Orders (populating customer user)
    const orders = await Order.find(query)
      .populate("user", "firstName lastName email phone")
      .sort({ createdAt: -1 })
      .lean();

    if (!orders || orders.length === 0) {
      return res.status(200).json({
        success: true,
        orders: [],
        total: 0,
      });
    }

    // 2. Fetch all linked OrderItems for these orders in one single query
    const orderIds = orders.map((o) => o._id);
    let allItems = [];

    if (OrderItem) {
      allItems = await OrderItem.find({ order: { $in: orderIds } })
        .populate("product", "name images price discountPrice")
        .populate("vendor", "storeName firstName lastName email")
        .lean();
    }

    // 3. Attach order items to their corresponding parent orders
    const enrichedOrders = orders.map((order) => {
      // Find items from OrderItem collection
      const matchedItems = allItems.filter(
        (item) => String(item.order) === String(order._id),
      );

      // Support both separate OrderItem collection and embedded order.items
      const finalItems =
        matchedItems.length > 0 ? matchedItems : order.items || [];

      return {
        ...order,
        orderItems: finalItems,
        items: finalItems,
      };
    });

    return res.status(200).json({
      success: true,
      orders: enrichedOrders,
      total: enrichedOrders.length,
    });
  } catch (error) {
    console.error("Admin Get Orders Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin orders.",
      error: error.message,
    });
  }
};

export const updateAdminOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus, paymentStatus, trackingNumber } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    if (orderStatus) {
      order.orderStatus = orderStatus.toLowerCase();

      // Sync linked OrderItems in the OrderItem collection
      if (OrderItem) {
        await OrderItem.updateMany(
          { order: order._id },
          { $set: { itemStatus: orderStatus.toLowerCase() } },
        );
      }
    }

    if (paymentStatus) {
      order.paymentStatus = paymentStatus.toLowerCase();
    }

    if (trackingNumber) {
      order.trackingNumber = trackingNumber;
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Order #${order.orderNumber || order._id} status updated to ${order.orderStatus}.`,
      order,
    });
  } catch (error) {
    console.error("Admin Update Order Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update order status.",
      error: error.message,
    });
  }
};

export const getAdminOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if valid ObjectId or custom orderNumber string (e.g. ORD-172910)
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId
      ? { $or: [{ _id: id }, { orderNumber: id }] }
      : { orderNumber: id };
    const order = await Order.findOne(query)
      .populate("user", "firstName lastName email phone createdAt")
      .lean();
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found in database.",
      });
    }
    // Fetch linked items from OrderItem collection
    let items = [];
    if (OrderItem) {
      items = await OrderItem.find({ order: order._id })
        .populate("product", "name images price discountPrice sku description")
        .populate("vendor", "storeName firstName lastName email phone")
        .lean();
    }
    const finalItems = items.length > 0 ? items : order.items || [];
    return res.status(200).json({
      success: true,
      order: {
        ...order,
        orderItems: finalItems,
        items: finalItems,
      },
    });
  } catch (error) {
    console.error("Admin Get Order Details Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load order details.",
      error: error.message,
    });
  }
};
