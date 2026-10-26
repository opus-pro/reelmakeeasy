import { REMOTION_VERSION, runtimePackageJson } from './motion-runtime'

describe('runtimePackageJson', () => {
  const pkg = JSON.parse(runtimePackageJson()) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  it('has three.js for the 3D and 8-bit animation looks, at exact versions', () => {
    expect(pkg.dependencies).toMatchObject({
      '@react-three/fiber': '9.8.1',
      '@remotion/three': REMOTION_VERSION,
      three: '0.186.1',
    })
    expect(pkg.devDependencies['@types/three']).toBe('0.186.0')
  })

  it('pins every package to one version', () => {
    for (const version of [
      ...Object.values(pkg.dependencies),
      ...Object.values(pkg.devDependencies),
    ])
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
