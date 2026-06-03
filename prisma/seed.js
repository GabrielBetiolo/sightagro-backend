"use strict";
// prisma/seed.ts
// Cole em: backend/prisma/seed.ts
// Rode com: npm run db:seed
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding database...');
    const hashedPassword = await bcryptjs_1.default.hash('senha123', 10);
    const user = await prisma.user.upsert({
        where: { email: 'admin@sightagro.com' },
        update: {},
        create: {
            name: 'Administrador',
            email: 'admin@sightagro.com',
            password: hashedPassword,
            role: 'admin'
        }
    });
    const fazenda = await prisma.fazenda.create({
        data: {
            nome: 'Fazenda São João',
            localizacao: 'Mato Grosso, BR',
            area: 1200,
            cultura: 'Soja',
            userId: user.id
        }
    });
    await prisma.sensor.createMany({
        data: [
            { codigo: 'A1', tipo: 'Temperatura', status: 'online', bateria: 92, fazendaId: fazenda.id },
            { codigo: 'B4', tipo: 'Umidade', status: 'online', bateria: 67, fazendaId: fazenda.id },
            { codigo: 'C2', tipo: 'Solo', status: 'offline', bateria: 12, fazendaId: fazenda.id },
            { codigo: 'D8', tipo: 'Irrigação', status: 'unstable', bateria: 45, fazendaId: fazenda.id },
        ]
    });
    await prisma.irrigacao.createMany({
        data: [
            { zona: 'Setor A - Soja Norte', ativa: true, fluxo: 4.2, duracao: 45, fazendaId: fazenda.id },
            { zona: 'Setor B - Soja Sul', ativa: false, fluxo: 0, duracao: 30, fazendaId: fazenda.id },
        ]
    });
    await prisma.alerta.createMany({
        data: [
            { tipo: 'info', titulo: 'Chuva prevista amanhã', descricao: 'Previsão de 12mm na região.', fazendaId: fazenda.id },
            { tipo: 'warning', titulo: 'Umidade abaixo do ideal', descricao: 'Sensor B4 registrou umidade de 42%.', fazendaId: fazenda.id },
            { tipo: 'danger', titulo: 'Sensor C2 offline', descricao: 'Sensor C2 não responde há 3 horas.', fazendaId: fazenda.id },
        ]
    });
    console.log('✅ Seed concluído!');
    console.log('📧 Login: admin@sightagro.com');
    console.log('🔑 Senha: senha123');
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map