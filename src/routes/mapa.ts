/**
 * mapa.ts — Rota do Mapa da Propriedade
 *
 * Funcionalidades:
 *  - Salvar/atualizar polígono GeoJSON de uma fazenda (área total)
 *  - Gerenciar talhões (subdivisões da fazenda) com cultura plantada
 *  - Registrar posições de maquinários (tratores, colheitadeiras)
 *  - Histórico de rastreamento dos maquinários
 *
 * Rotas:
 *  GET    /mapa/fazenda/:id          → dados do mapa de uma fazenda
 *  PUT    /mapa/fazenda/:id/poligono → salva/atualiza polígono da fazenda
 *  GET    /mapa/talhoes/:fazendaId   → lista talhões de uma fazenda
 *  POST   /mapa/talhoes             → cria novo talhão
 *  PUT    /mapa/talhoes/:id         → edita talhão
 *  DELETE /mapa/talhoes/:id         → remove talhão
 *  GET    /mapa/maquinarios         → lista maquinários do usuário
 *  POST   /mapa/maquinarios         → cadastra maquinário
 *  PUT    /mapa/maquinarios/:id/posicao → atualiza posição GPS (Arduino/ESP32)
 *  GET    /mapa/maquinarios/:id/historico → histórico de posições
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Schemas de validação ─────────────────────────────────────────────────────

const poligonoSchema = z.object({
  // GeoJSON Feature com Polygon ou MultiPolygon
  geojson: z.string(), // JSON stringificado para flexibilidade
  areaHa:  z.number().positive().optional(),
})

const talhaoSchema = z.object({
  fazendaId:  z.number().int().positive(),
  nome:       z.string().min(1).max(100),
  cultura:    z.string().max(100).optional(),    // Soja, Milho, Pasto, etc.
  areaHa:     z.number().positive().optional(),
  cor:        z.string().max(20).optional(),     // cor HEX para exibição no mapa
  geojson:    z.string().optional(),             // polígono do talhão
  status:     z.enum(['plantado', 'colhido', 'em_preparo', 'vazio']).default('vazio'),
})

const talhaoUpdateSchema = talhaoSchema.partial().omit({ fazendaId: true })

const maquinarioSchema = z.object({
  nome:       z.string().min(1).max(100),   // "Trator John Deere 5075E"
  tipo:       z.enum(['trator', 'colheitadeira', 'pulverizador', 'caminhao', 'outro']),
  placa:      z.string().max(20).optional(),
  modelo:     z.string().max(100).optional(),
  ano:        z.number().int().optional(),
  token:      z.string().optional(),        // token do dispositivo GPS embarcado
})

const posicaoSchema = z.object({
  latitude:   z.number().min(-90).max(90),
  longitude:  z.number().min(-180).max(180),
  velocidade: z.number().min(0).optional(), // km/h
  direcao:    z.number().min(0).max(360).optional(), // graus
  token:      z.string(),                   // token do maquinário para autenticação IoT
})

// ─── Plugin Fastify ───────────────────────────────────────────────────────────

export async function mapaRoutes(app: FastifyInstance) {

  // ── GET /mapa/fazenda/:id ────────────────────────────────────────────────────
  // Retorna todos os dados de mapa de uma fazenda (polígono + talhões + maquinários ativos)
  app.get('/mapa/fazenda/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    // Verifica que a fazenda pertence ao usuário
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: parseInt(id), userId: payload.id },
      select: {
        id: true, nome: true, latitude: true, longitude: true,
        areaHa: true, localizacao: true,
        mapaPoligono: true,  // GeoJSON da área total
      },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    // Talhões da fazenda
    const talhoes = await prisma.talhao.findMany({
      where:   { fazendaId: parseInt(id) },
      orderBy: { nome: 'asc' },
    })

    // Maquinários com última posição conhecida
    const maquinarios = await prisma.maquinario.findMany({
      where:   { userId: payload.id, ativo: true },
      include: {
        posicoes: {
          orderBy: { timestamp: 'desc' },
          take:    1, // só a última posição
        },
      },
    })

    return reply.send({ fazenda, talhoes, maquinarios })
  })

  // ── PUT /mapa/fazenda/:id/poligono ───────────────────────────────────────────
  // Salva ou atualiza o polígono GeoJSON da área total da fazenda
  app.put('/mapa/fazenda/:id/poligono', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }
    const result  = poligonoSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    const fazenda = await prisma.fazenda.findFirst({
      where: { id: parseInt(id), userId: payload.id },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    // Valida se o GeoJSON é válido antes de salvar
    try {
      JSON.parse(result.data.geojson)
    } catch {
      return reply.status(400).send({ error: 'GeoJSON inválido.' })
    }

    const atualizada = await prisma.fazenda.update({
      where: { id: parseInt(id) },
      data: {
        mapaPoligono: result.data.geojson,
        ...(result.data.areaHa ? { areaHa: result.data.areaHa } : {}),
      },
    })

    return reply.send(atualizada)
  })

  // ── GET /mapa/talhoes/:fazendaId ─────────────────────────────────────────────
  app.get('/mapa/talhoes/:fazendaId', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload      = request.user as { id: number }
    const { fazendaId } = request.params as { fazendaId: string }

    // Verifica posse da fazenda
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: parseInt(fazendaId), userId: payload.id },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    const talhoes = await prisma.talhao.findMany({
      where:   { fazendaId: parseInt(fazendaId) },
      orderBy: { nome: 'asc' },
    })

    return reply.send(talhoes)
  })

  // ── POST /mapa/talhoes ───────────────────────────────────────────────────────
  app.post('/mapa/talhoes', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const result  = talhaoSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    const fazenda = await prisma.fazenda.findFirst({
      where: { id: result.data.fazendaId, userId: payload.id },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    const talhao = await prisma.talhao.create({ data: result.data })
    return reply.status(201).send(talhao)
  })

  // ── PUT /mapa/talhoes/:id ────────────────────────────────────────────────────
  app.put('/mapa/talhoes/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }
    const result  = talhaoUpdateSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    // Verifica posse através da fazenda
    const talhao = await prisma.talhao.findFirst({
      where: { id: parseInt(id), fazenda: { userId: payload.id } },
    })
    if (!talhao) return reply.status(404).send({ error: 'Talhão não encontrado.' })

    const atualizado = await prisma.talhao.update({
      where: { id: parseInt(id) },
      data:  result.data,
    })

    return reply.send(atualizado)
  })

  // ── DELETE /mapa/talhoes/:id ─────────────────────────────────────────────────
  app.delete('/mapa/talhoes/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const talhao = await prisma.talhao.findFirst({
      where: { id: parseInt(id), fazenda: { userId: payload.id } },
    })
    if (!talhao) return reply.status(404).send({ error: 'Talhão não encontrado.' })

    await prisma.talhao.delete({ where: { id: parseInt(id) } })
    return reply.status(204).send()
  })

  // ── GET /mapa/maquinarios ────────────────────────────────────────────────────
  app.get('/mapa/maquinarios', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }

    const maquinarios = await prisma.maquinario.findMany({
      where: { userId: payload.id },
      include: {
        posicoes: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
      orderBy: { nome: 'asc' },
    })

    return reply.send(maquinarios)
  })

  // ── POST /mapa/maquinarios ───────────────────────────────────────────────────
  app.post('/mapa/maquinarios', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const result  = maquinarioSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    // Gera token único para o dispositivo GPS embarcado
    const { token: tokenCustom, ...dadosMaquinario } = result.data
    const maquinario = await prisma.maquinario.create({
      data: {
        ...dadosMaquinario,
        userId: payload.id,
        token:  tokenCustom || `maq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ativo:  true,
      },
    })

    return reply.status(201).send(maquinario)
  })

  // ── PUT /mapa/maquinarios/:id/posicao ────────────────────────────────────────
  // Endpoint público (autenticado via token do maquinário, não JWT do usuário)
  // Usado pelo Arduino/ESP32 embarcado no trator para enviar GPS em tempo real
  app.put('/mapa/maquinarios/:id/posicao', async (request, reply) => {
    const { id }  = request.params as { id: string }
    const result  = posicaoSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    // Autenticação via token do dispositivo (não JWT)
    const maquinario = await prisma.maquinario.findFirst({
      where: { id: parseInt(id), token: result.data.token, ativo: true },
    })
    if (!maquinario) return reply.status(401).send({ error: 'Token inválido.' })

    // Registra a nova posição no histórico
    const posicao = await prisma.posicaoMaquinario.create({
      data: {
        maquinarioId: parseInt(id),
        latitude:     result.data.latitude,
        longitude:    result.data.longitude,
        velocidade:   result.data.velocidade,
        direcao:      result.data.direcao,
      },
    })

    // Atualiza a última posição conhecida no próprio registro do maquinário
    await prisma.maquinario.update({
      where: { id: parseInt(id) },
      data: {
        ultimaLatitude:  result.data.latitude,
        ultimaLongitude: result.data.longitude,
        ultimaVez:       new Date(),
      },
    })

    return reply.send({ ok: true, posicaoId: posicao.id })
  })

  // ── GET /mapa/maquinarios/:id/historico ─────────────────────────────────────
  // Retorna trilha de posições das últimas 8 horas (para mostrar no mapa)
  app.get('/mapa/maquinarios/:id/historico', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const maquinario = await prisma.maquinario.findFirst({
      where: { id: parseInt(id), userId: payload.id },
    })
    if (!maquinario) return reply.status(404).send({ error: 'Maquinário não encontrado.' })

    const oitoHorasAtras = new Date(Date.now() - 8 * 60 * 60 * 1000)

    const historico = await prisma.posicaoMaquinario.findMany({
      where: {
        maquinarioId: parseInt(id),
        timestamp:    { gte: oitoHorasAtras },
      },
      orderBy: { timestamp: 'asc' },
      // Limita a 500 pontos para não sobrecarregar o mapa
      take: 500,
    })

    return reply.send(historico)
  })
}
