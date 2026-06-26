/**
 * relatorios.ts — Rota de Relatórios com Exportação PDF
 *
 * Funcionalidades:
 *  - Relatório consolidado por fazenda (dados reais do banco)
 *  - Relatório financeiro por período
 *  - Relatório de alertas e ocorrências
 *  - Exportação em PDF (via pdfkit) e CSV
 *  - Histórico de relatórios gerados
 *
 * Rotas:
 *  GET  /relatorios                      → lista relatórios salvos
 *  POST /relatorios/gerar                → gera e salva novo relatório
 *  GET  /relatorios/:id/pdf              → baixa PDF do relatório
 *  GET  /relatorios/:id/csv              → baixa CSV do relatório
 *  GET  /relatorios/preview/:fazendaId   → dados para preview em tela
 *  DELETE /relatorios/:id                → remove relatório
 */

import { FastifyInstance } from 'fastify'
import { z }               from 'zod'
import { PrismaClient }    from '@prisma/client'

const prisma = new PrismaClient()

// ─── Schema de geração de relatório ──────────────────────────────────────────
const gerarRelatorioSchema = z.object({
  fazendaId:  z.number().int().positive(),
  tipo:       z.enum(['consolidado', 'financeiro', 'alertas', 'sensores', 'pragas', 'estoque']),
  dataInicio: z.string(), // ISO date string
  dataFim:    z.string(),
  titulo:     z.string().max(200).optional(),
})

// ─── Helper: coleta todos os dados da fazenda por período ─────────────────────
async function coletarDadosFazenda(fazendaId: number, dataInicio: Date, dataFim: Date) {
  const [
    fazenda,
    alertas,
    sensores,
    leituras,
    transacoes,
    irrigacoes,
    pragas,
    documentos,
    insumos,
  ] = await Promise.all([
    // Dados da fazenda
    prisma.fazenda.findUnique({
      where:   { id: fazendaId },
      include: { user: { select: { nome: true, email: true } } },
    }),

    // Alertas no período
    prisma.alerta.findMany({
      where:   { fazendaId, createdAt: { gte: dataInicio, lte: dataFim } },
      orderBy: { createdAt: 'desc' },
    }),

    // Sensores ativos
    prisma.sensor.findMany({
      where:   { fazendaId, ativo: true },
    }),

    // Leituras de sensores no período
    prisma.leitura.findMany({
      where: {
        sensor:    { fazendaId },
        timestamp: { gte: dataInicio, lte: dataFim },
      },
      include: { sensor: { select: { nome: true, tipo: true, unidade: true } } },
      orderBy: { timestamp: 'desc' },
      take:    500, // limita para não sobrecarregar o PDF
    }),

    // Transações financeiras no período
    prisma.transacaoFinanceira.findMany({
      where:   { fazendaId, data: { gte: dataInicio, lte: dataFim } },
      orderBy: { data: 'desc' },
    }),

    // Irrigações
    prisma.irrigacao.findMany({
      where: { fazendaId },
    }),

    // Ocorrências de pragas no período
    prisma.praga.findMany({
      where:   { fazendaId, createdAt: { gte: dataInicio, lte: dataFim } },
      orderBy: { createdAt: 'desc' },
    }),

    // Documentos ativos
    prisma.documento.findMany({
      where: { fazendaId },
    }),

    // Estoque (movimentações no período)
    prisma.movimentacaoEstoque.findMany({
      where: {
        fazendaId,
        data: { gte: dataInicio, lte: dataFim },
      },
      include: { insumo: { select: { nome: true, categoria: true, unidade: true } } },
    }),
  ])

  // ── Cálculos financeiros ──────────────────────────────────────────────────
  const receitas  = transacoes.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0)
  const despesas  = transacoes.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0)
  const saldo     = receitas - despesas

  // ── Resumo de alertas por nível ───────────────────────────────────────────
  const alertasCriticos = alertas.filter(a => a.nivel === 'critico').length
  const alertasAltos    = alertas.filter(a => a.nivel === 'alto').length
  const alertasLidos    = alertas.filter(a => a.lido).length

  // ── Média de leituras por sensor ──────────────────────────────────────────
  const mediasSensores = sensores.map(s => {
    const leiturasSensor = leituras.filter(l => l.sensor.nome === s.nome)
    const media = leiturasSensor.length
      ? leiturasSensor.reduce((sum, l) => sum + l.valor, 0) / leiturasSensor.length
      : null
    return { ...s, media, totalLeituras: leiturasSensor.length }
  })

  // ── Documentos vencidos ou próximos do vencimento ─────────────────────────
  const hoje = new Date()
  const em30dias = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000)
  const docsVencidos  = documentos.filter(d => d.dataVencimento && new Date(d.dataVencimento) < hoje)
  const docsVencendo  = documentos.filter(d => d.dataVencimento && new Date(d.dataVencimento) >= hoje && new Date(d.dataVencimento) <= em30dias)

  return {
    fazenda,
    periodo: { inicio: dataInicio, fim: dataFim },
    resumo: {
      totalAlertas: alertas.length,
      alertasCriticos,
      alertasAltos,
      alertasLidos,
      taxaResolucao: alertas.length ? Math.round((alertasLidos / alertas.length) * 100) : 0,
      totalSensores:  sensores.length,
      totalLeituras:  leituras.length,
      receitas,
      despesas,
      saldo,
      totalTransacoes: transacoes.length,
      totalPragas:     pragas.length,
      pragasCriticas:  pragas.filter(p => p.urgencia === 'critica').length,
      docsVencidos:    docsVencidos.length,
      docsVencendo:    docsVencendo.length,
    },
    detalhes: {
      alertas,
      sensores: mediasSensores,
      leituras: leituras.slice(0, 100), // limita para preview
      transacoes,
      irrigacoes,
      pragas,
      documentos,
      movimentacoes: insumos,
    },
  }
}

