import User from "../model/User.js";
import Order from "../model/Order.js";
import ContactMessage from "../model/ContactMessage.js";
import { sendEmail } from "../utils/sendEmail.js";

// Helper function to format date
const formatDate = (date) => {
  if (!date) return "Recently";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(date));
};

export const getAdminCustomers = async (req, res) => {
  try {
    // 1. Fetch all users whose role is 'customer'
    const users = await User.find({ role: "customer" })
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    const userIds = users.map((u) => u._id);

    // 2. Aggregate Live Orders & Total Spent from Order collection
    const orderStats = await Order.aggregate([
      {
        $match: {
          user: { $in: userIds },
        },
      },
      {
        $group: {
          _id: "$user",
          totalOrders: { $sum: 1 },
          // Sum totalAmount excluding cancelled orders
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ["$orderStatus", "cancelled"] },
                0,
                { $ifNull: ["$totalAmount", 0] },
              ],
            },
          },
          lastOrderDate: { $max: "$createdAt" },
        },
      },
    ]);

    // Fast lookup map by User ID
    const statsMap = new Map();
    orderStats.forEach((stat) => {
      if (stat._id) {
        statsMap.set(stat._id.toString(), {
          orders: stat.totalOrders || 0,
          totalSpent: Number(stat.totalSpent || 0),
          lastOrderDate: stat.lastOrderDate,
        });
      }
    });

    // 3. Format customer objects for the admin dashboard
    const formattedCustomers = users.map((user) => {
      const isInactive =
        user.accountStatus === "inactive" ||
        user.accountStatus === "suspended" ||
        user.accountStatus === "blocked";

      const userStat = statsMap.get(user._id.toString()) || {
        orders: 0,
        totalSpent: 0,
        lastOrderDate: null,
      };

      return {
        id: user._id,
        _id: user._id,
        name:
          `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "—",
        status: isInactive ? "Inactive" : "Active",
        orders: userStat.orders,
        totalSpent: userStat.totalSpent,
        lastOrderDate: userStat.lastOrderDate
          ? formatDate(userStat.lastOrderDate)
          : "—",
        joined: formatDate(user.createdAt),
        addresses: user.addresses || [],
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedCustomers.length,
      customers: formattedCustomers,
    });
  } catch (error) {
    console.error("getAdminCustomers error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error: Unable to retrieve customers.",
      error: error.message,
    });
  }
};

export const getCustomerById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password").lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found." });
    }

    // Fetch this customer's actual orders
    const orders = await Order.find({ user: user._id })
      .sort({ createdAt: -1 })
      .lean();

    const totalSpent = orders.reduce((sum, ord) => {
      return ord.orderStatus !== "cancelled"
        ? sum + Number(ord.totalAmount || 0)
        : sum;
    }, 0);

    const isInactive =
      user.accountStatus === "inactive" ||
      user.accountStatus === "suspended" ||
      user.accountStatus === "blocked";

    return res.status(200).json({
      success: true,
      customer: {
        id: user._id,
        _id: user._id,
        name:
          `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "—",
        status: isInactive ? "Inactive" : "Active",
        orders: orders.length,
        totalSpent: totalSpent,
        joined: formatDate(user.createdAt),
        addresses: user.addresses || [],
        recentOrders: orders.slice(0, 10).map((ord) => ({
          id:
            ord.orderNumber || `#${ord._id.toString().slice(-6).toUpperCase()}`,
          orderDocId: ord._id,
          amount: ord.totalAmount || 0,
          status: ord.orderStatus || "placed",
          paymentMethod: ord.paymentMethod || "Online",
          paymentStatus: ord.paymentStatus || "pending",
          date: formatDate(ord.placedAt || ord.createdAt),
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCustomerStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const accountStatus = status === "Inactive" ? "inactive" : "active";

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { accountStatus },
      { new: true },
    ).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found." });
    }

    return res.status(200).json({
      success: true,
      message: `Customer marked as ${status}.`,
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getContactMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Get Contact Messages Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch contact messages.",
      error: error.message,
    });
  }
};

export const replyContactMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { replyText, adminNote } = req.body;
    if (!replyText || !replyText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply text is required.",
      });
    }
    const contactMsg = await ContactMessage.findById(messageId);
    if (!contactMsg) {
      return res.status(404).json({
        success: false,
        message: "Contact message record not found.",
      });
    }
    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #0f172a; padding: 20px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 22px;">SmartCommerce Support</h1>
        </div>
        <div style="padding: 24px;">
          <p>Hello <strong>${contactMsg.name}</strong>,</p>
          <p>Thank you for reaching out to SmartCommerce. Here is our response regarding your enquiry for <strong>${contactMsg.subject}</strong>${contactMsg.orderId ? ` (Order ID: ${contactMsg.orderId})` : ""}:</p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid #0f172a; padding: 16px; margin: 20px 0; border-radius: 6px;">
            <p style="margin: 0; white-space: pre-line; color: #1e293b;">${replyText.trim()}</p>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          
          <p style="font-size: 12px; color: #777; margin-bottom: 4px;">Your original enquiry:</p>
          <blockquote style="font-size: 13px; color: #555; margin: 0; padding-left: 12px; border-left: 2px solid #ccc; font-style: italic;">
            "${contactMsg.message}"
          </blockquote>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #64748b;">
          &copy; ${new Date().getFullYear()} SmartCommerce Platform. All rights reserved.
        </div>
      </div>
    `;
    // Send using unified email sender
    await sendEmail({
      email: contactMsg.email,
      subject: `Re: [${contactMsg.subject.toUpperCase()}] Support Response - SmartCommerce`,
      htmlMessage,
    });
    contactMsg.status = "resolved";
    contactMsg.adminNote = adminNote || replyText;
    contactMsg.respondedAt = new Date();
    await contactMsg.save();
    return res.status(200).json({
      success: true,
      message: `Reply email sent successfully to ${contactMsg.email}`,
      data: contactMsg,
    });
  } catch (error) {
    console.error("Reply Contact Message Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send email reply.",
      error: error.message,
    });
  }
};
