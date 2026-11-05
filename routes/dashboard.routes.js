import express from "express";
import { getOverview } from "../controller/dashboard/overview.controller.js";


import {
    getDashboardOverview,
    getHourlyProduction,
} from "../controller/dashboard/dashboard.controller.js";

const router = express.Router();

router.get("/overview", getDashboardOverview);
router.get("/hourly-production", getHourlyProduction);

router.get("/overview", getOverview);

export default router;