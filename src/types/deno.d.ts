declare namespace Deno {
  export interface TestContext {
    name: string;
    step(name: string, fn: (t: TestContext) => void | Promise<void>): Promise<void>;
  }

  export interface TestDefinition {
    name: string;
    fn: (t: TestContext) => void | Promise<void>;
    ignore?: boolean;
    only?: boolean;
    sanitizeOps?: boolean;
    sanitizeResources?: boolean;
    sanitizeExit?: boolean;
  }

  export function test(name: string, fn: (t: TestContext) => void | Promise<void>): void;
  export function test(def: TestDefinition): void;

  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): { [key: string]: string };
  };

  export function readTextFile(path: string): Promise<string>;
}

declare module "https://deno.land/std@0.208.0/testing/asserts.ts" {
  export function assertEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertExists<T>(actual: T, msg?: string): void;
  export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertThrows(fn: () => void, ErrorClass?: Constructor, msgIncludes?: string, msg?: string): Error;
  export function assertRejects(fn: () => Promise<any>, ErrorClass?: Constructor, msgIncludes?: string, msg?: string): Promise<Error>;
}

declare module "https://deno.land/x/oak@v12.6.1/mod.ts" {
  export class Application {
    use(middleware: Middleware): void;
    listen(options: { port: number }): Promise<void>;
  }

  export class Router {
    get(path: string, ...middleware: Middleware[]): Router;
    post(path: string, ...middleware: Middleware[]): Router;
    delete(path: string, ...middleware: Middleware[]): Router;
    routes(): Middleware;
  }

  export interface RouterContext {
    request: {
      url: URL;
      method: string;
      body: () => Promise<any>;
      headers: Headers;
    };
    response: {
      body: any;
      status: number;
      headers: Headers;
    };
    params: { [key: string]: string };
    state: { [key: string]: any };
    isUpgradable: boolean;
    upgrade(): Promise<WebSocket>;
  }

  export type Middleware = (context: RouterContext, next: () => Promise<void>) => Promise<void>;
}

declare module "https://deno.land/x/cors@v1.2.2/mod.ts" {
  export function oakCors(options?: {
    origin?: string | string[] | ((origin: string) => boolean);
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
    optionsSuccessStatus?: number;
  }): Middleware;
}

type Constructor = new (...args: any[]) => any;

// Extend Performance interface to include memory property
interface Performance {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
}

// Extend Error interface to ensure error.message exists
interface Error {
  message: string;
}