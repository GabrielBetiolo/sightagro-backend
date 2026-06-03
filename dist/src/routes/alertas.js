import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function alertasRoutes(app) {
    const auth = { preHandler: [app] };
    app.get('/', auth, async (request) => {
        const { id: userId } = request.user;
        return prisma.alerta.findMany({
            where: { fazenda: { userId } },
            orderBy: { createdAt: 'desc' },
            include: { fazenda: { select: { nome: true } } }
        });
    });
    app.patch('/:id/lido', auth, async (request) => {
        const { id } = request.params;
        return prisma.alerta.update({ where: { id: Number(id) }, data: { lido: true } });
    });
    app.patch('/marcar-todos-lidos', auth, async (request) => {
        const { id: userId } = request.user;
        await prisma.alerta.updateMany({
            where: { fazenda: { userId }, lido: false },
            data: { lido: true }
        });
        return { ok: true };
    });
}
