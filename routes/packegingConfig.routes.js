import express from "express";
import {
  getAllPackagingConfigs,
  getPackagingConfigById,
  createPackagingConfig,
  updatePackagingConfig,
  patchPackagingConfig,
  deletePackagingConfig,
} from "../controller/packeging.controller.js";

const router = express.Router();

router.get("/", getAllPackagingConfigs);
router.get("/:id", getPackagingConfigById);
router.post("/", createPackagingConfig);
router.put("/:id", updatePackagingConfig);
router.patch("/:id", patchPackagingConfig);
router.delete("/:id", deletePackagingConfig);

export default router;