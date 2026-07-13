import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import dotenv from "dotenv";
dotenv.config();

import {connectDB} from "./DB/config/mysql.config.js";
import { globalErrorHandler } from "./utils/AppError.js";


// Route imports
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";


const app = express();

// ---------- DB ----------
connectDB();

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ORIGIN: ${req.headers.origin}`);
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

// ---------- Routes ----------
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);


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