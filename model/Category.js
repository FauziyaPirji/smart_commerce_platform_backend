import mongoose from "mongoose";

const category = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    description: {
        type: String
    },
    image: {
        type: String
    },
    isActive: {
        type: Boolean,
        default: true
    },
}, {
    timestamps: true
});

export default mongoose.model('Category', category);
