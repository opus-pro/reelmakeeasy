/*
 * Turns anything thrown into a standard Error object.
 *
 * Adapted from ensure-error (https://github.com/sindresorhus/ensure-error), with changes:
 *
 * MIT License
 *
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

class NonError extends Error {
  override name = 'NonError'

  constructor(message: unknown) {
    super(toErrorMessage(message))
  }
}

/**
 * Error type that may include a cause property
 */
export type ErrorWithCause = Error & {
  cause?: unknown
  originalCause?: Error
}

/**
 * Always returns an Error object or a subclass (adapted from ensure-error; see the file header).
 * */
export function ensureError<T extends Error>(input: unknown): ErrorWithCause & T {
  return internalEnsureError(input, new WeakSet()) as ErrorWithCause & T
}

/**
 * Handles the cause field of an error, recursively ensuring it's a proper Error object.
 * Some Error implementations expose a non-writable `cause`, so we handle that case.
 */
function handleErrorCauseField(errorWithCause: ErrorWithCause, seen: WeakSet<object>): void {
  // Safely check if cause exists - some implementations may throw when accessing cause
  let causeValue: unknown
  try {
    causeValue = errorWithCause.cause
  } catch {
    // If accessing cause throws, skip cause handling
    causeValue = undefined
  }
  if (causeValue !== undefined && causeValue !== null) {
    // Some Error implementations expose a non-writable `cause`.
    // Only mutate when writable or a setter exists; otherwise, attach a hidden copy.
    try {
      const desc = Object.getOwnPropertyDescriptor(errorWithCause, 'cause')
      const canWrite = !desc || desc.writable === true || typeof desc.set === 'function'
      const ensured = internalEnsureError(causeValue, seen)
      if (canWrite) {
        errorWithCause.cause = ensured
      } else {
        // Preserve information without throwing by adding a non-enumerable shadow.
        Object.defineProperty(errorWithCause, 'originalCause', {
          value: ensured,
          configurable: true,
          writable: false,
          enumerable: false,
        })
      }
    } catch {
      process.stderr.write(`Error normalizing cause: ${String(causeValue)}\n`)
    }
  }
}

/**
 * Handles the errors field of an AggregateError, recursively ensuring each error is a proper Error object.
 * Some Error implementations expose a readonly `errors` array, so we handle that case.
 */
function handleErrorErrorListField(
  errorWithErrors: Error & { errors?: unknown[] },
  seen: WeakSet<object>,
): void {
  if (errorWithErrors.errors && Array.isArray(errorWithErrors.errors)) {
    // in case of errors is readonly, use for-each instead of map
    for (const index in errorWithErrors.errors) {
      errorWithErrors.errors[index] = internalEnsureError(errorWithErrors.errors[index], seen)
    }
  }
}

/** THIS FUNCTION WILL BE CALLED RECURSIVELY. */
function internalEnsureError(input: unknown, seen: WeakSet<object>): ErrorWithCause {
  if (!(input instanceof Error)) {
    return new NonError(input)
  }

  // Prevent infinite recursion with circular references
  if (seen.has(input)) {
    return input
  }

  seen.add(input)

  // Helper to ensure properties exist with correct descriptors
  const ensureProperty = (property: string, defaultValue: unknown) => {
    if (!(property in input)) {
      Object.defineProperty(input, property, {
        value: defaultValue,
        configurable: true,
        writable: true,
        enumerable: false,
      })
    }
  }

  ensureProperty('name', input.constructor?.name || 'Error')
  ensureProperty('message', '<No error message>')
  ensureProperty(
    'stack',
    new Error(input.message).stack?.replace(/\n {4}at /, '\n<Original stack missing>$&'),
  )

  // Recursively ensure cause is also a proper error
  handleErrorCauseField(input as ErrorWithCause, seen)

  // Recursively ensure AggregateError.errors are also proper errors
  handleErrorErrorListField(input as Error & { errors?: unknown[] }, seen)

  return input
}

function toErrorMessage(value: unknown) {
  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return `'${value}'`
  }

  if (typeof value === 'bigint') {
    return `${value}n`
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (typeof value === 'function') {
    const name = ` ${value.name ?? ' (anonymous)'}`
    return `[Function${name}]`
  }

  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '<Unserializable value>'
    }
  }
}
