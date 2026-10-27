import mongoose from "mongoose";

const payout = new mongoose.Schema({
    payoutNumber: {
        type: String,
        required: true,
        unique: true
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VendorProfile',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    payoutMethod: {
        type: String,
        enum: ['bank_transfer', 'upi'],
        required: true
    },
    paymentReference: {
        type: String,
        required: true
    },
    earnings: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VendorEarning',
        required: true
    }],

    status: {
        type: String,
        enum: ['processing', 'completed', 'failed'],
        default: 'processing'
    },
    periodStart: {
        type: Date,
        required: true
    },
    periodEnd: {
        type: Date,
        required: true
    },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    paidAt: {
        type: Date
    },
    adminNote: {
        type: String
    }
}, {
    timestamps: true
});

export default mongoose.model('Payout', payout);
