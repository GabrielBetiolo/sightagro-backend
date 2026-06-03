"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sensoresRoutes = sensoresRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function sensoresRoutes(app) {
    const auth = async (request, reply) => {
        await app.authenticate(request, reply);
    };
    app.get('/', { preHandler: auth }, async (request) => {
        const payload = request.user;
        return prisma.sensor.findMany({
            where: { fazenda: { userId: payload.id } },
            include: {
                fazenda: { select: { nome: true } },
                leituras: { orderBy: { createdAt: 'desc' }, take: 1 }
            }
        });
    });
    app.post('/', { preHandler: auth }, async (request, reply) => {
        const schema = zod_1.z.object({
            codigo: zod_1.z.string(),
            tipo: zod_1.z.string(),
            fazendaId: zod_1.z.number()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const sensor = await prisma.sensor.create({
            data: {
                codigo: result.data.codigo,
                tipo: result.data.tipo,
                fazenda: { connect: { id: result.data.fazendaId } }
            }
        });
        return reply.status(201).send(sensor);
    });
    app.patch('/:id/status', { preHandler: auth }, async (request) => {
        const { id } = request.params;
        const { status } = request.body;
        return prisma.sensor.update({ where: { id: Number(id) }, data: { status } });
    });
    app.post('/:id/leituras', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        const schema = zod_1.z.object({ valor: zod_1.z.number(), unidade: zod_1.z.string() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const leitura = await prisma.leitura.create({
            data: {
                valor: result.data.valor,
                unidade: result.data.unidade,
                sensor: { connect: { id: Number(id) } }
            }
        });
        return reply.status(201).send(leitura);
    });
}
