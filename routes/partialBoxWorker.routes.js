
import express from "express";
import {
  getPartialBoxWorkers,
  createPartialBoxWorker,
  updatePartialBoxWorkerStatus,
} from "../controller/partialBoxWorker.controller.js";

const router = express.Router();

router.get("/:configId/workers", getPartialBoxWorkers);
router.post("/:configId/workers", createPartialBoxWorker);
router.patch(
  "/:configId/workers/:workerId",
  updatePartialBoxWorkerStatus
);

export default router;
