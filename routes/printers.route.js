import express from "express";
import {
  getAllPrinters,
  getPrinterById,
  createPrinter,
  updatePrinter,
  patchPrinter,
  deletePrinter,
} from "../controller/printer.controller.js";

const router = express.Router();

router.get("/", getAllPrinters);
router.get("/:id", getPrinterById);
router.post("/", createPrinter);
router.put("/:id", updatePrinter);
router.patch("/:id", patchPrinter);
router.delete("/:id", deletePrinter);

export default router;