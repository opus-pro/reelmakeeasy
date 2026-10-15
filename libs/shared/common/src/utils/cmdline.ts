import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '../logger'

type CommandResult = {
  stderr: string
  stdout: string
}

/** Run a command and return the stdout and stderr */
export async function runCommand(
  command: string[],
  options: { env?: Record<string, string> } = {},
): Promise<CommandResult> {
  logger.info(`Running command: ${command.join(' ')}`)
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command
    const child = spawn(cmd, args, {
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Disable buffering for real-time output
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    // Handle stdout with immediate flushing
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (data) => {
        const dataStr = data.toString()
        stdout += dataStr
        // Write immediately to console without buffering
        process.stdout.write(dataStr)
      })
    }

    // Handle stderr with immediate flushing
    if (child.stderr) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (data) => {
        const dataStr = data.toString()
        stderr += dataStr
        // Write immediately to console without buffering
        process.stderr.write(dataStr)
      })
    }

    child.on('close', (code) => {
      logger.info(`Command finished with exit code: ${code}, ${command.join(' ')}`)
      if (code !== 0) {
        reject(
          new Error(
            `Command failed with exit code: ${code}\nCommand: ${command.join(' ')}\nStdout: ${stdout.slice(0, 1000)}\nStderr: ${stderr.slice(0, 1000)}`,
          ),
        )
      }
      resolve({
        stderr,
        stdout,
      })
    })

    child.on('error', (error) => {
      reject(error)
    })
  })
}
export async function runFfmpeg(...args: string[]): Promise<CommandResult> {
  return await runCommand(['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y', ...args])
}

/** Run a command and return the stdout and stderr
 * @throws {import('node:child_process').ExecException}
 */
export async function runPython(
  pythonCommand: string[],
  options?: { env?: Record<string, string> },
): Promise<{
  stderr: string
  stdout: string
}> {
  const uvCmd = resolveUvCommand()
  const venvPath = path.join(process.cwd(), '.venv')

  options = options || {}
  options.env = {
    DYLD_LIBRARY_PATH: '/opt/homebrew/lib',
    PYTHONPATH: 'python',
    // Force Python to use unbuffered output
    PYTHONUNBUFFERED: '1',
    NODE_ENV: process.env['NODE_ENV'] || 'development',
    VIRTUAL_ENV: venvPath,
    ...options.env,
  }
  return runCommand([uvCmd, 'run', ...pythonCommand], options)
}

/** get uv command from env or fallback to default */
function resolveUvCommand() {
  const pathEnv = process.env['UV_PATH'] || ''
  if (pathEnv) {
    return pathEnv
  }
  const fallbacks = ['/opt/homebrew/bin/uv', path.join(os.homedir(), '.local/bin/uv')]
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return 'uv'
}
