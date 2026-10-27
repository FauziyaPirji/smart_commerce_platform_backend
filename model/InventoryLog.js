import mongoose from "mongoose";

const inventoryLog = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VendorProfile',
        required: true
    },
    type: {
        type: String,
        enum: ['add', 'subtract'],
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    previousStock: {
        type: Number,
        required: true,
        min: 0
    },
    newStock: {
        type: Number,
        required: true,
        min: 0
    },
    reason: {
        type: String,
        enum: ['restock', 'damaged', 'expired', 'lost', 'returned', 'manual_adjustment', 'order_placed', 'order_cancelled', 'other'],
        required: true
    },
    // AUDIT LINK: Trace back to order or refund document
    referenceType: {
        type: String,
        enum: ['order', 'manual', 'restock']
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },

    auditNote: {
        type: String,
        trim: true,
        default: "",
    },
    adjustedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

export default mongoose.model('InventoryLog', inventoryLog);
