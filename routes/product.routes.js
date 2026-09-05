import { createProducts, getProducts, getConfigurableProducts, getProductsForAdmin, getProductsByCategory, updateProduct, deleteProduct } from "../controller/products.controller.js";
import e from "express";

const router = e.Router()

router.post("/create", createProducts)
router.put("/update/:id", updateProduct)
router.delete("/delete/:id", deleteProduct)


router.get("/all", getProducts)
router.get("/all-active-product", getConfigurableProducts)
router.get("/by-category/:categoryId", getProductsByCategory)
router.get("/admin", getProductsForAdmin)
export default router