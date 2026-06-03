"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fazendasRoutes = fazendasRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function fazendasRoutes(app) {
    const auth = async (request, reply) => {
        await app.authenticate(request, reply);
    };
    app.get('/', { preHandler: auth }, async (request) => {
        const payload = request.user;
        return prisma.fazenda.findMany({
            where: { userId: payload.id },
            include: {
                sensores: { select: { id: true, status: true } },
                _count: { select: { alertas: true } }
            }
        });
    });
    app.get('/:id', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        const payload = request.user;
        const fazenda = await prisma.fazenda.findFirst({
            where: { id: Number(id), userId: payload.id },
            include: { sensores: true, alertas: true, irrigacoes: true }
        });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        return fazenda;
    });
    app.post('/', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            nome: zod_1.z.string().min(2),
            localizacao: zod_1.z.string().min(2),
            area: zod_1.z.number().positive(),
            cultura: zod_1.z.string().min(2)
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: result.error.errors[0].message });
        const fazenda = await prisma.fazenda.create({
            data: {
                nome: result.data.nome,
                localizacao: result.data.localizacao,
                area: result.data.area,
                cultura: result.data.cultura,
                user: { connect: { id: payload.id } }
            }
        });
        return reply.status(201).send(fazenda);
    });
    app.put('/:id', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        const payload = request.user;
        const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId: payload.id } });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        const body = request.body;
        return prisma.fazenda.update({ where: { id: Number(id) }, data: body });
    });
    app.delete('/:id', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        const payload = request.user;
        const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId: payload.id } });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        await prisma.fazenda.delete({ where: { id: Number(id) } });
        return reply.status(204).send();
    });
}
