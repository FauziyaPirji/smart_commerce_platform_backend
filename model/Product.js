import mongoose from "mongoose";

const product = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    shortDescription: {
      type: String,
      required: true,
    },
    longDescription: {
      type: String,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPrice: {
      type: Number,
      min: 0,
      validate: {
        validator: function (val) {
          return !val || val <= this.price;
        },
        message:
          "Discount price ({VALUE}) cannot be greater than original price!",
      },
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    lowStockAlert: {
      type: Number,
      default: 5,
    },
    images: [
      {
        type: String,
      },
    ],
    image: {
      type: String,
      required: false
    },
    specifications: [
      {
        name: {
          type: String,
          required: true,
        },
        value: {
          type: String,
          required: true,
        },
        isKeyFeature: {
          type: Boolean,
          default: false,
        },
      },
    ],

    productTags: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Product", product);
