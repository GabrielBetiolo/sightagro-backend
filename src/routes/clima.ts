import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const OWM_KEY = process.env.OPENWEATHER_API_KEY

async function getClima(cidade: string): Promise<any> {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&appid=${OWM_KEY}&units=metric&lang=pt_br`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cidade não encontrada')
  return res.json() as Promise<any>
}

async function getPrevisao(cidade: string): Promise<any> {
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(cidade)}&appid=${OWM_KEY}&units=metric&lang=pt_br&cnt=24`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cidade não encontrada')
  return res.json() as Promise<any>
}

export async function climaRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => { await app.authenticate(req, rep) }

  app.get('/fazenda/:id', { preHandler: auth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const fazenda = await prisma.fazenda.findUnique({ where: { id: Number(id) } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    try {
      const [atual, previsao]: [any, any] = await Promise.all([
        getClima(fazenda.localizacao),
        getPrevisao(fazenda.localizacao)
      ])

      const alertasClima: { tipo: string; titulo: string; descricao: string }[] = []
      const temp: number = atual.main.temp
      const chuva: number = atual.rain?.['1h'] || 0

      if (temp <= 4) alertasClima.push({ tipo: 'danger', titulo: 'Risco de geada', descricao: `Temperatura de ${temp.toFixed(1)}°C — proteja suas plantações.` })
      if (chuva > 10) alertasClima.push({ tipo: 'info', titulo: 'Chuva intensa', descricao: `${chuva}mm de chuva na última hora.` })
      if (atual.main.humidity < 30) alertasClima.push({ tipo: 'warning', titulo: 'Umidade muito baixa', descricao: `Umidade do ar em ${atual.main.humidity}% — considere irrigar.` })
      if (temp > 38) alertasClima.push({ tipo: 'danger', titulo: 'Calor extremo', descricao: `Temperatura de ${temp.toFixed(1)}°C — risco para culturas sensíveis.` })

      for (const alerta of alertasClima) {
        const existe = await prisma.alerta.findFirst({
          where: { fazendaId: fazenda.id, titulo: alerta.titulo, createdAt: { gte: new Date(Date.now() - 6 * 3600000) } }
        })
        if (!existe) {
          await prisma.alerta.create({ data: { ...alerta, fazendaId: fazenda.id } })
        }
      }

      return {
        atual: {
          temp: atual.main.temp,
          sensacao: atual.main.feels_like,
          umidade: atual.main.humidity,
          vento: atual.wind.speed,
          descricao: atual.weather[0].description,
          icone: atual.weather[0].icon,
          chuva,
          cidade: atual.name
        },
        previsao: previsao.list.slice(0, 8).map((p: any) => ({
          hora: new Date(p.dt * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          temp: p.main.temp,
          descricao: p.weather[0].description,
          icone: p.weather[0].icon,
          chuva: p.rain?.['3h'] || 0
        })),
        alertas: alertasClima
      }
    } catch (err: any) {
      return reply.status(400).send({ message: err.message })
    }
  })
}
