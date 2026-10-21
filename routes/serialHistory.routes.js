
import express from "express";
import {
  searchSerialHistory,
  searchBoxHistory,
} from "../controller/serialHistory.controller.js";

const router = express.Router();

router.get("/serial", searchSerialHistory);
router.get("/box", searchBoxHistory);

export default router;
