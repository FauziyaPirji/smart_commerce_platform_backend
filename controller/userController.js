import User from "../model/User.js";
import axios from "axios";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import generateToken from "../utils/jwtUtils.js";
import { sendEmail } from "../utils/sendEmail.js";

// Helper: Mask email for privacy (e.g. rahul.sharma@gmail.com -> r****a@gmail.com)
const maskEmail = (email) => {
  if (!email || !email.includes("@")) return "your email";
  const [name, domain] = email.split("@");
  if (name.length <= 2) {
    return `${name[0]}*@${domain}`;
  }
  const first = name[0];
  const last = name[name.length - 1];
  return `${first}****${last}@${domain}`;
};

// Helper: Send Real HTML Email with 6-Digit OTP
const sendVerificationEmail = async (toEmail, otp) => {
  const htmlMessage = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #0f172a; margin: 0; font-size: 22px; font-weight: 800;">SmartCommerce</h2>
        <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">2-Step Identity Verification</p>
      </div>
      <p style="color: #334155; font-size: 14px; line-height: 22px;">
        A sign-in attempt was initiated for your SmartCommerce account. Use the following security code to complete your login:
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <div style="display: inline-block; background-color: #f0fdf4; border: 2px dashed #22c55e; border-radius: 12px; padding: 14px 28px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #15803d;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 10px;">This code will expire in <strong>10 minutes</strong>.</p>
      </div>
      <p style="color: #64748b; font-size: 12px; line-height: 18px; border-top: 1px solid #f1f5f9; padding-top: 20px;">
        If you did not make this request, someone else may have entered your password. Please sign in and change your password immediately.
      </p>
    </div>
  `;
  try {
    await sendEmail({
      email: toEmail,
      subject: `${otp} is your SmartCommerce verification code`,
      htmlMessage,
    });
    console.log(`[EMAIL DISPATCHED] Successfully sent 2FA code to ${toEmail}`);
    return true;
  } catch (err) {
    console.error("[EMAIL DISPATCH ERROR]:", err.message);
    // Development console fallback
    console.log(`\n📧 [FALLBACK OTP FOR TESTING]: ${otp} for ${toEmail}\n`);
    return true;
  }
};

// 1. STEP 1: VERIFY PASSWORD -> DISPATCH 6-DIGIT EMAIL CODE
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter both email and password.",
      });
    }
    // 1. Find user by email
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    // 2. Account status check
    if (user.accountStatus && user.accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        message: `Your account is currently ${user.accountStatus}. Please contact support.`,
      });
    }
    // 3. Password check
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    // 4. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    user.twoFactorOtp = otp;
    user.twoFactorExpires = otpExpires;
    await user.save();
    // 5. Send Email with the OTP
    await sendVerificationEmail(user.email, otp);
    // 6. Sign 5-minute temporary token for the 2FA verification challenge
    const secret =
      process.env.JWT_SECRET || "smartcommerce_super_secret_jwt_key";
    const tempToken = jwt.sign(
      { userId: user._id, email: user.email, purpose: "2fa_email_challenge" },
      secret,
      { expiresIn: "5m" },
    );
    return res.status(200).json({
      success: true,
      requires2FA: true,
      tempToken,
      maskedEmail: maskEmail(user.email),
      message: `Verification code sent to ${maskEmail(user.email)}.`,
      // For local development testing:
      devOtp: process.env.NODE_ENV !== "production" ? otp : undefined,
    });
  } catch (error) {
    console.error("Error in loginUser (Step 1):", error);
    return res.status(500).json({
      success: false,
      message: "Server Error: Unable to proceed with login.",
      error: error.message,
    });
  }
};
// 2. STEP 2: VERIFY EMAIL OTP -> ISSUE AUTHENTICATED ACCESS TOKEN
export const verifyLogin2FA = async (req, res) => {
  try {
    const { tempToken, otp } = req.body;
    if (!tempToken || !otp) {
      return res.status(400).json({
        success: false,
        message: "Session token and verification code are required.",
      });
    }
    // 1. Verify Temporary Session Token
    const secret =
      process.env.JWT_SECRET || "smartcommerce_super_secret_jwt_key";
    let decoded;
    try {
      decoded = jwt.verify(tempToken, secret);
    } catch {
      return res.status(401).json({
        success: false,
        message:
          "Verification session has expired. Please log in again with your password.",
      });
    }
    if (decoded.purpose !== "2fa_email_challenge" || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid verification session.",
      });
    }
    // 2. Fetch User & Match Code
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found." });
    }
    if (!user.twoFactorOtp || !user.twoFactorExpires) {
      return res.status(400).json({
        success: false,
        message:
          "No active verification code found. Please request a new code.",
      });
    }
    if (new Date() > new Date(user.twoFactorExpires)) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please click resend.",
      });
    }
    if (String(user.twoFactorOtp).trim() !== String(otp).trim()) {
      return res.status(401).json({
        success: false,
        message: "Invalid code. Please check your email inbox and try again.",
      });
    }
    // 3. Clear code upon success
    user.twoFactorOtp = null;
    user.twoFactorExpires = null;
    await user.save();
    // 4. Issue official JWT Access Token
    const finalToken = await generateToken(user);
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.twoFactorOtp;
    return res.status(200).json({
      success: true,
      message: "2-Step verification successful. Welcome back!",
      token: finalToken,
      user: userResponse,
    });
  } catch (error) {
    console.error("Error in verifyLogin2FA:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify security code.",
      error: error.message,
    });
  }
};
// 3. RESEND EMAIL OTP CODE
export const resendLogin2FA = async (req, res) => {
  try {
    const { tempToken } = req.body;
    if (!tempToken) {
      return res
        .status(400)
        .json({ success: false, message: "Missing session token." });
    }
    const secret =
      process.env.JWT_SECRET || "smartcommerce_super_secret_jwt_key";
    let decoded;
    try {
      decoded = jwt.verify(tempToken, secret);
    } catch {
      return res
        .status(401)
        .json({ success: false, message: "Session expired. Sign in again." });
    }
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    // Generate fresh OTP
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorOtp = newOtp;
    user.twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    await sendVerificationEmail(user.email, newOtp);
    return res.status(200).json({
      success: true,
      message: `A new verification code has been sent to ${maskEmail(user.email)}.`,
      devOtp: process.env.NODE_ENV !== "production" ? newOtp : undefined,
    });
  } catch (error) {
    console.error("Error in resendLogin2FA:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resend verification email.",
    });
  }
};

export const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      email,
      password,
      gender,
      phone,
      dob,
      profilePhoto,
      role,
      addresses,
    } = req.body;
    // 1. Basic validation
    if (!firstName || !lastName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required fields: firstName, lastName, email, password, and phone.",
      });
    }
    // 2. Check if user with given email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email address already exists.",
      });
    }
    // 3. Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    // 4. Create new User instance
    const newUser = new User({
      firstName,
      middleName,
      lastName,
      email: email.toLowerCase(),
      password: hashedPassword,
      gender,
      phone,
      dob,
      profilePhoto,
      role: role || "customer",
      addresses: addresses || [],
    });
    // 5. Save user to database
    await newUser.save();
    // 6. Remove password from output object
    const userResponse = newUser.toObject();
    delete userResponse.password;
    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      user: userResponse,
    });
  } catch (error) {
    console.error("Error in registerUser:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error: Unable to register user.",
      error: error.message,
    });
  }
};

export const simpleLoginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    // 1. Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both email and password.",
      });
    }
    // 2. Find user by email and explicitly select password field (+password)
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    // 3. Check Account Status
    if (user.accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        message: `Your account is currently ${user.accountStatus}. Please contact support.`,
      });
    }
    // 4. Compare provided password with hashed password in database
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    // 5. Convert user to plain object and remove password
    const userResponse = user.toObject();
    delete userResponse.password;
    const token = await generateToken(user);
    return res.status(200).json({
      success: true,
      message: "Logged in successfully!",
      user: userResponse,
      token: token,
    });
  } catch (error) {
    console.error("Error in loginUser:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error: Unable to log in.",
      error: error.message,
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide your email address.",
      });
    }
    // 1. Find user in database
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address.",
      });
    }
    // 2. Create Password Reset HTML Email Content
    const resetUrl = `http://localhost:3000/reset-password?email=${user.email}`;
    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; rounded: 10px;">
        <h2>Password Reset Request</h2>
        <p>Hello <b>${user.firstName}</b>,</p>
        <p>We received a request to reset your SmartCommerce account password.</p>
        <p>Click the button below to reset your password:</p>
        <a href="${resetUrl}" style="background-color: #166534; color: white; padding: 12px 20px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 10px 0;">Reset Password</a>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `;
    // 3. Send the REAL email!
    await sendEmail({
      email: user.email,
      subject: "SmartCommerce - Password Reset Request",
      htmlMessage,
    });
    return res.status(200).json({
      success: true,
      message: "Password reset link has been sent to your email inbox!",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send reset email. Please try again later.",
      error: error.message,
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and new password.",
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long.",
      });
    }
    // 1. Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }
    // 2. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // 3. Update and save user password
    user.password = hashedPassword;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully! You can now log in.",
    });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error: Unable to reset password.",
      error: error.message,
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const {
      userId,
      firstName,
      middleName,
      lastName,
      email,
      phone,
      gender,
      dob,
    } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    user.firstName = firstName || user.firstName;
    user.middleName = middleName || "";
    user.lastName = lastName || user.lastName;
    user.email = email ? email.toLowerCase() : user.email;
    user.phone = phone || user.phone;
    user.gender = gender || user.gender;
    user.dob = dob || user.dob;
    await user.save();
    const userResponse = user.toObject();
    delete userResponse.password;
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully!",
      user: userResponse,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveAddress = async (req, res) => {
  try {
    const {
      userId,
      addressId,
      type,
      name,
      phone,
      address,
      city,
      state,
      pincode,
    } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    const formattedAddress = {
      fullName: name,
      phone,
      addressLine1: address,
      city,
      state,
      pincode,
      addressType: (type || "Home").toLowerCase(),
      isDefault: user.addresses.length === 0,
    };
    if (addressId) {
      // Update existing address
      const addrIndex = user.addresses.findIndex(
        (a) => a._id.toString() === addressId,
      );
      if (addrIndex !== -1) {
        user.addresses[addrIndex] = {
          ...user.addresses[addrIndex].toObject(),
          ...formattedAddress,
        };
      }
    } else {
      // Push new address
      user.addresses.push(formattedAddress);
    }
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Address saved successfully!",
      addresses: user.addresses,
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const { userId, addressId } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    user.addresses = user.addresses.filter(
      (a) => a._id.toString() !== addressId,
    );
    if (user.addresses.length > 0 && !user.addresses.some((a) => a.isDefault)) {
      user.addresses[0].isDefault = true;
    }
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Address deleted successfully!",
      addresses: user.addresses,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required.",
      });
    }

    // Validate passwords
    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password is required.",
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password is required.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters.",
      });
    }

    // IMPORTANT:
    // If password has select:false in your User schema,
    // .select("+password") is required.
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!user.password) {
      return res.status(500).json({
        success: false,
        message: "Password is not available for this user.",
      });
    }

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    // Don't allow same password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password.",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully!",
    });
  } catch (error) {
    console.error("Change Password Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
