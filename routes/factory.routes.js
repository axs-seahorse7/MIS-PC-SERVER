// routes/factory.routes.js
import express from "express";
import {
  getAllFactories,
  getFactoryById,
  createFactory,
  updateFactory,
  deleteFactory,
} from "../controller/factory.controller.js";

const router = express.Router();

router.get("/all", getAllFactories);
router.get("/:id", getFactoryById);

router.post("/create", createFactory);
router.put("/update/:id", updateFactory);
router.delete("/delete/:id", deleteFactory);

export default router;