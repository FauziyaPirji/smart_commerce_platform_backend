import multer from "multer";

// 1. Store file in memory as Buffer for Cloudinary upload stream
const storage = multer.memoryStorage();

// 2. Validate file type (only allow images)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (JPG, PNG, WEBP) are allowed!"), false);
  }
};

// 3. Configure Multer with 5MB limit
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: fileFilter,
});

export default upload;