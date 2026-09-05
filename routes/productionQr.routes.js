import { Router } from "express";

import {
  getProductionQrGenerationPreview,
  generateProductionQrCodes,
  getPendingProductionQrBatches,
  markProductionQrCodesPrinted,
  reprintProductionQrCodes,
} from "../controller/productionQr.controller.js";

const router = Router();

// Generation
router.get(
  "/:id/generation-preview",
  getProductionQrGenerationPreview
);

router.post(
  "/:id/generate-batch",
  generateProductionQrCodes
);

// Printing
router.get(
  "/qr-codes/pending",
  getPendingProductionQrBatches
);

router.post(
  "/qr-codes/mark-printed",
  markProductionQrCodesPrinted
);

router.post(
  "/qr-codes/reprint",
  reprintProductionQrCodes
);

export default router;