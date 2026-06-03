import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

export async function sensoresRoutes(app: FastifyInstance) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply)
  }

  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    return prisma.sensor.findMany({
      where: { fazenda: { userId: payload.id } },
      include: {
        fazenda: { select: { nome: true } },
        leituras: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })
  })

  app.post('/', { preHandler: auth }, async (request, reply) => {
    const schema = z.object({
      codigo: z.string(),
      tipo: z.string(),
      fazendaId: z.number()
    })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })

    const sensor = await prisma.sensor.create({
      data: {
        codigo: result.data.codigo,
        tipo: result.data.tipo,
        fazenda: { connect: { id: result.data.fazendaId } }
      }
    })
    return reply.status(201).send(sensor)
  })

  app.patch('/:id/status', { preHandler: auth }, async (request) => {
    const { id } = request.params as { id: string }
    const { status } = request.body as { status: string }
    return prisma.sensor.update({ where: { id: Number(id) }, data: { status } })
  })

  app.post('/:id/leituras', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const schema = z.object({ valor: z.number(), unidade: z.string() })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })

    const leitura = await prisma.leitura.create({
      data: {
        valor: result.data.valor,
        unidade: result.data.unidade,
        sensor: { connect: { id: Number(id) } }
      }
    })
    return reply.status(201).send(leitura)
  })
}
