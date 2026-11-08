import { Router } from "express";
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';
import {
    validate,
    createOrderSchema,
    verifyCheckoutSchema,
    paymentIdParamSchema,
    rideIdParamSchema,
    listPaymentsQuerySchema,
    requestPayoutSchema,
    listPayoutsQuerySchema,
    adminMetricsQuerySchema,
    adminListPaymentsQuerySchema,
} from "../validation/payment.validation.js";
import {
    createOrder,
    verifyCheckout,
    getPayment,
    getPaymentsByRide,
    listPayments,
    getDriverBalance,
    requestPayout,
    listPayouts,
    getAdminMetrics,
    listPaymentsAdmin,
} from "../controllers/payment.controller.js";

const router = Router();

// Public health check endpoint
router.get("/health", (_req, res) => res.status(200).json({ status: "UP", service: "payment-service" }));

router.use(authMiddleware);

// Admin reporting & metrics
router.get('/admin/metrics', requireRole('ADMIN'), validate(adminMetricsQuerySchema), getAdminMetrics);
router.get('/admin/list', requireRole('ADMIN'), validate(adminListPaymentsQuerySchema), listPaymentsAdmin);

// Driver payout management (must stay ABOVE "/:paymentId")
router.get(
    "/payouts/balance",
    getDriverBalance
);

router.post(
    "/payouts/request",
    validate(requestPayoutSchema),
    requestPayout
);

router.get(
    "/payouts",
    validate(listPayoutsQuerySchema),
    listPayouts
);

router.post(
    "/orders",
    validate(createOrderSchema),
    createOrder
);

router.post(
    "/verify",
    validate(verifyCheckoutSchema),
    verifyCheckout
);

router.get(
    "/",
    validate(listPaymentsQuerySchema),
    listPayments
);

// must stay ABOVE "/:paymentId", otherwise "ride" would be read as a payment id
router.get(
    "/ride/:rideId",
    validate(rideIdParamSchema),
    getPaymentsByRide
);

router.get(
    "/:paymentId",
    validate(paymentIdParamSchema),
    getPayment
);

export default router;