// ─── Helper: gerar CSV ────────────────────────────────────────────────────────
function gerarCSV(dados: any, tipo: string): string {
  const linhas: string[] = []
  const sep = ','

  // Cabeçalho
  linhas.push(`SightAgro - Relatório ${tipo}`)
  linhas.push(`Fazenda: ${dados.fazenda.nome}`)
  linhas.push(`Período: ${new Date(dados.periodo.inicio).toLocaleDateString('pt-BR')} a ${new Date(dados.periodo.fim).toLocaleDateString('pt-BR')}`)
  linhas.push(`Gerado em: ${new Date().toLocaleString('pt-BR')}`)
  linhas.push('')

  if (tipo === 'financeiro' || tipo === 'consolidado') {
    linhas.push('=== FINANCEIRO ===')
    linhas.push(`Receitas${sep}R$ ${dados.resumo.receitas.toFixed(2)}`)
    linhas.push(`Despesas${sep}R$ ${dados.resumo.despesas.toFixed(2)}`)
    linhas.push(`Saldo${sep}R$ ${dados.resumo.saldo.toFixed(2)}`)
    linhas.push('')
    linhas.push('Data,Tipo,Categoria,Descrição,Valor')
    dados.detalhes.transacoes.forEach((t: any) => {
      linhas.push([
        new Date(t.data).toLocaleDateString('pt-BR'),
        t.tipo,
        t.categoria,
        `"${t.descricao}"`,
        `R$ ${t.valor.toFixed(2)}`,
      ].join(sep))
    })
    linhas.push('')
  }

  if (tipo === 'alertas' || tipo === 'consolidado') {
    linhas.push('=== ALERTAS ===')
    linhas.push('Data,Tipo,Nível,Título,Lido')
    dados.detalhes.alertas.forEach((a: any) => {
      linhas.push([
        new Date(a.createdAt).toLocaleDateString('pt-BR'),
        a.tipo,
        a.nivel,
        `"${a.titulo}"`,
        a.lido ? 'Sim' : 'Não',
      ].join(sep))
    })
    linhas.push('')
  }

  if (tipo === 'sensores' || tipo === 'consolidado') {
    linhas.push('=== LEITURAS DE SENSORES ===')
    linhas.push('Data/Hora,Sensor,Tipo,Valor,Unidade')
    dados.detalhes.leituras.forEach((l: any) => {
      linhas.push([
        new Date(l.timestamp).toLocaleString('pt-BR'),
        l.sensor.nome,
        l.sensor.tipo,
        l.valor,
        l.sensor.unidade || '',
      ].join(sep))
    })
    linhas.push('')
  }

  if (tipo === 'pragas' || tipo === 'consolidado') {
    linhas.push('=== PRAGAS E DOENÇAS ===')
    linhas.push('Data,Cultura,Tipo,Urgência,Status,Diagnóstico IA')
    dados.detalhes.pragas.forEach((p: any) => {
      linhas.push([
        new Date(p.createdAt).toLocaleDateString('pt-BR'),
        p.cultura,
        p.tipoProblema,
        p.urgencia,
        p.status,
        `"${p.diagnosticoIA || 'Não diagnosticado'}"`,
      ].join(sep))
    })
  }

  return linhas.join('\n')
}

