// ============================================================================
// ROTA: /financeiro
// ============================================================================
// Gestão financeira rural: lançamentos de receitas/despesas (Transacao) e
// controle de financiamentos/CPR (Financiamento), com:
//   - CRUD completo de transações e financiamentos
//   - Resumo financeiro (totais, saldo, breakdown por categoria)
//   - Geração automática de alertas para financiamentos vencendo/vencidos
//     (mesmo padrão usado em /documentos)
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

// Categorias sugeridas (o frontend usa essa lista, mas o campo é livre/string
// para não travar o usuário em categorias pré-definidas)
export const CATEGORIAS_RECEITA = ['Venda de produção', 'Arrendamento', 'Subsídio/Incentivo', 'Outros'] as const
export const CATEGORIAS_DESPESA = ['Insumos', 'Maquinário', 'Mão de obra', 'Combustível', 'Manutenção', 'Impostos/Taxas', 'Outros'] as const

const DIAS_AVISO_VENCIMENTO_FINANCIAMENTO = 15

/**
 * Calcula o status de um financiamento com base na data de vencimento.
 * Reaproveita a mesma lógica usada para documentos (ver routes/documentos.ts).
 */
function calcularStatusFinanciamento(
  dataVencimento: Date | null,
  statusAtual: string
): 'pago' | 'vencido' | 'vencendo' | 'ativo' {
  if (statusAtual === 'pago') return 'pago'
  if (!dataVencimento) return 'ativo'

  const diffDias = (dataVencimento.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diffDias < 0) return 'vencido'
  if (diffDias <= DIAS_AVISO_VENCIMENTO_FINANCIAMENTO) return 'vencendo'
  return 'ativo'
}

