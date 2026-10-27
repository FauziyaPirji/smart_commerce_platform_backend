import exprees from "express"
import cors from "cors"
import connectDB from "./config/db.js"
import userRouter from "./route/userRoutes.js"
import vendorRouter from "./route/vendorRoutes.js"
import categoryRouter from "./route/categoryRoutes.js";
import productRouter from "./route/productRoutes.js";
import adminRouter from "./route/adminRoutes.js";
import adminOrderRouter from "./route/adminOrderRoutes.js";
import customerRouter from "./route/customerSiteRoutes.js";
import orderRouter from "./route/orderRoutes.js";
import inventoryRouter from "./route/inventoryRoutes.js";
import dashboardRouter from "./route/dashboardRoutes.js";
import aiRouter from "./route/aiCompareRoute.js";
import aiChatRouter from "./route/aiChatRoutes.js";
import dotenv from "dotenv";

dotenv.config();

const app = exprees()

app.use(cors())
app.use(exprees.json())
app.use(exprees.urlencoded({extended: true}))
app.use(userRouter)
app.use(vendorRouter)
app.use(categoryRouter);
app.use(productRouter);
app.use(adminRouter);
app.use(adminOrderRouter);
app.use(customerRouter);
app.use(orderRouter);
app.use(inventoryRouter);
app.use(dashboardRouter);
app.use(aiRouter);
app.use(aiChatRouter);

const PORT = 5000
app.get('/', (req, res) => {
    res.send("Backend run successfully")
})

app.listen(PORT, () => {
    console.log(`App.js running on port // ${PORT}`)
})

connectDB().then(() => {
    
})