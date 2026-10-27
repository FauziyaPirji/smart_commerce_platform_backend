import mongoose from "mongoose";
import Payout from "../model/Payout.js";
import VendorProfile from "../model/VendorProfile.js";
import VendorOrder from "../model/VendorOrder.js";
import OrderItem from "../model/OrderItem.js";
import VendorEarning from "../model/VendorEarning.js";

export const getAdminPayouts = async (req, res) => {
  try {
    // 1. Fetch ALL Registered Vendors from database
    const allVendors = await VendorProfile.find()
      .populate("user", "name email phone firstName lastName")
      .lean();
    // 2. Fetch recorded Payouts
    const payouts = await Payout.find()
      .populate({
        path: "vendor",
        populate: { path: "user", select: "name email phone" },
      })
      .populate("processedBy", "name email")
      .sort({ createdAt: -1 });
    // 3. Fetch all Vendor Earnings
    const allEarnings = await VendorEarning.find().lean();
    // 4. Also fetch fulfilled OrderItems as backup for sales calculations
    const fulfilledItems = await OrderItem.find({
      status: { $nin: ["cancelled", "refunded"] },
    }).lean();
    // 5. Initialize vendorMap with EVERY registered vendor in the database
    const vendorMap = {};
    allVendors.forEach((v) => {
      const vId = v._id.toString();
      const storeName =
        v.storeName ||
        (v.user
          ? `${v.user.firstName || ""} ${v.user.lastName || ""}`.trim() ||
            v.user.name
          : "") ||
        "Vendor Store";
      vendorMap[vId] = {
        id: `SET-${vId.slice(-6).toUpperCase()}`,
        vendorId: vId,
        vendor: {
          name: storeName,
          storeName: storeName,
          email: v.user?.email || "—",
          phone: v.user?.phone || "—",
          initials: storeName.slice(0, 2).toUpperCase(),
          bankDetails: v.bankDetails || {},
        },
        grossSales: 0,
        commission: 0,
        netPayable: 0,
        paidAmount: 0,
        pendingAmount: 0,
        month: new Date().toLocaleDateString("en-IN", {
          month: "long",
          year: "numeric",
        }),
        status: "Pending",
      };
    });
    // 6. Accumulate from VendorEarnings
    allEarnings.forEach((e) => {
      const vId = e.vendor?.toString();
      if (vendorMap[vId]) {
        const gross = Number(e.grossAmount || 0);
        const comm = Number(e.commissionAmount || Math.round(gross * 0.02));
        const net = Number(e.netAmount || gross - comm);
        vendorMap[vId].grossSales += gross;
        vendorMap[vId].commission += comm;
        vendorMap[vId].netPayable += net;
      }
    });
    // 7. If no VendorEarnings yet, accumulate from OrderItems
    if (allEarnings.length === 0) {
      fulfilledItems.forEach((item) => {
        const vId = item.vendor?.toString();
        if (vendorMap[vId]) {
          const itemSubtotal = Number(
            item.subtotal || item.unitPrice * item.quantity || 0,
          );
          const comm = Math.round(itemSubtotal * 0.02);
          const net = itemSubtotal - comm;
          vendorMap[vId].grossSales += itemSubtotal;
          vendorMap[vId].commission += comm;
          vendorMap[vId].netPayable += net;
        }
      });
    }
    // 8. Deduct completed payouts
    payouts.forEach((p) => {
      const vId = p.vendor?._id?.toString() || p.vendor?.toString();
      if (vendorMap[vId] && (p.status === "completed" || p.status === "Paid")) {
        vendorMap[vId].paidAmount += Number(p.amount || 0);
      }
    });
    // 9. Calculate final pending amounts per vendor
    Object.values(vendorMap).forEach((item) => {
      item.pendingAmount = Math.max(item.netPayable - item.paidAmount, 0);
      item.status =
        item.pendingAmount === 0 && item.paidAmount > 0
          ? "Paid"
          : item.paidAmount > 0
            ? "Partial"
            : "Pending";
    });
    // 10. Format recorded payout history
    const formattedPayouts = payouts.map((p) => ({
      id: p._id.toString(),
      payoutNumber: p.payoutNumber,
      vendorId: p.vendor?._id?.toString(),
      vendor: {
        name: p.vendor?.storeName || p.vendor?.user?.name || "Vendor",
        email: p.vendor?.user?.email || "—",
        storeName: p.vendor?.storeName || "Vendor Store",
        initials: (p.vendor?.storeName || "V").slice(0, 2).toUpperCase(),
        bankDetails: p.vendor?.bankDetails || {},
      },
      month: new Date(p.periodStart || p.createdAt).toLocaleDateString(
        "en-IN",
        {
          month: "long",
          year: "numeric",
        },
      ),
      grossSales: Number(p.amount || 0) * 1.0204,
      commission: Number(p.amount || 0) * 0.0204,
      netPayable: Number(p.amount || 0),
      paidAmount: p.status === "completed" ? Number(p.amount || 0) : 0,
      pendingAmount: p.status !== "completed" ? Number(p.amount || 0) : 0,
      amount: Number(p.amount || 0),
      payoutMethod: p.payoutMethod === "upi" ? "UPI" : "Bank Transfer",
      paymentReference: p.paymentReference,
      status: p.status === "completed" ? "Paid" : "Processing",
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      adminNote: p.adminNote,
    }));
    const vendorsSummaryList = Object.values(vendorMap);
    return res.status(200).json({
      success: true,
      payouts: formattedPayouts,
      vendorsSummary: vendorsSummaryList,
      summary: {
        sales: vendorsSummaryList.reduce((sum, v) => sum + v.grossSales, 0),
        commission: vendorsSummaryList.reduce(
          (sum, v) => sum + v.commission,
          0,
        ),
        payable: vendorsSummaryList.reduce((sum, v) => sum + v.netPayable, 0),
        paid: vendorsSummaryList.reduce((sum, v) => sum + v.paidAmount, 0),
        pending: vendorsSummaryList.reduce(
          (sum, v) => sum + v.pendingAmount,
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Error in getAdminPayouts:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve vendor payouts from server",
    });
  }
};

export const getAdminPayoutById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ID is a Payout ObjectId
    let payout = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      payout = await Payout.findById(id)
        .populate({
          path: "vendor",
          populate: { path: "user", select: "name email phone" },
        })
        .populate("earnings")
        .populate("processedBy", "name email");
    }

    if (!payout) {
      // Check if it's a vendorId settlement reference
      const vendor = await VendorProfile.findById(
        id.replace("SET-", ""),
      ).populate("user", "name email phone");

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Payout record not found",
        });
      }

      // Compute on-the-fly settlement for this vendor
      const vendorOrders = await VendorOrder.find({
        vendor: vendor._id,
        status: { $nin: ["cancelled", "refunded"] },
      });

      const grossSales = vendorOrders.reduce(
        (sum, o) => sum + (o.subtotal || 0),
        0,
      );
      const commission = vendorOrders.reduce(
        (sum, o) => sum + (o.commissionAmount || 0),
        0,
      );
      const netPayable = grossSales - commission;

      return res.status(200).json({
        success: true,
        payout: {
          id: `SET-${vendor._id.toString().slice(-6).toUpperCase()}`,
          vendorId: vendor._id.toString(),
          vendor: {
            name: vendor.storeName || vendor.user?.name,
            email: vendor.user?.email,
            phone: vendor.user?.phone,
            storeName: vendor.storeName,
            bankDetails: vendor.bankDetails || {},
          },
          month: new Date().toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          }),
          grossSales,
          commission,
          netPayable,
          paidAmount: 0,
          pendingAmount: netPayable,
          status: "Pending",
          payoutHistory: [],
        },
      });
    }

    return res.status(200).json({
      success: true,
      payout: {
        id: payout._id.toString(),
        payoutNumber: payout.payoutNumber,
        vendorId: payout.vendor?._id?.toString(),
        vendor: {
          name: payout.vendor?.storeName || payout.vendor?.user?.name,
          email: payout.vendor?.user?.email,
          phone: payout.vendor?.user?.phone,
          storeName: payout.vendor?.storeName,
          bankDetails: payout.vendor?.bankDetails || {},
        },
        amount: payout.amount,
        payoutMethod: payout.payoutMethod === "upi" ? "UPI" : "Bank Transfer",
        paymentReference: payout.paymentReference,
        status: payout.status === "completed" ? "Paid" : "Processing",
        periodStart: payout.periodStart,
        periodEnd: payout.periodEnd,
        paidAt: payout.paidAt || payout.createdAt,
        adminNote: payout.adminNote,
        grossSales: Number(payout.amount) * 1.0204,
        commission: Number(payout.amount) * 0.0204,
        netPayable: payout.amount,
        paidAmount: payout.status === "completed" ? payout.amount : 0,
        pendingAmount: payout.status !== "completed" ? payout.amount : 0,
        payoutHistory: [
          {
            id: payout.payoutNumber,
            date: new Date(
              payout.paidAt || payout.createdAt,
            ).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
            amount: payout.amount,
            method: payout.payoutMethod === "upi" ? "UPI" : "Bank Transfer",
            transactionId: payout.paymentReference,
            status: payout.status === "completed" ? "Paid" : "Processing",
            note: payout.adminNote || "Direct disbursement",
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error in getAdminPayoutById:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching payout details",
    });
  }
};

export const createAdminPayout = async (req, res) => {
  try {
    const {
      vendorId,
      amount,
      payoutMethod,
      paymentReference,
      adminNote,
      periodStart,
      periodEnd,
    } = req.body;
    if (!vendorId || !amount || !paymentReference) {
      return res.status(400).json({
        success: false,
        message: "Vendor ID, payout amount, and payment reference are required",
      });
    }
    // Resolve Vendor Profile
    let vendor = await VendorProfile.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(vendorId) ? vendorId : null },
        { user: mongoose.Types.ObjectId.isValid(vendorId) ? vendorId : null },
      ].filter(Boolean),
    });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }
    const payoutNumber = `PAY-${Date.now().toString().slice(-6)}`;
    const newPayout = new Payout({
      payoutNumber,
      vendor: vendor._id,
      amount: Number(amount),
      payoutMethod: payoutMethod?.toLowerCase().includes("upi")
        ? "upi"
        : "bank_transfer",
      paymentReference,
      status: "completed",
      periodStart: periodStart
        ? new Date(periodStart)
        : new Date(Date.now() - 30 * 86400000),
      periodEnd: periodEnd ? new Date(periodEnd) : new Date(),
      processedBy: req.user?._id || null,
      paidAt: new Date(),
      adminNote: adminNote || "Settlement disbursed successfully",
      earnings: [],
    });
    await newPayout.save();
    // Mark vendor earnings as paid_out
    await VendorEarning.updateMany(
      { vendor: vendor._id, earningStatus: "available_for_payout" },
      { $set: { earningStatus: "paid_out" } },
    );
    return res.status(201).json({
      success: true,
      message: "Payout created and disbursed successfully",
      payout: newPayout,
    });
  } catch (error) {
    console.error("Error in createAdminPayout:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create payout record",
    });
  }
};
