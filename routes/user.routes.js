import e from "express";
import {createUser, loginUser, logout, getMe } from "../controller/user.controller.js";
import {verifyToken} from "../middleWare/auth.middleware.js";

const router = e.Router();

router.post("/create", createUser);
router.post("/login", loginUser);
router.get("/me", verifyToken, getMe);
router.post("/logout", verifyToken, logout);


export default router;