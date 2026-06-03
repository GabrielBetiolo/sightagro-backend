import 'fastify';

declare module 'fastify' {
    export interface FastufyInstance {
        authenticate: (request: any, reply: any) => Promise<void>;
    }
}