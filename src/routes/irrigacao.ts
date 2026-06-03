// src/routes/irrigacao.ts
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

export async function irrigacaoRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any)] }

  app.get('/', auth, async (request) => {
    const { id: userId } = request.user as { id: number }
    return prisma.irrigacao.findMany({
      where: { fazenda: { userId } },
      include: { fazenda: { select: { nome: true } } }
    })
  })

  app.patch('/:id/toggle', auth, async (request) => {
    const { id } = request.params as { id: string }
    const current = await prisma.irrigacao.findUnique({ where: { id: Number(id) } })
    if (!current) throw new Error('Zona não encontrada')
    return prisma.irrigacao.update({
      where: { id: Number(id) },
      data: {
        ativa: !current.ativa,
        fluxo: !current.ativa ? 4.2 : 0
      }
    })
  })

  app.post('/', auth, async (request, reply) => {
    const schema = z.object({
      zona: z.string(),
      duracao: z.number().int().positive(),
      fazendaId: z.number()
    })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })
    return reply.status(201).send(await prisma.irrigacao.create({ data: result.data }))
  })
}
