import mongoose from "mongoose";

const address = new mongoose.Schema({
    fullName: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
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
        default: 'India'
    },
    addressType: {
        type: String,
        enum: ['home', 'work', 'other'],
        default: 'home'
    },
    isDefault: {
        type: Boolean,
        default: false
    }
});

const user = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    middleName: {
        type: String,
        trim: true
    },
    lastName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other', 'prefer_not_to_say'],
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        required: true
    },
    dob: {
        type: Date
    },
    profilePhoto: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['customer', 'vendor', 'admin'],
        default: 'customer',
        index: true
    },
    accountStatus: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    twoFactorOtp: {
      type: String,
      default: null,
    },
    twoFactorExpires: {
      type: Date,
      default: null,
    },
    addresses: [address]
}, {
    timestamps: true,
    collection: 'userdata'
});

export default mongoose.model('User', user);
