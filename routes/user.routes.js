import e from "express";
import {createUser, loginUser, logout, getMe, getUsers, updateUser, changePassword, deleteUser } from "../controller/user.controller.js";
import {verifyToken} from "../middleWare/auth.middleware.js";

const router = e.Router();

router.post("/login", loginUser);
router.get("/me", verifyToken, getMe);
router.post("/logout", verifyToken, logout);


router.post("/create", createUser);
router.get("/all", verifyToken, getUsers);
router.put("/update/:id", updateUser);
router.put("/change-password/:id", verifyToken, changePassword);
router.delete("/delete/:id", verifyToken, deleteUser);

export default router;