import express from "express";

import {
  getAllExternalSourceMappings,
  getExternalSourceMappingById,
  createExternalSourceMapping,
  updateExternalSourceMapping,
  deleteExternalSourceMapping,
} from "../controller/externalSourceMapping.controller.js";

const router = express.Router();

router.get("/all", getAllExternalSourceMappings);
router.get("/:id", getExternalSourceMappingById);

router.post("/create", createExternalSourceMapping);

router.put("/update/:id", updateExternalSourceMapping);

router.delete("/delete/:id", deleteExternalSourceMapping);

export default router;