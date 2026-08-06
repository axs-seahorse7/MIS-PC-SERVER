import express from "express";
import {
  getAllExternalSources,
  getExternalSourceById,
  createExternalSource,
  updateExternalSource,
  deleteExternalSource,
  getMachineByCode,
} from "../controller/externalSource.controller.js";

const router = express.Router();

router.get("/all", getAllExternalSources);
router.get("/update/:id", getExternalSourceById);
router.post("/create", createExternalSource);
router.put("/update/:id", updateExternalSource);
router.delete("/delete/:id", deleteExternalSource);
router.get("/machine/:machineCode", getMachineByCode);

// full route is /external-source/machine/:machineCode, e.g. /external-source/machine/ICT-0001

export default router;