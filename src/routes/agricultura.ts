// ============================================================================
// ROTA: /aquicultura
// ============================================================================
// Módulo de gestão de aquicultura e piscicultura: tanques, ciclos
// produtivos, qualidade da água e controle de ração.
//
// Alertas automáticos gerados ao registrar medições de água fora dos
// limites ideais (pH, O2, temperatura, amônia).
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

// Espécies suportadas
const ESPECIES = ['Tilápia', 'Tambaqui', 'Pacu', 'Pintado', 'Trutas', 'Camarão', 'Outro'] as const

// ----------------------------------------------------------------------------
// LIMITES DE QUALIDADE DA ÁGUA
// Valores fora desses intervalos geram alertas automáticos.
// Ajustáveis conforme a espécie — aqui são limites gerais seguros.
// ----------------------------------------------------------------------------
const LIMITES_AGUA = {
  ph:         { min: 6.5, max: 8.5 },
  oxigenio:   { min: 5.0, max: null, critico: 3.0 },  // mg/L — abaixo de 3 = crítico
  temperatura:{ min: 18,  max: 30 },                   // °C
  amonia:     { min: null, max: 0.5, critico: 1.0 }    // mg/L — acima de 1 = crítico
}

/**
 * Verifica se um valor está fora dos limites e retorna o nível de alerta.
 */
function avaliarParametro(
  nome: string,
  valor: number | null | undefined,
  limites: { min?: number | null; max?: number | null; critico?: number }
): { alerta: boolean; critico: boolean; msg: string } {
  if (valor == null) return { alerta: false, critico: false, msg: '' }

  if (limites.critico !== undefined) {
    if (nome === 'oxigenio' && valor <= limites.critico) {
      return { alerta: true, critico: true, msg: `O2 crítico: ${valor} mg/L (mínimo crítico: ${limites.critico})` }
    }
    if (nome === 'amonia' && valor >= limites.critico) {
      return { alerta: true, critico: true, msg: `Amônia crítica: ${valor} mg/L (máximo crítico: ${limites.critico})` }
    }
  }

  if (limites.min !== null && limites.min !== undefined && valor < limites.min) {
    return { alerta: true, critico: false, msg: `${nome} baixo: ${valor} (mínimo: ${limites.min})` }
  }
  if (limites.max !== null && limites.max !== undefined && valor > limites.max) {
    return { alerta: true, critico: false, msg: `${nome} alto: ${valor} (máximo: ${limites.max})` }
  }

  return { alerta: false, critico: false, msg: '' }
}

