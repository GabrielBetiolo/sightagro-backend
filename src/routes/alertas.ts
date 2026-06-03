// src/routes/alertas.ts
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function alertasRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async (request) => {
    const { id: userId } = request.user as { id: number }
    return prisma.alerta.findMany({
      where: { fazenda: { userId } },
      orderBy: { createdAt: 'desc' },
      include: { fazenda: { select: { nome: true } } }
    })
  })

  app.patch('/:id/lido', auth, async (request) => {
    const { id } = request.params as { id: string }
    return prisma.alerta.update({ where: { id: Number(id) }, data: { lido: true } })
  })

  app.patch('/marcar-todos-lidos', auth, async (request) => {
    const { id: userId } = request.user as { id: number }
    await prisma.alerta.updateMany({
      where: { fazenda: { userId }, lido: false },
      data: { lido: true }
    })
    return { ok: true }
  })
}
