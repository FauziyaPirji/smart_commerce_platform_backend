import express from "express";
import {registerUser, simpleLoginUser, loginUser, verifyLogin2FA, resendLogin2FA, forgotPassword, resetPassword, getProfile, updateProfile, saveAddress, deleteAddress, changePassword} from "../controller/userController.js"
import authenticateToken from "../utils/authMiddleware.js";

const userRouter = express.Router()

userRouter.post('/api/users/register', registerUser);
userRouter.post('/api/users/add', registerUser);
userRouter.post('/api/users/simple-login', simpleLoginUser);
userRouter.post('/api/users/login', loginUser);
userRouter.post("/api/users/login-2fa", verifyLogin2FA);
userRouter.post("/api/users/resend-2fa", resendLogin2FA);
userRouter.post('/api/users/forgot-password', forgotPassword);
userRouter.post('/api/users/reset-password', resetPassword);

userRouter.get('/api/users/profile', authenticateToken, getProfile);
userRouter.put('/api/users/profile', authenticateToken, updateProfile);
userRouter.post('/api/users/address', authenticateToken, saveAddress);
userRouter.delete('/api/users/address', authenticateToken, deleteAddress);
userRouter.put('/api/users/change-password', authenticateToken, changePassword);

export default userRouter;