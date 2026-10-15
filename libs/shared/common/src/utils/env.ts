export const nodeEnv: string = process.env['NODE_ENV'] || 'development'

export function isCi(): boolean {
  return process.env['CI'] === 'true' || process.env['IS_CI'] === 'true'
}
export function isDev(): boolean {
  return nodeEnv === 'development'
}
export function isEval(): boolean {
  return process.env['EVAL_MODE'] === 'true'
}
export function isProd(): boolean {
  return nodeEnv === 'production'
}
export function isProdOrStg(): boolean {
  return isProd() || isStg()
}
export function isStg(): boolean {
  return nodeEnv === 'staging'
}
export function isTest(): boolean {
  return nodeEnv === 'test'
}

/** run `export RUN_MANUAL_TESTS_LOCALLY=true` to run the test locally
 * mainly for some tests after switching models
 */
export function runManualTestsLocally(): boolean {
  return process.env['RUN_MANUAL_TESTS_LOCALLY'] === 'true'
}
