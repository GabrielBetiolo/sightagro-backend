import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function alertasRoutes(app: FastifyInstance) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply)
  }

  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    return prisma.alerta.findMany({
      where: { fazenda: { userId: payload.id } },
      orderBy: { createdAt: 'desc' },
      include: { fazenda: { select: { nome: true } } }
    })
  })

  app.patch('/:id/lido', { preHandler: auth }, async (request) => {
    const { id } = request.params as { id: string }
    return prisma.alerta.update({ where: { id: Number(id) }, data: { lido: true } })
  })

  app.patch('/marcar-todos-lidos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    await prisma.alerta.updateMany({
      where: { fazenda: { userId: payload.id }, lido: false },
      data: { lido: true }
    })
    return { ok: true }
  })
}
