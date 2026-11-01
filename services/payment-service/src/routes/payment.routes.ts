import { Router } from "express";
import { authMiddleware, requireRole } from '../middlewares/auth.middleware.js';
import { prisma } from '../db/client.js';
import {
    validate,
    createOrderSchema,
    verifyCheckoutSchema,
    refundSchema,
    paymentIdParamSchema,
    rideIdParamSchema,
    listPaymentsQuerySchema,
} from "../validation/payment.validation.js";
import {
    createOrder,
    verifyCheckout,
    getPayment,
    getPaymentsByRide,
    listPayments,
    refundPayment,
    getDriverBalance,
    requestPayout,
    listPayouts,
} from "../controllers/payment.controller.js";

const router = Router();

// Public health check endpoint
router.get("/health", (_req, res) => res.status(200).json({ status: "UP", service: "payment-service" }));

router.use(authMiddleware);

router.get('/admin/metrics', requireRole('ADMIN'), async (req, res, next) => {
    try {
        const period = typeof req.query.period === 'string' ? req.query.period : '7d';
        const days = period === '24h' ? 1 : period === '30d' ? 30 : 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [capturedStats, refundStats, totalCount, statusCounts] = await Promise.all([
            prisma.payment.aggregate({
                _sum: { amountPaise: true },
                _count: true,
                where: { status: 'CAPTURED', createdAt: { gte: startDate } },
            }),
            prisma.payment.aggregate({
                _sum: { refundedAmountPaise: true },
                where: { createdAt: { gte: startDate } },
            }),
            prisma.payment.count({ where: { createdAt: { gte: startDate } } }),
            prisma.payment.groupBy({
                by: ['status'],
                _count: true,
                where: { createdAt: { gte: startDate } },
            }),
        ]);

        const statusBreakdown: Record<string, number> = {};
        for (const s of statusCounts) {
            statusBreakdown[s.status] = s._count;
        }

        res.json({
            success: true,
            data: {
                period,
                totalTransactions: totalCount,
                grossVolumePaise: capturedStats._sum.amountPaise || 0,
                refundedVolumePaise: refundStats._sum.refundedAmountPaise || 0,
                statusBreakdown,
            },
        });
    } catch (error) { next(error); }
});

router.get('/admin/list', requireRole('ADMIN'), async (req, res, next) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
        const where = {
            ...(status ? { status: status as never } : {}),
            ...(search ? {
                OR: [
                    { id: { contains: search, mode: 'insensitive' as const } },
                    { rideId: { contains: search, mode: 'insensitive' as const } },
                    { riderId: { contains: search, mode: 'insensitive' as const } },
                    { gatewayPaymentId: { contains: search, mode: 'insensitive' as const } },
                    { gatewayOrderId: { contains: search, mode: 'insensitive' as const } },
                ],
            } : {}),
        };
        const [items, total] = await prisma.$transaction([
            prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
            prisma.payment.count({ where }),
        ]);
        res.json({ success: true, data: items, pagination: { page, limit, total } });
    } catch (error) { next(error); }
});

// Driver payout management (must stay ABOVE "/:paymentId")
router.get(
    "/payouts/balance",
    getDriverBalance
);

router.post(
    "/payouts/request",
    requestPayout
);

router.get(
    "/payouts",
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

// admin only: money leaves the platform
router.post(
    "/:paymentId/refund",
    requireRole('ADMIN'),
    validate(paymentIdParamSchema),
    validate(refundSchema),
    refundPayment
);

export default router;
