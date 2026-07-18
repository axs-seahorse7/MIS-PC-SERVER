import express from "express";
import {
  getAllExternalSources,
  getExternalSourceById,
  createExternalSource,
  updateExternalSource,
  deleteExternalSource,
} from "../controller/externalSource.controller.js";

const router = express.Router();

router.get("/all", getAllExternalSources);
router.get("/update/:id", getExternalSourceById);
router.post("/create", createExternalSource);
router.put("/update/:id", updateExternalSource);
router.delete("/delete/:id", deleteExternalSource);

export default router;