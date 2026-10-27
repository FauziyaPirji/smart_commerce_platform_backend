import mongoose from "mongoose";

const contactMessage = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String
    },
    subject: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    // OPTIONAL ORDER REFERENCE (MongoDB ObjectId)
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
    },
    // OPTIONAL ORDER NUMBER (Human readable ID like "SC-12345678")
    orderNumber: {
      type: String,
      trim: true,
      required: false,
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'resolved'],
        default: 'pending'
    },
    adminNote: {
        type: String
    },
    respondedAt: {
        type: Date
    }
}, {
    timestamps: true
});

export default mongoose.model('ContactMessage', contactMessage);
