import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import dotenv from "dotenv";
dotenv.config();

import {connectDB} from "./DB/config/mysql.config.js";
import { globalErrorHandler } from "./utils/AppError.js";

import {verifyToken} from "./middleWare/auth.middleware.js";


// Route imports
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import categoryRoutes from "./routes/categories.routes.js";
import productRoutes from "./routes/product.routes.js";
import stageRoutes from "./routes/stages.routes.js";
import stageScanFieldRoutes from "./routes/stageScanField.routes.js";
import productStagesFlowRoutes from "./routes/productStagesFlow.routes.js";
import productionFieldRoutes from "./routes/prodcutionField.routes.js";
import itemsRoutes from "./routes/items.routes.js";
import itemFieldValuesRoutes from "./routes/itemFieldValues.routes.js";
import scanHistoryRoutes from "./routes/scanHistory.routes.js";
import fctRoutes from "./routes/fct.routes.js";
import externalSourceRoutes from "./routes/externalSource.routes.js";
import externalResultRoutes from "./routes/externalResult.routes.js";
import externalSourceMappingRoutes from "./routes/externalSourceMapping.routes.js";
import productionLineRoutes from "./routes/productionLine.controller.js";
import factoryRoutes from "./routes/factory.routes.js";
import ictRoutes from "./routes/ict.routes.js";

const app = express();

// ---------- DB ----------
connectDB();

app.use((req, res, next) => {
  console.log(`[${new Date().getHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}] : [${req.method}] > ${req.url} [ORIGIN] >  ${req.headers.origin}`);
  next();
});

app.use((req, res, next) => {
    res.on("finish", () => {
        console.log(res.getHeaders());
    });
    next();
});

// ---------- Core Middleware ----------
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL?.split(","),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  })
);

app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// ---------- Health Check ----------
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});


app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/ict", ictRoutes);

app.use(verifyToken); // Apply JWT verification middleware to all routes below

// ---------- Routes ----------
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/stages", stageRoutes);
app.use("/api/stage-scan-fields", stageScanFieldRoutes);
app.use("/api/product-stage-flow", productStagesFlowRoutes);
app.use("/api/product-fields", productionFieldRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/item-field-values", itemFieldValuesRoutes);
app.use("/api/scan-history", scanHistoryRoutes);
app.use("/api/fct", fctRoutes);
app.use("/api/external-sources", externalSourceRoutes);
app.use("/api/external-results", externalResultRoutes);
app.use("/api/external-source-mappings", externalSourceMappingRoutes);
app.use("/api/production-lines", productionLineRoutes);
app.use("/api/factories", factoryRoutes);



// ---------- 404 ----------
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ---------- Global Error Handler ----------
app.use(globalErrorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;