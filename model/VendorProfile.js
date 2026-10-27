import mongoose from "mongoose";

const vendorProfile = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true,
    },
    storeName: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    storeDescription: {
        type: String
    },
    storeLogo: {
        type: String
    },
    categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category"
    }],
    website: {
        type: String
    },

    businessAddress: {
        addressLine1: {
            type: String,
            required: true
        },
        addressLine2: {
            type: String
        },
        city: {
            type: String,
            required: true
        },
        state: {
            type: String,
            required: true
        },
        pincode: {
            type: String,
            required: true
        },
        country: {
            type: String,
            default: "India"
        },
    },

    businessType: {
        type: String,
        required: true
    },
    panNumber: {
        type: String,
        required: true,
        uppercase: true
    },
    gstNumber: {
        type: String,
        uppercase: true
    },

    bankDetails: {
        accountHolderName: {
            type: String,
            required: true
        },
        bankName: {
            type: String,
            required: true
        },
        accountNumber: {
            type: String,
            required: true
        },
        ifscCode: {
            type: String,
            required: true,
            uppercase: true
        },
    },

    businessStatus: {
        type: String,
        enum: ["accepting_orders", "vacation_mode"],
        default: "accepting_orders",
    },
    status: {
        type: String,
        enum: ["pending", "approved", "rejected", "suspended"],
        default: "pending",
    },
}, {
    timestamps: true
}, );

export default mongoose.model('VendorProfile', vendorProfile);