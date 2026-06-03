"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sensoresRoutes = sensoresRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function sensoresRoutes(app) {
    const auth = { preHandler: [app] };
    app.get('/', auth, async (request) => {
        const { id: userId } = request.user;
        return prisma.sensor.findMany({
            where: { fazenda: { userId } },
            include: {
                fazenda: { select: { nome: true } },
                leituras: { orderBy: { createdAt: 'desc' }, take: 1 }
            }
        });
    });
    app.post('/', auth, async (request, reply) => {
        const schema = zod_1.z.object({
            codigo: zod_1.z.string(),
            tipo: zod_1.z.string(),
            fazendaId: zod_1.z.number()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return reply.status(201).send(await prisma.sensor.create({ data: result.data }));
    });
    app.patch('/:id/status', auth, async (request, reply) => {
        const { id } = request.params;
        const { status } = request.body;
        return prisma.sensor.update({ where: { id: Number(id) }, data: { status } });
    });
    // POST leitura
    app.post('/:id/leituras', auth, async (request, reply) => {
        const { id } = request.params;
        const schema = zod_1.z.object({ valor: zod_1.z.number(), unidade: zod_1.z.string() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return reply.status(201).send(await prisma.leitura.create({ data: { sensorId: Number(id), ...result.data } }));
    });
}