// ─── Plugin Fastify ───────────────────────────────────────────────────────────
export async function relatoriosRoutes(app: FastifyInstance) {

  // ── GET /relatorios ──────────────────────────────────────────────────────────
  app.get('/relatorios', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }

    const relatorios = await prisma.relatorio.findMany({
      where:   { userId: payload.id },
      include: { fazenda: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send(relatorios)
  })

  // ── POST /relatorios/gerar ───────────────────────────────────────────────────
  // Gera e persiste um novo relatório com os dados coletados
  app.post('/relatorios/gerar', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const result  = gerarRelatorioSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    // Verifica posse da fazenda
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: result.data.fazendaId, userId: payload.id },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    const dataInicio = new Date(result.data.dataInicio)
    const dataFim    = new Date(result.data.dataFim)

    // Coleta os dados
    const dados = await coletarDadosFazenda(result.data.fazendaId, dataInicio, dataFim)

    // Persiste o relatório com snapshot dos dados
    const titulo = result.data.titulo ||
      `Relatório ${result.data.tipo} — ${fazenda.nome} — ${new Date().toLocaleDateString('pt-BR')}`

    const relatorio = await prisma.relatorio.create({
      data: {
        userId:     payload.id,
        fazendaId:  result.data.fazendaId,
        tipo:       result.data.tipo,
        titulo,
        dataInicio,
        dataFim,
        dadosJson:  JSON.stringify(dados),  // snapshot completo para re-exportar depois
        resumoJson: JSON.stringify(dados.resumo),
      },
      include: { fazenda: { select: { id: true, nome: true } } },
    })

    return reply.status(201).send(relatorio)
  })

  // ── GET /relatorios/preview/:fazendaId ───────────────────────────────────────
  // Dados em tempo real para visualização na tela (sem salvar)
  app.get('/relatorios/preview/:fazendaId', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload      = request.user as { id: number }
    const { fazendaId } = request.params as { fazendaId: string }
    const { dias = '30' } = request.query as { dias?: string }

    const fazenda = await prisma.fazenda.findFirst({
      where: { id: parseInt(fazendaId), userId: payload.id },
    })
    if (!fazenda) return reply.status(404).send({ error: 'Fazenda não encontrada.' })

    const dataFim    = new Date()
    const dataInicio = new Date(dataFim.getTime() - parseInt(dias) * 24 * 60 * 60 * 1000)

    const dados = await coletarDadosFazenda(parseInt(fazendaId), dataInicio, dataFim)
    return reply.send(dados)
  })

  // ── GET /relatorios/:id/csv ──────────────────────────────────────────────────
  app.get('/relatorios/:id/csv', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const relatorio = await prisma.relatorio.findFirst({
      where: { id: parseInt(id), userId: payload.id },
    })
    if (!relatorio) return reply.status(404).send({ error: 'Relatório não encontrado.' })

    const dados = JSON.parse(relatorio.dadosJson)
    const csv   = gerarCSV(dados, relatorio.tipo)

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="sightagro-${relatorio.tipo}-${Date.now()}.csv"`)
    return reply.send('\uFEFF' + csv) // BOM para Excel reconhecer UTF-8
  })

  // ── GET /relatorios/:id/dados ────────────────────────────────────────────────
  // Retorna os dados JSON do relatório (para re-renderizar na tela ou gerar PDF no frontend)
  app.get('/relatorios/:id/dados', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const relatorio = await prisma.relatorio.findFirst({
      where:   { id: parseInt(id), userId: payload.id },
      include: { fazenda: { select: { id: true, nome: true } } },
    })
    if (!relatorio) return reply.status(404).send({ error: 'Relatório não encontrado.' })

    return reply.send({
      ...relatorio,
      dados: JSON.parse(relatorio.dadosJson),
    })
  })

  // ── DELETE /relatorios/:id ───────────────────────────────────────────────────
  app.delete('/relatorios/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const relatorio = await prisma.relatorio.findFirst({
      where: { id: parseInt(id), userId: payload.id },
    })
    if (!relatorio) return reply.status(404).send({ error: 'Relatório não encontrado.' })

    await prisma.relatorio.delete({ where: { id: parseInt(id) } })
    return reply.status(204).send()
  })
}
