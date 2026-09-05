import { Router } from 'express';
import {
  listCustomerSerialRules,
  getCustomerSerialRule,
  createCustomerSerialRule,
  updateCustomerSerialRule,
  toggleCustomerSerialRuleActive,
  deleteCustomerSerialRule,
} from '../controller/Customerserialrule.controller.js';
import {
  getGenerationPreview,
  generateCustomerQrBatch,
  markCustomerQrCodesPrinted,
  getPendingQrBatches,
  reprintPendingQrCodes,
} from '../controller/Customerqrbatch.controller.js';
// import { authenticate } from '../middleware/auth.js'; // wire in if your other routes are protected

const router = Router();

// Rule CRUD
router.get('/', listCustomerSerialRules);
router.get('/:id', getCustomerSerialRule);
router.post('/', createCustomerSerialRule);
router.put('/:id', updateCustomerSerialRule);
router.patch('/:id/toggle-active', toggleCustomerSerialRuleActive);
router.delete('/:id', deleteCustomerSerialRule);

// Batch QR generation + printing (customer_qr_buckets / customer_qr_codes)
router.get('/:id/generation-preview', getGenerationPreview);
router.post('/:id/generate-batch', generateCustomerQrBatch);
router.post('/qr-codes/mark-printed', markCustomerQrCodesPrinted);

// Pending (un-printed) QR codes — for the "Pending QR Codes" reprint view
router.get('/qr-codes/pending', getPendingQrBatches);
router.post('/qr-codes/reprint', reprintPendingQrCodes);

export default router;

// In your main router / app.js:
// import customerSerialRuleRoutes from './routes/customerSerialRuleRoutes.js';
// app.use('/api/customer-serial-rules', customerSerialRuleRoutes);
//
// import qzRoutes from './routes/qzRoutes.js';
// app.use('/api/qz', qzRoutes);