export async function aquiculturaRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => {
    await app.authenticate(req, rep)
  }

  // ==========================================================================
  // RESUMO
  // ==========================================================================

  // GET /aquicultura/resumo
  // Painel consolidado: tanques ativos, ciclos em andamento, última
  // medição de cada tanque.
  app.get('/resumo', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    const tanques = await prisma.tanque.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) })
      },
      include: {
        _count: { select: { ciclos: true } },
        ciclos: { where: { dataFim: null }, take: 1 },
        medicoeQualidade: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })

    const emProducao = tanques.filter(t => t.status === 'em_producao').length
    const ciclosAtivos = tanques.reduce((acc, t) => acc + (t.ciclos.length > 0 ? 1 : 0), 0)

    return {
      totalTanques: tanques.length,
      tanquesEmProducao: emProducao,
      ciclosAtivos,
      tanques: tanques.map(t => ({
        id: t.id,
        nome: t.nome,
        especie: t.especie,
        status: t.status,
        cicloAtivo: t.ciclos[0] || null,
        ultimaMedicao: t.medicoeQualidade[0] || null
      }))
    }
  })

  // ==========================================================================
  // TANQUES
  // ==========================================================================

  app.get('/tanques', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    return prisma.tanque.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) })
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
        ciclos: { where: { dataFim: null }, take: 1 },
        medicoeQualidade: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { ciclos: true, racoes: true } }
      },
      orderBy: { nome: 'asc' }
    })
  })

  app.post('/tanques', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1),
      especie: z.enum(ESPECIES),
      volumeM3: z.number().positive().optional(),
      areaMt2: z.number().positive().optional(),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data
    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    return reply.status(201).send(await prisma.tanque.create({
      data: {
        nome: data.nome,
        especie: data.especie,
        volumeM3: data.volumeM3 ?? null,
        areaMt2: data.areaMt2 ?? null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    }))
  })

  app.put('/tanques/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1).optional(),
      especie: z.enum(ESPECIES).optional(),
      volumeM3: z.number().positive().optional().or(z.null()),
      areaMt2: z.number().positive().optional().or(z.null()),
      status: z.enum(['vazio', 'em_preparo', 'em_producao', 'despescado']).optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Tanque não encontrado' })

    const d = result.data
    return prisma.tanque.update({
      where: { id: Number(id) },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.especie !== undefined && { especie: d.especie }),
        ...(d.volumeM3 !== undefined && { volumeM3: d.volumeM3 }),
        ...(d.areaMt2 !== undefined && { areaMt2: d.areaMt2 }),
        ...(d.status !== undefined && { status: d.status })
      }
    })
  })

  app.delete('/tanques/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Tanque não encontrado' })

    // Cascata: remove medições, rações e ciclos antes de remover o tanque
    await prisma.medicaoAgua.deleteMany({ where: { tanqueId: Number(id) } })
    await prisma.registroRacao.deleteMany({ where: { tanqueId: Number(id) } })
    await prisma.cicloProdutivo.deleteMany({ where: { tanqueId: Number(id) } })
    await prisma.tanque.delete({ where: { id: Number(id) } })

    return reply.status(204).send()
  })

  // ==========================================================================
  // CICLOS PRODUTIVOS
  // ==========================================================================

  app.get('/tanques/:id/ciclos', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const tanque = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    const ciclos = await prisma.cicloProdutivo.findMany({
      where: { tanqueId: Number(id) },
      orderBy: { dataInicio: 'desc' }
    })

    // Calcula métricas de cada ciclo concluído
    return ciclos.map(c => {
      const diasCiclo = c.dataFim
        ? Math.round((c.dataFim.getTime() - c.dataInicio.getTime()) / (1000 * 60 * 60 * 24))
        : Math.round((Date.now() - c.dataInicio.getTime()) / (1000 * 60 * 60 * 24))

      const ganhoKg = c.pesoTotalKg ?? null
      const mortPercent = c.quantidadeDespescada != null
        ? (((c.quantidadeInicial - c.quantidadeDespescada) / c.quantidadeInicial) * 100).toFixed(1)
        : null

      return { ...c, diasCiclo, ganhoKg, mortPercent }
    })
  })

  // Inicia um novo ciclo (povoamento do tanque)
  app.post('/tanques/:id/ciclos', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      especie: z.enum(ESPECIES),
      quantidadeInicial: z.number().int().positive(),
      pesoMedioInicial: z.number().positive().optional(),
      dataInicio: z.string().datetime(),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const tanque = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    // Verifica se já existe um ciclo em andamento
    const cicloAtivo = await prisma.cicloProdutivo.findFirst({ where: { tanqueId: Number(id), dataFim: null } })
    if (cicloAtivo) return reply.status(400).send({ message: 'Tanque já possui um ciclo em andamento. Encerre-o antes de iniciar novo.' })

    const data = result.data
    const [ciclo] = await prisma.$transaction([
      prisma.cicloProdutivo.create({
        data: {
          especie: data.especie,
          quantidadeInicial: data.quantidadeInicial,
          pesoMedioInicial: data.pesoMedioInicial ?? null,
          dataInicio: new Date(data.dataInicio),
          observacao: data.observacao || null,
          tanque: { connect: { id: Number(id) } }
        }
      }),
      // Atualiza status do tanque para "em_producao"
      prisma.tanque.update({ where: { id: Number(id) }, data: { status: 'em_producao' } })
    ])

    return reply.status(201).send(ciclo)
  })

  // Encerra um ciclo (despesca)
  app.put('/ciclos/:id/despesca', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      dataFim: z.string().datetime(),
      quantidadeDespescada: z.number().int().positive().optional(),
      pesoTotalKg: z.number().positive().optional(),
      valorVenda: z.number().positive().optional(),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const ciclo = await prisma.cicloProdutivo.findFirst({
      where: { id: Number(id), tanque: { fazenda: { userId: payload.id } } }
    })
    if (!ciclo) return reply.status(404).send({ message: 'Ciclo não encontrado' })

    const data = result.data
    const [cicloAtualizado] = await prisma.$transaction([
      prisma.cicloProdutivo.update({
        where: { id: Number(id) },
        data: {
          dataFim: new Date(data.dataFim),
          quantidadeDespescada: data.quantidadeDespescada ?? null,
          pesoTotalKg: data.pesoTotalKg ?? null,
          valorVenda: data.valorVenda ?? null,
          observacao: data.observacao ?? ciclo.observacao
        }
      }),
      // Atualiza status do tanque para "despescado"
      prisma.tanque.update({ where: { id: ciclo.tanqueId }, data: { status: 'despescado' } })
    ])

    return cicloAtualizado
  })

  // ==========================================================================
  // QUALIDADE DA ÁGUA
  // ==========================================================================

  app.get('/tanques/:id/medicoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }
    const { limit } = request.query as { limit?: string }

    const tanque = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    return prisma.medicaoAgua.findMany({
      where: { tanqueId: Number(id) },
      orderBy: { createdAt: 'desc' },
      take: Number(limit) || 20
    })
  })

  // POST /aquicultura/tanques/:id/medicoes
  // Registra medição de qualidade da água e gera alertas automáticos
  // para parâmetros fora dos limites ideais.
  app.post('/tanques/:id/medicoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      ph: z.number().optional(),
      oxigenio: z.number().min(0).optional(),
      temperatura: z.number().optional(),
      amonia: z.number().min(0).optional(),
      turbidez: z.number().min(0).optional(),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const tanque = await prisma.tanque.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } },
      include: { fazenda: { select: { id: true, nome: true } } }
    })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    const d = result.data
    const medicao = await prisma.medicaoAgua.create({
      data: {
        ph: d.ph ?? null,
        oxigenio: d.oxigenio ?? null,
        temperatura: d.temperatura ?? null,
        amonia: d.amonia ?? null,
        turbidez: d.turbidez ?? null,
        observacao: d.observacao || null,
        tanque: { connect: { id: Number(id) } }
      }
    })

    // Avalia parâmetros e gera alertas
    const avaliacoes = [
      avaliarParametro('ph', d.ph, LIMITES_AGUA.ph),
      avaliarParametro('oxigenio', d.oxigenio, LIMITES_AGUA.oxigenio),
      avaliarParametro('temperatura', d.temperatura, LIMITES_AGUA.temperatura),
      avaliarParametro('amonia', d.amonia, LIMITES_AGUA.amonia)
    ].filter(a => a.alerta)

    for (const avaliacao of avaliacoes) {
      const titulo = `Qualidade da água: ${tanque.nome}`
      const existeAlerta = await prisma.alerta.findFirst({
        where: {
          fazendaId: tanque.fazenda.id,
          descricao: { contains: avaliacao.msg },
          createdAt: { gte: new Date(Date.now() - 4 * 3600 * 1000) }
        }
      })
      if (!existeAlerta) {
        await prisma.alerta.create({
          data: {
            tipo: avaliacao.critico ? 'danger' : 'warning',
            titulo,
            descricao: `${avaliacao.msg} — ${tanque.nome} (${tanque.especie})`,
            fazendaId: tanque.fazenda.id
          }
        })
      }
    }

    return reply.status(201).send({ medicao, alertas: avaliacoes.length })
  })

  // ==========================================================================
  // RAÇÃO
  // ==========================================================================

  app.get('/tanques/:id/racoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const tanque = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    return prisma.registroRacao.findMany({
      where: { tanqueId: Number(id) },
      orderBy: { createdAt: 'desc' },
      take: 30
    })
  })

  app.post('/tanques/:id/racoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      tipoRacao: z.string().min(1),
      quantidadeKg: z.number().positive(),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const tanque = await prisma.tanque.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!tanque) return reply.status(404).send({ message: 'Tanque não encontrado' })

    return reply.status(201).send(await prisma.registroRacao.create({
      data: {
        tipoRacao: result.data.tipoRacao,
        quantidadeKg: result.data.quantidadeKg,
        observacao: result.data.observacao || null,
        tanque: { connect: { id: Number(id) } }
      }
    }))
  })

  // Resumo de ração e FCR de um ciclo
  // FCR = Total de ração (kg) / Peso total produzido (kg)
  app.get('/ciclos/:id/fcr', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const ciclo = await prisma.cicloProdutivo.findFirst({
      where: { id: Number(id), tanque: { fazenda: { userId: payload.id } } }
    })
    if (!ciclo) return reply.status(404).send({ message: 'Ciclo não encontrado' })

    const racoes = await prisma.registroRacao.findMany({
      where: {
        tanqueId: ciclo.tanqueId,
        createdAt: {
          gte: ciclo.dataInicio,
          ...(ciclo.dataFim && { lte: ciclo.dataFim })
        }
      }
    })

    const totalRacaoKg = racoes.reduce((acc, r) => acc + r.quantidadeKg, 0)
    const fcr = ciclo.pesoTotalKg && totalRacaoKg > 0
      ? (totalRacaoKg / ciclo.pesoTotalKg).toFixed(2)
      : null

    return {
      totalRacaoKg,
      pesoProducaoKg: ciclo.pesoTotalKg ?? null,
      fcr,
      registros: racoes.length
    }
  })
}
