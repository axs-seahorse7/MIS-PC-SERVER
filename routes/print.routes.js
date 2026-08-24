// routes/print.routes.js (or wherever your route files live)
import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {updatePrintJobStatus} from "../controller/print.controller.js"

const router = Router();

const PRIVATE_KEY_PATH = process.env.QZ_PRIVATE_KEY_PATH || path.resolve("./certs/qz-private-key.pem");
const PUBLIC_CERT_PATH = process.env.QZ_PUBLIC_CERT_PATH || path.resolve("./certs/qz-public-cert.pem");

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
const publicCert = fs.readFileSync(PUBLIC_CERT_PATH, "utf8");

console.log("🔐 QZ PRIVATE KEY:", PRIVATE_KEY_PATH);
console.log("📜 QZ PUBLIC CERT:", PUBLIC_CERT_PATH);

// Serves the public cert — qz-tray.js fetches this once per connection.
router.get("/cert", (req, res) => {
  res.type("text/plain").send(publicCert);
});

router.patch("/box-print-jobs/:id", updatePrintJobStatus)

// QZ Tray sends the exact request string it wants signed; we sign it with
// our private key and return the signature. This is what suppresses the
// per-print trust popup, as long as the public cert above is trusted on
// the operator's machine.
router.post("/sign", (req, res) => {
  const { request } = req.body;
  if (!request) {
    return res.status(400).json({ message: "request is required" });
  }

  const signer = crypto.createSign("SHA512");
  signer.update(request);
  signer.end();
  const signature = signer.sign(privateKey, "base64");

  res.type("text/plain").send(signature);
});

export default router;