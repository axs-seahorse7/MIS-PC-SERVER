
import { Router } from "express";

import {
  getLabelTemplates,
  getLabelTemplateById,
  createLabelTemplate,
  updateLabelTemplate,
  deleteLabelTemplate,
  getPrinterLabelTemplates,
  assignPrinterLabelTemplate,
  removePrinterLabelTemplate,
  testPrintLabelTemplate,
  getLabelTemplateByTemplateType,
} from "../controller/labelTemplate.controller.js";

const router = Router();


// Printer ↔ Template
router.get("/printer/:printerId", getPrinterLabelTemplates);
router.put("/printer/:printerId", assignPrinterLabelTemplate);
router.get("/type/:type", getLabelTemplateByTemplateType);
router.delete("/printer/:printerId/:templateType",removePrinterLabelTemplate);

router.post("/test-print", testPrintLabelTemplate);

// Templates
router.get("/", getLabelTemplates);
router.get("/:id", getLabelTemplateById);
router.post("/", createLabelTemplate);
router.put("/:id", updateLabelTemplate);
router.delete("/:id", deleteLabelTemplate);

export default router;