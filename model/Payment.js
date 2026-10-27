import mongoose from "mongoose";

const payment = new mongoose.Schema({
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ["online", "upi", "card", "netbanking", "cod", "wallet"],
        default: "online",
        required: true,
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    currency: { 
        type: String, 
        default: "INR" 
    },
    status: {
      type: String,
      enum: ["pending", "created", "success", "failed", "refunded"],
      default: "pending",
    },
    // Razorpay payment gateway fields
    razorpayOrderId: { 
        type: String, 
        default: null 
    },
    razorpayPaymentId: { 
        type: String, 
        default: null 
    },
    razorpaySignature: { 
        type: String, 
        default: null 
    },
    // Generic reference (used for COD or manual records)
    transactionId: { 
        type: String, 
        default: null 
    },
    failureReason: { 
        type: String, 
        default: null 
    },
    paidAt: { 
        type: Date, 
        default: null 
    },
  },
  { timestamps: true }
);

export default mongoose.model('Payment', payment);
