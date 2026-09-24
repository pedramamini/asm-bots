/** The API's error shape: every non-2xx JSON response is `{ error: { code, message } }`. */
import * as z from 'zod/mini'

/** The codes the API answers with, and the HTTP status of each. */
export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
} as const
export type ErrorCode = keyof typeof ERROR_STATUS

export const ApiError = z.object({
  error: z.object({
    /** An `ErrorCode`, or a newer one this client does not know. */
    code: z.string(),
    /** For people: lowercase, one sentence. */
    message: z.string(),
  }),
})
export type ApiError = z.output<typeof ApiError>

export function apiError(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } }
}
