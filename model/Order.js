import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["upi", "netbanking", "card", "cod"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "partially_paid", "failed", "refunded"],
      default: "pending",
    },
    orderStatus: {
      type: String,
      enum: [
        "placed",
        "confirmed",
        "processing",
        "partially_shipped",
        "shipped",
        "partially_delivered",
        "delivered",
        "cancelled",
      ],
      default: "placed",
    },
    shippingAddress: {
      fullName: {
        type: String,
        required: true,
      },
      phone: {
        type: String,
        required: true,
      },
      addressLine1: {
        type: String,
        required: true,
      },
      addressLine2: {
        type: String,
      },
      city: {
        type: String,
        required: true,
      },
      state: {
        type: String,
        required: true,
      },
      pincode: {
        type: String,
        required: true,
      },
      country: {
        type: String,
        default: "India",
      },
    },
    placedAt: {
      type: Date,
      default: Date.now,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: { 
      type: String, 
      default: null 
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Order", orderSchema);