// The project currently uses @types/node 20; Node 24 supplies node:sqlite at runtime.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: (string | number)[]): unknown;
      get(...params: (string | number)[]): unknown;
      all(...params: (string | number)[]): unknown[];
    };
  }
}
