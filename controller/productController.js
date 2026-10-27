import Product from "../model/Product.js";
import Category from "../model/Category.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";

const uploadToCloudinary = (buffer, folder = "smartcommerce_products") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    stream.end(buffer);
  });
};

export const createProduct = async (req, res) => {
  try {
    const {
      name,
      slug,
      category,
      categoryName,
      subcategory,
      price,
      mrp,
      stock,
      lowStockLimit,
      shortDescription,
      description,
      longDescription,
      specifications,
      productTags,
      status,
      vendor,
    } = req.body;
    // Validation (sku removed from requirement)
    if (!name || !price || !shortDescription) {
      return res.status(400).json({
        success: false,
        message:
          "Please fill all required fields: name, price, and short description.",
      });
    }
    // Ensure unique slug
    let finalSlug = slug;
    if (!finalSlug) {
      finalSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    }
    const slugExists = await Product.findOne({ slug: finalSlug });
    if (slugExists) {
      finalSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
    }
    let validVendorId = null;
    if (vendor && mongoose.Types.ObjectId.isValid(vendor)) {
      validVendorId = vendor;
    }
    let validCategoryId = null;
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      validCategoryId = category;
    }

    let imageUrls = [];
    // Case A: Single file uploaded (req.file)
    if (req.file && req.file.buffer) {
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      imageUrls.push(uploadResult.secure_url);
    }
    // Case B: Multiple files uploaded (req.files)
    else if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const uploadPromises = req.files.map((file) =>
        uploadToCloudinary(file.buffer),
      );
      const results = await Promise.all(uploadPromises);
      imageUrls = results.map((res) => res.secure_url);
    }
    // Case C: Fallback to existing image URLs passed as text
    else if (req.body.images) {
      imageUrls = Array.isArray(req.body.images)
        ? req.body.images
        : [req.body.images];
    } else if (req.body.image) {
      imageUrls = [req.body.image];
    }

    // Create product instance
    const newProduct = new Product({
      name,
      slug: finalSlug,
      vendor: validVendorId,
      category: validCategoryId,
      subcategory: subcategory ? subcategory.trim() : "",
      price: Number(mrp),
      discountPrice: Number(price),
      stock: Number(stock || 0),
      lowStockAlert: Number(lowStockLimit || 5),
      shortDescription,
      longDescription: description || longDescription || shortDescription,
      specifications: Array.isArray(specifications) ? specifications : [],
      productTags: Array.isArray(productTags) ? productTags : [],
      isActive: status === "Active",
      images: imageUrls,
      image: imageUrls[0] || "",
    });
    await newProduct.save();
    return res.status(201).json({
      success: true,
      message: "Product created successfully!",
      product: newProduct,
    });
  } catch (error) {
    console.error("createProduct error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create product.",
      error: error.message,
    });
  }
};

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find({})
      .populate("category", "name slug")
      .populate("vendor", "firstName lastName email storeName")
      .sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
      error: error.message,
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    let product;
    // Check if ID is valid ObjectId, otherwise search by slug
    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id)
        .populate("category", "name slug")
        .populate("vendor", "firstName lastName email storeName");
    } else {
      product = await Product.findOne({ slug: id })
        .populate("category", "name slug")
        .populate("vendor", "firstName lastName email storeName");
    }
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }
    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get Product By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve product details.",
      error: error.message,
    });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format.",
      });
    }

    // 2. Find existing product in database
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    // 3. Extract update data from request body
    const {
      name,
      category,
      categoryName,
      subcategory,
      price,
      discountPrice,
      mrp,
      stock,
      lowStockAlert,
      shortDescription,
      description,
      longDescription,
      status,
      approvalStatus,
      isActive,
      specifications,
      productTags,
      existingImages,
      coverType,
      coverUrl,
    } = req.body;

    // Basic Details
    if (name !== undefined) product.name = name.trim();
    if (category !== undefined && mongoose.Types.ObjectId.isValid(category)) {
      product.category = category;
    }
    if (categoryName !== undefined) product.categoryName = categoryName;
    if (subcategory !== undefined) product.subcategory = subcategory.trim();

    // Pricing (mrp = Price, discountPrice = Selling Price)
    if (mrp !== undefined) {
      product.price = Number(mrp);
    } else if (price !== undefined) {
      product.price = Number(price);
    }

    if (discountPrice !== undefined) {
      product.discountPrice = Number(discountPrice);
    } else if (mrp !== undefined && price !== undefined) {
      product.discountPrice = Number(price);
    }

    // Safety check: ensure discountPrice is never higher than original price
    if (product.discountPrice > product.price) {
      product.discountPrice = product.price;
    }

    // Inventory & Stock
    if (stock !== undefined) product.stock = Number(stock);
    if (lowStockAlert !== undefined) {
      product.lowStockAlert = Number(lowStockAlert);
    }

    // Descriptions
    if (shortDescription !== undefined) {
      product.shortDescription = shortDescription.trim();
    }
    if (description !== undefined) {
      product.longDescription = description.trim();
    }
    if (longDescription !== undefined) {
      product.longDescription = longDescription.trim();
    }

    // Status & Activity
    if (status !== undefined) {
      product.isActive = status === "Active";
      if (status === "Active") {
        product.approvalStatus = "approved";
      } else if (status === "Pending") {
        product.approvalStatus = "pending";
      } else if (status === "Inactive") {
        product.approvalStatus = "rejected";
      }
    }

    if (approvalStatus !== undefined) {
      product.approvalStatus = approvalStatus;
    }
    if (isActive !== undefined) {
      product.isActive = Boolean(isActive);
    }

    // Specifications Parsing (Safe for FormData & JSON)
    if (specifications !== undefined) {
      let parsedSpecs = specifications;
      if (typeof specifications === "string") {
        try {
          parsedSpecs = JSON.parse(specifications);
        } catch {
          parsedSpecs = [];
        }
      }
      if (Array.isArray(parsedSpecs)) {
        product.specifications = parsedSpecs.filter(
          (spec) =>
            spec.name &&
            spec.name.trim() !== "" &&
            spec.value &&
            String(spec.value).trim() !== "",
        );
      }
    }

    // Product Tags Parsing (Safe for FormData & JSON)
    if (productTags !== undefined) {
      let parsedTags = productTags;
      if (typeof productTags === "string") {
        try {
          parsedTags = JSON.parse(productTags);
        } catch {
          parsedTags = productTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        }
      }
      if (Array.isArray(parsedTags)) {
        product.productTags = parsedTags.filter(
          (tag) => tag && String(tag).trim() !== "",
        );
      }
    }

    // PRO MULTI-IMAGE MANAGEMENT (PRESERVE EXISTING + NEW UPLOADS)

    // Step A: Parse retained existing Cloudinary images
    let retainedExistingUrls = [];
    if (existingImages !== undefined) {
      try {
        retainedExistingUrls =
          typeof existingImages === "string"
            ? JSON.parse(existingImages)
            : existingImages;
        if (!Array.isArray(retainedExistingUrls)) {
          retainedExistingUrls = [retainedExistingUrls];
        }
      } catch (err) {
        retainedExistingUrls = [];
      }
    } else {
      // Fallback: if existingImages was not sent, keep existing product images
      retainedExistingUrls = Array.isArray(product.images)
        ? [...product.images]
        : product.image
          ? [product.image]
          : [];
    }

    // Step B: Collect and upload any newly attached files
    let newlyUploadedUrls = [];
    const filesToUpload =
      req.files && Array.isArray(req.files) && req.files.length > 0
        ? req.files
        : req.file && req.file.buffer
          ? [req.file]
          : [];

    if (filesToUpload.length > 0) {
      const uploadPromises = filesToUpload.map((file) =>
        uploadToCloudinary(file.buffer, "smartcommerce_products"),
      );
      const results = await Promise.all(uploadPromises);
      newlyUploadedUrls = results.map((r) => r.secure_url);
    }

    // Step C: Assemble the final gallery respecting the selected Main Cover
    let finalMergedImages = [];

    if (coverType === "new" && newlyUploadedUrls.length > 0) {
      // If vendor set a newly uploaded image as the Main Cover:
      finalMergedImages = [...newlyUploadedUrls, ...retainedExistingUrls];
    } else if (coverUrl && retainedExistingUrls.includes(coverUrl)) {
      // If vendor set an existing image as the Main Cover:
      const remainingExisting = retainedExistingUrls.filter(
        (u) => u !== coverUrl,
      );
      finalMergedImages = [
        coverUrl,
        ...remainingExisting,
        ...newlyUploadedUrls,
      ];
    } else {
      // Default order: retained existing photos followed by new uploads
      finalMergedImages = [...retainedExistingUrls, ...newlyUploadedUrls];
    }

    // Step D: Update product images in database
    if (existingImages !== undefined || filesToUpload.length > 0) {
      if (finalMergedImages.length > 0) {
        product.images = finalMergedImages;
        product.image = finalMergedImages[0]; // First photo is always the Main Cover
      }
    }

    // 4. Save updated product to MongoDB
    const updatedProduct = await product.save();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully!",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("Update Product Error:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update product.",
      error: error.message,
    });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format.",
      });
    }
    const deletedProduct = await Product.findByIdAndDelete(id);
    if (!deletedProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found or already deleted.",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Product deleted successfully from database!",
      deletedId: id,
    });
  } catch (error) {
    console.error("Delete Product Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete product from database.",
      error: error.message,
    });
  }
};
