// ============================================================================
// ROTA: /pecuaria
// ============================================================================
// Módulo de gestão de rebanho: lotes, animais individuais, vacinações,
// registro de peso e GTA (Guia de Trânsito Animal).
//
// Organização:
//   /pecuaria/lotes              → CRUD de lotes
//   /pecuaria/lotes/:id/animais  → animais de um lote
//   /pecuaria/animais/:id/peso   → histórico de pesagens
//   /pecuaria/vacinacoes         → vacinações (lote e animal)
//   /pecuaria/gtas               → GTAs com alertas de vencimento
//   /pecuaria/resumo             → painel consolidado do rebanho
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

const ESPECIES = ['Bovino', 'Suíno', 'Aves', 'Equino', 'Ovino', 'Caprino', 'Outro'] as const
const DIAS_AVISO_GTA = 3         // alerta 3 dias antes da GTA vencer
const DIAS_AVISO_VACINA = 15     // alerta 15 dias antes da próxima dose

/**
 * Calcula status de um item com data de vencimento.
 * Reutilizado para GTAs e vacinações.
 */
function calcularStatusVencimento(data: Date | null, diasAviso: number) {
  if (!data) return 'sem_data'
  const diff = (data.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'vencido'
  if (diff <= diasAviso) return 'vencendo'
  return 'valido'
}

export async function pecuariaRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => {
    await app.authenticate(req, rep)
  }

  // ==========================================================================
  // RESUMO DO REBANHO
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /pecuaria/resumo
  // Painel consolidado: total de animais, lotes ativos, vacinas próximas
  // e GTAs vencendo — tudo em uma só chamada para o dashboard.
  // Query: ?fazendaId=  (opcional)
  // --------------------------------------------------------------------
  app.get('/resumo', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    const filtro = {
      fazenda: { userId: payload.id },
      ...(fazendaId && { fazendaId: Number(fazendaId) })
    }

    const [lotes, gtas, vacinacoesLote] = await Promise.all([
      prisma.lote.findMany({
        where: filtro,
        include: { _count: { select: { animais: true } } }
      }),
      prisma.gta.findMany({
        where: { ...filtro, status: 'ativa' },
        orderBy: { dataVencimento: 'asc' }
      }),
      prisma.vacinacaoLote.findMany({
        where: { lote: filtro },
        orderBy: { dataProxima: 'asc' }
      })
    ])

    const totalAnimais = lotes.reduce((acc, l) => acc + l._count.animais, 0)
    const gtasVencendo = gtas.filter(g => calcularStatusVencimento(g.dataVencimento, DIAS_AVISO_GTA) !== 'valido')
    const vacinasProximas = vacinacoesLote.filter(v =>
      v.dataProxima && calcularStatusVencimento(v.dataProxima, DIAS_AVISO_VACINA) !== 'valido'
    )

    return {
      totalLotes: lotes.length,
      totalAnimais,
      gtasVencendo: gtasVencendo.length,
      vacinasProximas: vacinasProximas.length,
      porEspecie: lotes.reduce((acc: Record<string, number>, l) => {
        acc[l.especie] = (acc[l.especie] || 0) + l._count.animais
        return acc
      }, {})
    }
  })

  // ==========================================================================
  // LOTES
  // ==========================================================================

  app.get('/lotes', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    return prisma.lote.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) })
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
        _count: { select: { animais: true } }
      },
      orderBy: { nome: 'asc' }
    })
  })

  app.post('/lotes', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1),
      especie: z.enum(ESPECIES),
      categoria: z.string().min(1),
      localizacao: z.string().optional(),
      observacao: z.string().optional(),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data
    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    return reply.status(201).send(await prisma.lote.create({
      data: {
        nome: data.nome,
        especie: data.especie,
        categoria: data.categoria,
        localizacao: data.localizacao || null,
        observacao: data.observacao || null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    }))
  })

  app.put('/lotes/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1).optional(),
      especie: z.enum(ESPECIES).optional(),
      categoria: z.string().optional(),
      localizacao: z.string().optional().or(z.null()),
      observacao: z.string().optional().or(z.null())
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Lote não encontrado' })

    const d = result.data
    return prisma.lote.update({
      where: { id: Number(id) },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.especie !== undefined && { especie: d.especie }),
        ...(d.categoria !== undefined && { categoria: d.categoria }),
        ...(d.localizacao !== undefined && { localizacao: d.localizacao }),
        ...(d.observacao !== undefined && { observacao: d.observacao })
      }
    })
  })

  app.delete('/lotes/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Lote não encontrado' })

    // Remove dependentes em cascata
    const animais = await prisma.animal.findMany({ where: { loteId: Number(id) } })
    for (const a of animais) {
      await prisma.registroPeso.deleteMany({ where: { animalId: a.id } })
      await prisma.vacinacaoAnimal.deleteMany({ where: { animalId: a.id } })
    }
    await prisma.animal.deleteMany({ where: { loteId: Number(id) } })
    await prisma.vacinacaoLote.deleteMany({ where: { loteId: Number(id) } })
    await prisma.gta.updateMany({ where: { loteId: Number(id) }, data: { loteId: null } })
    await prisma.lote.delete({ where: { id: Number(id) } })

    return reply.status(204).send()
  })

  // ==========================================================================
  // ANIMAIS
  // ==========================================================================

  app.get('/lotes/:id/animais', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const lote = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!lote) return reply.status(404).send({ message: 'Lote não encontrado' })

    return prisma.animal.findMany({
      where: { loteId: Number(id) },
      include: {
        pesos: { orderBy: { data: 'desc' }, take: 1 },
        _count: { select: { vacinacoes: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  })

  app.post('/lotes/:id/animais', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      numeroBrinco: z.string().optional(),
      nome: z.string().optional(),
      sexo: z.enum(['M', 'F']),
      dataNascimento: z.string().datetime().optional().or(z.literal('')),
      raca: z.string().optional(),
      peso: z.number().positive().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const lote = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!lote) return reply.status(404).send({ message: 'Lote não encontrado' })

    const d = result.data
    const animal = await prisma.animal.create({
      data: {
        numeroBrinco: d.numeroBrinco || null,
        nome: d.nome || null,
        sexo: d.sexo,
        dataNascimento: d.dataNascimento ? new Date(d.dataNascimento) : null,
        raca: d.raca || null,
        peso: d.peso ?? null,
        lote: { connect: { id: Number(id) } }
      }
    })

    // Se peso foi informado, cria o primeiro registro de pesagem
    if (d.peso) {
      await prisma.registroPeso.create({
        data: { animalId: animal.id, peso: d.peso, observacao: 'Peso inicial' }
      })
    }

    return reply.status(201).send(animal)
  })

  app.put('/animais/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      numeroBrinco: z.string().optional().or(z.null()),
      nome: z.string().optional().or(z.null()),
      sexo: z.enum(['M', 'F']).optional(),
      dataNascimento: z.string().datetime().optional().or(z.null()),
      raca: z.string().optional().or(z.null()),
      status: z.enum(['ativo', 'vendido', 'morto', 'transferido']).optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.animal.findFirst({
      where: { id: Number(id), lote: { fazenda: { userId: payload.id } } }
    })
    if (!existente) return reply.status(404).send({ message: 'Animal não encontrado' })

    const d = result.data
    return prisma.animal.update({
      where: { id: Number(id) },
      data: {
        ...(d.numeroBrinco !== undefined && { numeroBrinco: d.numeroBrinco }),
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.sexo !== undefined && { sexo: d.sexo }),
        ...(d.dataNascimento !== undefined && { dataNascimento: d.dataNascimento ? new Date(d.dataNascimento) : null }),
        ...(d.raca !== undefined && { raca: d.raca }),
        ...(d.status !== undefined && { status: d.status })
      }
    })
  })

  // Pesagem de animal individual
  app.post('/animais/:id/peso', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({ peso: z.number().positive(), observacao: z.string().optional() })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const animal = await prisma.animal.findFirst({
      where: { id: Number(id), lote: { fazenda: { userId: payload.id } } }
    })
    if (!animal) return reply.status(404).send({ message: 'Animal não encontrado' })

    const d = result.data
    const [registro] = await prisma.$transaction([
      prisma.registroPeso.create({ data: { animalId: Number(id), peso: d.peso, observacao: d.observacao || null } }),
      prisma.animal.update({ where: { id: Number(id) }, data: { peso: d.peso } })
    ])

    return reply.status(201).send(registro)
  })

  // ==========================================================================
  // VACINAÇÕES
  // ==========================================================================

  // Vacinação em lote inteiro
  app.post('/lotes/:id/vacinacao', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      vacina: z.string().min(1),
      dataAplicacao: z.string().datetime(),
      dataProxima: z.string().datetime().optional().or(z.literal('')),
      responsavel: z.string().optional(),
      dosesAplicadas: z.number().int().min(0).default(0),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const lote = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!lote) return reply.status(404).send({ message: 'Lote não encontrado' })

    const d = result.data
    return reply.status(201).send(await prisma.vacinacaoLote.create({
      data: {
        vacina: d.vacina,
        lote: { connect: { id: Number(id) } },
        dataAplicacao: new Date(d.dataAplicacao),
        dataProxima: d.dataProxima ? new Date(d.dataProxima) : null,
        responsavel: d.responsavel || null,
        dosesAplicadas: d.dosesAplicadas,
        observacao: d.observacao || null
      }
    }))
  })

  app.get('/lotes/:id/vacinacoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const lote = await prisma.lote.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!lote) return reply.status(404).send({ message: 'Lote não encontrado' })

    const vacinacoes = await prisma.vacinacaoLote.findMany({
      where: { loteId: Number(id) },
      orderBy: { dataAplicacao: 'desc' }
    })

    return vacinacoes.map(v => ({
      ...v,
      statusProxima: calcularStatusVencimento(v.dataProxima, DIAS_AVISO_VACINA)
    }))
  })

  // ==========================================================================
  // GTAs (Guia de Trânsito Animal)
  // ==========================================================================

  app.get('/gtas', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    const gtas = await prisma.gta.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) })
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
        lote: { select: { id: true, nome: true, especie: true } }
      },
      orderBy: { dataVencimento: 'asc' }
    })

    return gtas.map(g => ({
      ...g,
      statusVencimento: calcularStatusVencimento(g.dataVencimento, DIAS_AVISO_GTA)
    }))
  })

  app.post('/gtas', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      numero: z.string().optional(),
      tipo: z.enum(['Compra', 'Venda', 'Exposição', 'Transferência', 'Outro']),
      destino: z.string().min(1),
      quantidadeAnimais: z.number().int().positive(),
      especie: z.string().min(1),
      dataEmissao: z.string().datetime(),
      dataVencimento: z.string().datetime(),
      arquivoUrl: z.string().url().optional(),
      loteId: z.number().optional().or(z.null()),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data
    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const gta = await prisma.gta.create({
      data: {
        numero: data.numero || null,
        tipo: data.tipo,
        destino: data.destino,
        quantidadeAnimais: data.quantidadeAnimais,
        especie: data.especie,
        dataEmissao: new Date(data.dataEmissao),
        dataVencimento: new Date(data.dataVencimento),
        arquivoUrl: data.arquivoUrl || null,
        loteId: data.loteId ?? null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    return reply.status(201).send({ ...gta, statusVencimento: calcularStatusVencimento(gta.dataVencimento, DIAS_AVISO_GTA) })
  })

  app.put('/gtas/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      numero: z.string().optional().or(z.null()),
      status: z.enum(['ativa', 'utilizada', 'vencida']).optional(),
      arquivoUrl: z.string().url().optional().or(z.null())
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.gta.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'GTA não encontrada' })

    const d = result.data
    return prisma.gta.update({
      where: { id: Number(id) },
      data: {
        ...(d.numero !== undefined && { numero: d.numero }),
        ...(d.status !== undefined && { status: d.status }),
        ...(d.arquivoUrl !== undefined && { arquivoUrl: d.arquivoUrl })
      }
    })
  })

  app.delete('/gtas/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.gta.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'GTA não encontrada' })

    await prisma.gta.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })

  // ==========================================================================
  // VERIFICAR VENCIMENTOS (chamado pelo frontend ao abrir a tela)
  // ==========================================================================

  app.post('/verificar-vencimentos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    let alertasGerados = 0

    // Verifica GTAs vencendo
    const gtas = await prisma.gta.findMany({
      where: { fazenda: { userId: payload.id }, status: 'ativa' },
      include: { fazenda: { select: { id: true, nome: true } } }
    })

    for (const gta of gtas) {
      const status = calcularStatusVencimento(gta.dataVencimento, DIAS_AVISO_GTA)
      if (status === 'valido') continue

      const titulo = status === 'vencido'
        ? `GTA vencida — ${gta.tipo}`
        : `GTA vence em breve — ${gta.tipo}`

      const existeAlerta = await prisma.alerta.findFirst({
        where: { fazendaId: gta.fazendaId, titulo, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } }
      })

      if (!existeAlerta) {
        await prisma.alerta.create({
          data: {
            tipo: status === 'vencido' ? 'danger' : 'warning',
            titulo,
            descricao: `GTA ${gta.numero ? '#' + gta.numero : ''} de ${gta.tipo.toLowerCase()} para ${gta.destino} vence em ${gta.dataVencimento.toLocaleDateString('pt-BR')}.`,
            fazendaId: gta.fazendaId
          }
        })
        alertasGerados++
      }
    }

    // Verifica vacinações com próxima dose próxima
    const vacinacoes = await prisma.vacinacaoLote.findMany({
      where: { lote: { fazenda: { userId: payload.id } }, dataProxima: { not: null } },
      include: { lote: { include: { fazenda: { select: { id: true } } } } }
    })

    for (const v of vacinacoes) {
      const status = calcularStatusVencimento(v.dataProxima, DIAS_AVISO_VACINA)
      if (status === 'valido') continue

      const titulo = `Vacinação pendente: ${v.vacina} — ${v.lote.nome}`

      const existeAlerta = await prisma.alerta.findFirst({
        where: { fazendaId: v.lote.fazenda.id, titulo, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } }
      })

      if (!existeAlerta) {
        await prisma.alerta.create({
          data: {
            tipo: status === 'vencido' ? 'danger' : 'warning',
            titulo,
            descricao: `Próxima dose de ${v.vacina} para o lote "${v.lote.nome}" prevista para ${v.dataProxima?.toLocaleDateString('pt-BR')}.`,
            fazendaId: v.lote.fazenda.id
          }
        })
        alertasGerados++
      }
    }

    return { alertasGerados }
  })
}
