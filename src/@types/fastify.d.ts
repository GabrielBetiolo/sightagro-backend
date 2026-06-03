import 'fastify';

declare module 'fastify' {
    export interface FastifyInstance {
        authenticate: any;
    }
}

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            [key: string]: string | undefined;
        }
    }
}