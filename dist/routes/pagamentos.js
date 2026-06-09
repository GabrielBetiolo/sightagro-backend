"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagamentosRoutes = pagamentosRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const mercadopago_1 = require("mercadopago");
const prisma = new client_1.PrismaClient();
const mp = new mercadopago_1.MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const PLANS = {
    pro: {
        name: 'Pro',
        price: 49.90,
        interval: 'months',
        frequency: 1,
        features: ['5 fazendas', 'Sensores ilimitados', 'Relatórios completos']
    },
    enterprise: {
        name: 'Enterprise',
        price: 149.90,
        interval: 'months',
        frequency: 1,
        features: ['Fazendas ilimitadas', 'API de integração', 'Suporte 24/7']
    }
};
async function pagamentosRoutes(app) {
    const auth = async (request, reply) => {
        await app.authenticate(request, reply);
    };
    // GET /pagamentos/planos
    app.get('/planos', async () => {
        return Object.entries(PLANS).map(([key, plan]) => ({ id: key, ...plan }));
    });
    // GET /pagamentos/meu-plano
    app.get('/meu-plano', { preHandler: auth }, async (request) => {
        const payload = request.user;
        const user = await prisma.user.findUnique({
            where: { id: payload.id },
            select: { plan: true, planExpiresAt: true, mpSubscriptionId: true }
        });
        return user;
    });
    // POST /pagamentos/assinar — assinatura recorrente
    app.post('/assinar', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({ planId: zod_1.z.enum(['pro', 'enterprise']) });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Plano inválido' });
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user)
            return reply.status(404).send({ message: 'Usuário não encontrado' });
        const plan = PLANS[result.data.planId];
        const preApproval = new mercadopago_1.PreApproval(mp);
        const subscription = await preApproval.create({
            body: {
                preapproval_plan_id: undefined,
                reason: `AgroSmart ${plan.name}`,
                payer_email: user.email,
                auto_recurring: {
                    frequency: plan.frequency,
                    frequency_type: plan.interval,
                    transaction_amount: plan.price,
                    currency_id: 'BRL'
                },
                back_url: `${process.env.FRONTEND_URL}/app/planos?status=success`,
                status: 'pending'
            }
        });
        return { init_point: subscription.init_point, id: subscription.id };
    });
    // POST /pagamentos/unico — pagamento único
    app.post('/unico', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            planId: zod_1.z.enum(['pro', 'enterprise']),
            token: zod_1.z.string(),
            installments: zod_1.z.number().default(1),
            paymentMethodId: zod_1.z.string(),
            email: zod_1.z.string().email()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const plan = PLANS[result.data.planId];
        const payment = new mercadopago_1.Payment(mp);
        const resp = await payment.create({
            body: {
                transaction_amount: plan.price,
                token: result.data.token,
                description: `AgroSmart ${plan.name}`,
                installments: result.data.installments,
                payment_method_id: result.data.paymentMethodId,
                payer: { email: result.data.email }
            }
        });
        if (resp.status === 'approved') {
            const expiresAt = new Date();
            expiresAt.setMonth(expiresAt.getMonth() + 1);
            await prisma.user.update({
                where: { id: payload.id },
                data: { plan: result.data.planId, planExpiresAt: expiresAt }
            });
        }
        return { status: resp.status, id: resp.id };
    });
    // POST /pagamentos/webhook
    app.post('/webhook', async (request, reply) => {
        const body = request.body;
        if (body.type === 'subscription_preapproval') {
            const preApproval = new mercadopago_1.PreApproval(mp);
            const sub = await preApproval.get({ id: body.data.id });
            if (sub.status === 'authorized') {
                const user = await prisma.user.findFirst({ where: { email: sub.payer_email } });
                if (user) {
                    const expiresAt = new Date();
                    expiresAt.setMonth(expiresAt.getMonth() + 1);
                    const planId = sub.reason?.toLowerCase().includes('enterprise') ? 'enterprise' : 'pro';
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { plan: planId, planExpiresAt: expiresAt, mpSubscriptionId: body.data.id }
                    });
                }
            }
        }
        return reply.status(200).send({ ok: true });
    });
    // POST /pagamentos/cancelar
    app.post('/cancelar', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user?.mpSubscriptionId)
            return reply.status(400).send({ message: 'Nenhuma assinatura ativa' });
        const preApproval = new mercadopago_1.PreApproval(mp);
        await preApproval.update({ id: user.mpSubscriptionId, body: { status: 'cancelled' } });
        await prisma.user.update({ where: { id: payload.id }, data: { plan: 'free', mpSubscriptionId: null } });
        return { ok: true };
    });
}
