import mongoose from "mongoose";

const vendorEarning = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    vendorOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorOrder",
      required: false,
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    earningStatus: {
      type: String,
      enum: ["available_for_payout", "paid_out"],
      default: "available_for_payout",
    },
    availableAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("VendorEarning", vendorEarning);