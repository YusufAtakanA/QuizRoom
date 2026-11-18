declare const __PUBLIC_ORIGIN__: string

declare module 'node:os' {
  export function networkInterfaces(): Record<string, { address: string; family: string; internal: boolean }[] | undefined>
}
