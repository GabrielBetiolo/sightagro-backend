"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificacoesRoutes = notificacoesRoutes;
exports.sendPushToUser = sendPushToUser;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const web_push_1 = __importDefault(require("web-push"));
const prisma = new client_1.PrismaClient();
function getWebPush() {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
        web_push_1.default.setVapidDetails('mailto:contato@agrosmart.com.br', pub, priv);
    }
    return web_push_1.default;
}
async function notificacoesRoutes(app) {
    const auth = async (req, rep) => { await app.authenticate(req, rep); };
    app.post('/subscribe', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            endpoint: zod_1.z.string(),
            keys: zod_1.z.object({ p256dh: zod_1.z.string(), auth: zod_1.z.string() })
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        await prisma.pushSubscription.upsert({
            where: { endpoint: result.data.endpoint },
            update: { userId: payload.id, keys: JSON.stringify(result.data.keys) },
            create: { userId: payload.id, endpoint: result.data.endpoint, keys: JSON.stringify(result.data.keys) }
        });
        return { ok: true };
    });
    app.delete('/subscribe', { preHandler: auth }, async (request) => {
        const payload = request.user;
        await prisma.pushSubscription.deleteMany({ where: { userId: payload.id } });
        return { ok: true };
    });
    app.get('/vapid-public-key', async () => {
        return { key: process.env.VAPID_PUBLIC_KEY };
    });
}
async function sendPushToUser(userId, title, body, url) {
    try {
        const wp = getWebPush();
        const subs = await prisma.pushSubscription.findMany({ where: { userId } });
        for (const sub of subs) {
            try {
                await wp.sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys) }, JSON.stringify({ title, body, url: url || '/app/alertas', icon: '/icon-192.png' }));
            }
            catch (err) {
                console.error('Push failed for sub:', sub.endpoint, err);
            }
        }
    }
    catch (err) {
        console.error('sendPushToUser error:', err);
    }
}
