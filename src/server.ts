import Fastify, { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes } from './routes/auth'
import { fazendasRoutes } from './routes/fazendas'
import { sensoresRoutes } from './routes/sensores'
import { alertasRoutes } from './routes/alertas'
import { irrigacaoRoutes } from './routes/irrigacao'
import { dashboardRoutes } from './routes/dashboard'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const app = Fastify({ logger: true })

app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
})

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'agrosmart-secret-key-change-in-production'
})

app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ message: 'Token inválido ou expirado' })
  }
})

app.register(authRoutes, { prefix: '/auth' })
app.register(dashboardRoutes, { prefix: '/dashboard' })
app.register(fazendasRoutes, { prefix: '/fazendas' })
app.register(sensoresRoutes, { prefix: '/sensores' })
app.register(alertasRoutes, { prefix: '/alertas' })
app.register(irrigacaoRoutes, { prefix: '/irrigacao' })

app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const PORT = Number(process.env.PORT) || 3333

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1) }
  console.log(`Servidor rodando na porta ${PORT}`)
})

export { app }
