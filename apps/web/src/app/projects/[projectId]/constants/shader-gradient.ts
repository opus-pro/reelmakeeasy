import { GradientT } from '@shadergradient/react'

export const ProjectBgParams: GradientT = {
  // MeshT
  type: 'waterPlane',
  animate: 'on',
  uTime: 0,
  uSpeed: 0.2,
  uStrength: 1.3,
  uDensity: 1.3,
  uFrequency: 5.5,
  uAmplitude: 0,
  positionX: -0.5,
  positionY: 0.1,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 235,
  color1: '#2b2b2f',
  color2: '#bfb9be',
  color3: '#000000',
  reflection: 0.1,
  wireframe: false,
  shader: 'defaults',

  // GradientT
  cAzimuthAngle: 180,
  cPolarAngle: 115,
  cDistance: 3.9,
  cameraZoom: 1,
  lightType: '3d',
  brightness: 0.4,
  envPreset: 'city',
  grain: 'off',
  zoomOut: false,
  toggleAxis: false,
}
