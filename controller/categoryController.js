import Category from "../model/Category.js";
import Product from "../model/Product.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";

// CLOUDINARY UPLOAD HELPER (BUFFER STREAM)
const uploadToCloudinary = (buffer, folder = "smartcommerce_categories") => {
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

const generateSlug = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-");
};

export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .select("_id name slug description image")
      .sort({ name: 1 });

    return res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoriesAll = async (req, res) => {
  try {
    const categories = await Category.find({})
      .select("_id name slug description image isActive createdAt")
      .sort({ name: 1 })
      .lean();

    // Aggregate product counts for each category
    const productCounts = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    // Build lookup map: categoryId -> productCount
    const countMap = {};
    productCounts.forEach((item) => {
      countMap[String(item._id)] = item.count;
    });

    // Map categories to include status string and productsCount
    const categoriesWithCounts = categories.map((cat) => ({
      ...cat,
      status: cat.isActive !== false ? "Active" : "Inactive",
      productsCount: countMap[String(cat._id)] || 0,
    }));

    return res.status(200).json({
      success: true,
      count: categoriesWithCounts.length,
      categories: categoriesWithCounts,
    });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories.",
      error: error.message,
    });
  }
};

export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Category ID format.",
      });
    }

    const category = await Category.findById(id).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    const productsCount = await Product.countDocuments({ category: id });

    return res.status(200).json({
      success: true,
      category: {
        ...category,
        status: category.isActive !== false ? "Active" : "Inactive",
        productsCount,
      },
    });
  } catch (error) {
    console.error("Get Category By ID Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch category.",
      error: error.message,
    });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { name, description, image, isActive, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    const cleanName = name.trim();
    const slug = generateSlug(cleanName);

    // Check duplicate name or slug
    const existing = await Category.findOne({
      $or: [{ name: cleanName }, { slug }],
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A category with this name already exists.",
      });
    }

    // CLOUDINARY SINGLE IMAGE UPLOAD
    let imageUrl = image || "";

    // If an image file was uploaded via Multer (req.file)
    if (req.file && req.file.buffer) {
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      imageUrl = uploadResult.secure_url;
    }
    // Safe fallback if Multer upload.any() was used
    else if (req.files && req.files.length > 0 && req.files[0].buffer) {
      const uploadResult = await uploadToCloudinary(req.files[0].buffer);
      imageUrl = uploadResult.secure_url;
    }

    const newCategory = new Category({
      name: cleanName,
      slug,
      description: description || "",
      image: imageUrl,
      isActive: isActive !== undefined ? isActive : status !== "Inactive",
    });

    const savedCategory = await newCategory.save();

    return res.status(201).json({
      success: true,
      message: "Category created successfully!",
      category: {
        ...savedCategory.toObject(),
        status: savedCategory.isActive ? "Active" : "Inactive",
        productsCount: 0,
      },
    });
  } catch (error) {
    console.error("Create Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create category.",
      error: error.message,
    });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Category ID format.",
      });
    }

    const { name, description, image, isActive, status } = req.body;
    const updateFields = {};

    if (name !== undefined) {
      updateFields.name = name.trim();
      updateFields.slug = generateSlug(name.trim());
    }
    if (description !== undefined) updateFields.description = description;

    if (isActive !== undefined) {
      updateFields.isActive = isActive;
    } else if (status !== undefined) {
      updateFields.isActive = status === "Active";
    }

    // CLOUDINARY SINGLE IMAGE UPDATE
    // Case A: New file uploaded via Multer (req.file)
    if (req.file && req.file.buffer) {
      const uploadResult = await uploadToCloudinary(req.file.buffer);
      updateFields.image = uploadResult.secure_url;
    }
    // Case B: Safe fallback if upload.any() was used
    else if (req.files && req.files.length > 0 && req.files[0].buffer) {
      const uploadResult = await uploadToCloudinary(req.files[0].buffer);
      updateFields.image = uploadResult.secure_url;
    }
    // Case C: Explicit image URL string passed in req.body
    else if (image !== undefined) {
      updateFields.image = image;
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true },
    ).lean();

    if (!updatedCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found for update.",
      });
    }

    const productsCount = await Product.countDocuments({ category: id });

    return res.status(200).json({
      success: true,
      message: "Category updated successfully!",
      category: {
        ...updatedCategory,
        status: updatedCategory.isActive ? "Active" : "Inactive",
        productsCount,
      },
    });
  } catch (error) {
    console.error("Update Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update category.",
      error: error.message,
    });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Category ID format.",
      });
    }

    const deletedCategory = await Category.findByIdAndDelete(id);

    if (!deletedCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found for deletion.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully!",
      category: deletedCategory,
    });
  } catch (error) {
    console.error("Delete Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete category.",
      error: error.message,
    });
  }
};
