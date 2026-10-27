import mongoose from "mongoose";

const vendorOrder = new mongoose.Schema({
    vendorOrderNumber: {
        type: String,
        required: true,
        unique: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VendorProfile',
        required: true
    },

    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    commissionAmount: {
        type: Number,
        required: true,
        min: 0
    },
    vendorEarning: {
        type: Number,
        required: true,
        min: 0
    },

    status: {
        type: String,
        enum: ['placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
        default: 'placed'
    },

    shippedAt: {
        type: Date
    },
    deliveredAt: {
        type: Date
    },
    cancelledAt: {
        type: Date
    }
}, {
    timestamps: true
});

export default mongoose.model('VendorOrder', vendorOrder);
