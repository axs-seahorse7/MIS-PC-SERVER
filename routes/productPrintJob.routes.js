import { Router } from "express";
import {
  createProductPrintJob,
} from "../controller/productPrintJob.controller.js";

const router = Router();

// Create a Product QR print job
router.post("/", createProductPrintJob);

export default router;