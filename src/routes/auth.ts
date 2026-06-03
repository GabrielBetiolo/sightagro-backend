// src/routes/auth.ts
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const prisma = new PrismaClient()

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post('/register', async (request, reply) => {
    const schema = z.object({
      name: z.string().min(2, 'Nome muito curto'),
      email: z.string().email('E-mail inválido'),
      password: z.string().min(6, 'Senha deve ter mínimo 6 caracteres')
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const { name, email, password } = result.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return reply.status(400).send({ message: 'E-mail já cadastrado' })
    }

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { name, email, password: hashed },
      select: { id: true, name: true, email: true, role: true }
    })

    const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' })
    return reply.status(201).send({ token, user })
  })

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: 'Dados inválidos' })
    }

    const { email, password } = result.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return reply.status(401).send({ message: 'E-mail ou senha incorretos' })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return reply.status(401).send({ message: 'E-mail ou senha incorretos' })
    }

    const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' })
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    }
  })

  // GET /auth/me
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const payload = request.user as { id: number }
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    })
    return user
  })

  // PUT /auth/me
  app.put('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: 'Dados inválidos' })
    }

    const user = await prisma.user.update({
      where: { id: payload.id },
      data: result.data,
      select: { id: true, name: true, email: true, role: true }
    })

    return user
  })
}
