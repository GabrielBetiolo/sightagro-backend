import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function dashboardRoutes(app) {
    app.get('/', { preHandler: [app.authenticate] }, async (request) => {
        const payload = request.user;
        const fazendas = await prisma.fazenda.findMany({
            where: { userId: payload.id },
            include: { sensores: true, alertas: { where: { lido: false } } }
        });
        const totalSensores = fazendas.reduce((acc, f) => acc + f.sensores.length, 0);
        const sensoresOnline = fazendas.reduce((acc, f) => acc + f.sensores.filter(s => s.status === 'online').length, 0);
        const alertasNaoLidos = fazendas.reduce((acc, f) => acc + f.alertas.length, 0);
        const alertasRecentes = await prisma.alerta.findMany({
            where: { fazenda: { userId: payload.id } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { fazenda: { select: { nome: true } } }
        });
        return {
            fazendas: fazendas.length,
            sensores: { total: totalSensores, online: sensoresOnline },
            alertas: alertasNaoLidos,
            alertasRecentes
        };
    });
}
