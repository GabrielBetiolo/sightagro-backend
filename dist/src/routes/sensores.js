import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
const prisma = new PrismaClient();
export async function sensoresRoutes(app) {
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
        const schema = z.object({
            codigo: z.string(),
            tipo: z.string(),
            fazendaId: z.number()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return reply.status(201).send(await prisma.sensor.create({
            data: {
                codigo: result.data.codigo,
                tipo: result.data.tipo,
                fazenda: {
                    connect: { id: Number(result.data.fazendaId) }
                }
            }
        }));
    });
    app.patch('/:id/status', auth, async (request, reply) => {
        const { id } = request.params;
        const { status } = request.body;
        return prisma.sensor.update({ where: { id: Number(id) }, data: { status } });
    });
    // POST leitura
    app.post('/:id/leituras', auth, async (request, reply) => {
        const { id } = request.params;
        const schema = z.object({ valor: z.number(), unidade: z.string() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return reply.status(201).send(await prisma.leitura.create({
            data: {
                valor: Number(result.data.valor),
                unidade: result.data.unidade,
                sensor: {
                    connect: { id: Number(id) }
                }
            }
        }));
    });
}
