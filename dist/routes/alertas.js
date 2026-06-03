"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alertasRoutes = alertasRoutes;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function alertasRoutes(app) {
    const auth = async (request, reply) => {
        await app.authenticate(request, reply);
    };
    app.get('/', { preHandler: auth }, async (request) => {
        const payload = request.user;
        return prisma.alerta.findMany({
            where: { fazenda: { userId: payload.id } },
            orderBy: { createdAt: 'desc' },
            include: { fazenda: { select: { nome: true } } }
        });
    });
    app.patch('/:id/lido', { preHandler: auth }, async (request) => {
        const { id } = request.params;
        return prisma.alerta.update({ where: { id: Number(id) }, data: { lido: true } });
    });
    app.patch('/marcar-todos-lidos', { preHandler: auth }, async (request) => {
        const payload = request.user;
        await prisma.alerta.updateMany({
            where: { fazenda: { userId: payload.id }, lido: false },
            data: { lido: true }
        });
        return { ok: true };
    });
}
