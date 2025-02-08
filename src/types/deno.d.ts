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
}

declare module "https://deno.land/std@0.208.0/testing/asserts.ts" {
  export function assertEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertExists<T>(actual: T, msg?: string): void;
  export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertThrows(fn: () => void, ErrorClass?: Constructor, msgIncludes?: string, msg?: string): Error;
  export function assertRejects(fn: () => Promise<any>, ErrorClass?: Constructor, msgIncludes?: string, msg?: string): Promise<Error>;
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