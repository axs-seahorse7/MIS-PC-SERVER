import express from "express";

import {
  receiveExternalResult,
  getExternalResults,
  getExternalResultByIdentifier,
} from "../controller/externalResult.controller.js";

const router = express.Router();

router.post("/create", receiveExternalResult);

router.get("/all", getExternalResults);

router.get("/identifier/:identifier", getExternalResultByIdentifier);

export default router;