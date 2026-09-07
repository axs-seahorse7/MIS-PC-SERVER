// routes/print.routes.js

import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { updatePrintJobStatus, getBoxPrintJobZpl } from "../controller/print.controller.js";

const router = Router();

const PRIVATE_KEY_PATH = process.env.QZ_PRIVATE_KEY_PATH || path.resolve("./certs/qz-private-key.pem");
const PUBLIC_CERT_PATH = process.env.QZ_PUBLIC_CERT_PATH || path.resolve("./certs/qz-public-cert.pem");

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
const publicCert = fs.readFileSync(PUBLIC_CERT_PATH, "utf8");

router.patch("/box-print-jobs/:id", updatePrintJobStatus);
router.get("/box-print-jobs/:id/zpl", getBoxPrintJobZpl);

router.get("/cert", (req, res) => {
  return res.type("text/plain").send(publicCert);
});

router.post("/sign", (req, res) => {
  try {
    const { request } = req.body || {};

    if (!request) {
      return res.status(400).type("text/plain").send("request is required");
    }

    const signer = crypto.createSign("SHA512");
    signer.update(request, "utf8");
    signer.end();

    const signature = signer.sign(privateKey, "base64");

    return res.type("text/plain").send(signature);
  } catch (error) {
    console.error("❌ QZ signing error:", error);

    return res.status(500).type("text/plain").send("QZ signing failed");
  }
});

export default router;