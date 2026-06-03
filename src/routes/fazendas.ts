import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

export async function fazendasRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, async (request) => {
    const payload = request.user as { id: number }
    return prisma.fazenda.findMany({
      where: { userId: payload.id },
      include: {
        sensores: { select: { id: true, status: true } },
        _count: { select: { alertas: true } }
      }
    })
  })

  app.get('/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: Number(id), userId: payload.id },
      include: { sensores: true, alertas: true, irrigacoes: true }
    })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })
    return fazenda
  })

  app.post('/', auth, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({
      nome: z.string().min(2),
      localizacao: z.string().min(2),
      area: z.number().positive(),
      cultura: z.string().min(2)
    })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const fazenda = await prisma.fazenda.create({
      data: {
        nome: result.data.nome,
        localizacao: result.data.localizacao,
        area: result.data.area,
        cultura: result.data.cultura,
        user: { connect: { id: payload.id } }
      }
    })
    return reply.status(201).send(fazenda)
  })

  app.put('/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }
    const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })
    const body = request.body as { nome?: string; localizacao?: string; area?: number; cultura?: string }
    return prisma.fazenda.update({ where: { id: Number(id) }, data: body })
  })

  app.delete('/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }
    const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })
    await prisma.fazenda.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })
}
