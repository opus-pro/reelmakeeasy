export interface MetaJson {
  inputs: {
    [key: string]: {
      imports?: {
        external?: boolean
        kind: 'import-statement' | 'require-call'
        path: string
      }[]
    }
  }
}

export type NpmDep = Record<string, string>

export interface PackageJson {
  dependencies: NpmDep
  devDependencies: NpmDep
  missingDeps: string[]
  name: string
  version: string
}

export interface TsConfigJson {
  compilerOptions: {
    paths?: { [key: string]: string[] }
  }
}