export async function financeiroRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => { await app.authenticate(req, rep) }

  // ==========================================================================
  // TRANSAÇÕES (Receitas e Despesas)
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /financeiro/transacoes
  // Lista transações do usuário, com filtros opcionais via query string:
  //   ?fazendaId=1        -> filtra por fazenda
  //   ?tipo=receita        -> "receita" | "despesa"
  //   ?inicio=2026-01-01&fim=2026-01-31 -> filtra por período (ISO date)
  // --------------------------------------------------------------------
  app.get('/transacoes', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId, tipo, inicio, fim } = request.query as {
      fazendaId?: string; tipo?: string; inicio?: string; fim?: string
    }

    return prisma.transacao.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) }),
        ...(tipo && { tipo }),
        ...(inicio || fim
          ? {
              data: {
                ...(inicio && { gte: new Date(inicio) }),
                ...(fim && { lte: new Date(fim) })
              }
            }
          : {})
      },
      include: { fazenda: { select: { id: true, nome: true } } },
      orderBy: { data: 'desc' }
    })
  })

  // --------------------------------------------------------------------
  // POST /financeiro/transacoes
  // Cria um novo lançamento (receita ou despesa)
  // --------------------------------------------------------------------
  app.post('/transacoes', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      tipo: z.enum(['receita', 'despesa']),
      categoria: z.string().min(1),
      descricao: z.string().min(1),
      valor: z.number().positive('O valor deve ser maior que zero'),
      data: z.string().datetime(),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data

    // Garante que a fazenda pertence ao usuário autenticado
    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const transacao = await prisma.transacao.create({
      data: {
        tipo: data.tipo,
        categoria: data.categoria,
        descricao: data.descricao,
        valor: data.valor,
        data: new Date(data.data),
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    return reply.status(201).send(transacao)
  })

  // --------------------------------------------------------------------
  // PUT /financeiro/transacoes/:id
  // --------------------------------------------------------------------
  app.put('/transacoes/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      tipo: z.enum(['receita', 'despesa']).optional(),
      categoria: z.string().min(1).optional(),
      descricao: z.string().min(1).optional(),
      valor: z.number().positive().optional(),
      data: z.string().datetime().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.transacao.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Transação não encontrada' })

    const d = result.data
    return prisma.transacao.update({
      where: { id: Number(id) },
      data: {
        ...(d.tipo !== undefined && { tipo: d.tipo }),
        ...(d.categoria !== undefined && { categoria: d.categoria }),
        ...(d.descricao !== undefined && { descricao: d.descricao }),
        ...(d.valor !== undefined && { valor: d.valor }),
        ...(d.data !== undefined && { data: new Date(d.data) })
      }
    })
  })

  // --------------------------------------------------------------------
  // DELETE /financeiro/transacoes/:id
  // --------------------------------------------------------------------
  app.delete('/transacoes/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.transacao.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Transação não encontrada' })

    await prisma.transacao.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })

  // --------------------------------------------------------------------
  // GET /financeiro/resumo
  // Retorna totais consolidados para o período/fazenda informados:
  //   - total de receitas, despesas e saldo
  //   - breakdown de despesas por categoria (para gráficos)
  //   - breakdown de receitas por categoria
  // Query params: ?fazendaId=&inicio=&fim=  (mesmos filtros de /transacoes)
  // --------------------------------------------------------------------
  app.get('/resumo', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId, inicio, fim } = request.query as { fazendaId?: string; inicio?: string; fim?: string }

    const transacoes = await prisma.transacao.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) }),
        ...(inicio || fim
          ? { data: { ...(inicio && { gte: new Date(inicio) }), ...(fim && { lte: new Date(fim) }) } }
          : {})
      }
    })

    let totalReceitas = 0
    let totalDespesas = 0
    const porCategoria: Record<string, { receita: number; despesa: number }> = {}

    for (const t of transacoes) {
      if (t.tipo === 'receita') totalReceitas += t.valor
      else totalDespesas += t.valor

      if (!porCategoria[t.categoria]) porCategoria[t.categoria] = { receita: 0, despesa: 0 }
      porCategoria[t.categoria][t.tipo as 'receita' | 'despesa'] += t.valor
    }

    return {
      totalReceitas,
      totalDespesas,
      saldo: totalReceitas - totalDespesas,
      totalLancamentos: transacoes.length,
      porCategoria
    }
  })

  // ==========================================================================
  // FINANCIAMENTOS / CPR
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /financeiro/financiamentos
  // Lista financiamentos/CPR com status calculado dinamicamente
  // --------------------------------------------------------------------
  app.get('/financiamentos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }

    const financiamentos = await prisma.financiamento.findMany({
      where: { fazenda: { userId: payload.id } },
      include: { fazenda: { select: { id: true, nome: true } } },
      orderBy: { dataVencimento: 'asc' }
    })

    return financiamentos.map((f) => ({
      ...f,
      statusCalculado: calcularStatusFinanciamento(f.dataVencimento, f.status)
    }))
  })

  // --------------------------------------------------------------------
  // POST /financeiro/financiamentos
  // --------------------------------------------------------------------
  app.post('/financiamentos', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      tipo: z.enum(['CPR', 'Financiamento', 'Outro']),
      instituicao: z.string().min(1),
      descricao: z.string().optional(),
      valor: z.number().positive(),
      taxaJuros: z.number().optional(),
      dataContratacao: z.string().datetime().optional().or(z.literal('')),
      dataVencimento: z.string().datetime().optional().or(z.literal('')),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data
    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const financiamento = await prisma.financiamento.create({
      data: {
        tipo: data.tipo,
        instituicao: data.instituicao,
        descricao: data.descricao || null,
        valor: data.valor,
        taxaJuros: data.taxaJuros ?? null,
        dataContratacao: data.dataContratacao ? new Date(data.dataContratacao) : null,
        dataVencimento: data.dataVencimento ? new Date(data.dataVencimento) : null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    return reply.status(201).send({
      ...financiamento,
      statusCalculado: calcularStatusFinanciamento(financiamento.dataVencimento, financiamento.status)
    })
  })

  // --------------------------------------------------------------------
  // PUT /financeiro/financiamentos/:id
  // Permite, entre outras coisas, marcar como "pago"
  // --------------------------------------------------------------------
  app.put('/financiamentos/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      tipo: z.enum(['CPR', 'Financiamento', 'Outro']).optional(),
      instituicao: z.string().min(1).optional(),
      descricao: z.string().optional().or(z.null()),
      valor: z.number().positive().optional(),
      taxaJuros: z.number().optional().or(z.null()),
      dataContratacao: z.string().datetime().optional().or(z.literal('')).or(z.null()),
      dataVencimento: z.string().datetime().optional().or(z.literal('')).or(z.null()),
      status: z.enum(['ativo', 'pago', 'vencido']).optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.financiamento.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Financiamento não encontrado' })

    const d = result.data
    const financiamento = await prisma.financiamento.update({
      where: { id: Number(id) },
      data: {
        ...(d.tipo !== undefined && { tipo: d.tipo }),
        ...(d.instituicao !== undefined && { instituicao: d.instituicao }),
        ...(d.descricao !== undefined && { descricao: d.descricao || null }),
        ...(d.valor !== undefined && { valor: d.valor }),
        ...(d.taxaJuros !== undefined && { taxaJuros: d.taxaJuros }),
        ...(d.dataContratacao !== undefined && { dataContratacao: d.dataContratacao ? new Date(d.dataContratacao) : null }),
        ...(d.dataVencimento !== undefined && { dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null }),
        ...(d.status !== undefined && { status: d.status })
      }
    })

    return { ...financiamento, statusCalculado: calcularStatusFinanciamento(financiamento.dataVencimento, financiamento.status) }
  })

  // --------------------------------------------------------------------
  // DELETE /financeiro/financiamentos/:id
  // --------------------------------------------------------------------
  app.delete('/financiamentos/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.financiamento.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Financiamento não encontrado' })

    await prisma.financiamento.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })

  // --------------------------------------------------------------------
  // POST /financeiro/verificar-vencimentos
  // Gera alertas para financiamentos/CPR vencidos ou vencendo em breve.
  // Mesmo padrão usado em /documentos/verificar-vencimentos.
  // --------------------------------------------------------------------
  app.post('/verificar-vencimentos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }

    const financiamentos = await prisma.financiamento.findMany({
      where: {
        fazenda: { userId: payload.id },
        dataVencimento: { not: null },
        status: { not: 'pago' }
      },
      include: { fazenda: { select: { id: true, nome: true } } }
    })

    let alertasGerados = 0

    for (const f of financiamentos) {
      const status = calcularStatusFinanciamento(f.dataVencimento, f.status)
      if (status !== 'vencido' && status !== 'vencendo') continue

      const titulo = status === 'vencido'
        ? `${f.tipo} vencido: ${f.instituicao}`
        : `${f.tipo} próximo do vencimento: ${f.instituicao}`

      const dataFormatada = f.dataVencimento?.toLocaleDateString('pt-BR')
      const descricao = `${f.tipo} de ${f.instituicao} no valor de R$ ${f.valor.toFixed(2)} ` +
        `${status === 'vencido' ? 'venceu' : 'vence'} em ${dataFormatada} (fazenda ${f.fazenda.nome}).`

      const existeAlerta = await prisma.alerta.findFirst({
        where: {
          fazendaId: f.fazenda.id,
          titulo,
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }
        }
      })

      if (!existeAlerta) {
        await prisma.alerta.create({
          data: {
            tipo: status === 'vencido' ? 'danger' : 'warning',
            titulo,
            descricao,
            fazendaId: f.fazenda.id
          }
        })
        alertasGerados++
      }
    }

    return { alertasGerados }
  })
}
