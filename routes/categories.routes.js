import {createCategory, getAllCategories, updateCategory, deleteCategory } from '../controller/categories.controller.js';
import {verifyToken} from '../middleWare/auth.middleware.js';

import express from 'express';
const router = express.Router();

router.post('/create', verifyToken, createCategory);
router.put('/update/:id', verifyToken, updateCategory);
router.delete('/delete/:id', verifyToken, deleteCategory);

router.get('/all', verifyToken, getAllCategories);

export default router;