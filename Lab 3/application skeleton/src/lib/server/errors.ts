export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ProviderError extends Error {
  constructor(message = 'Live provider data is temporarily unavailable.', readonly status = 503) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function errorResponse(error: unknown): Response {
  const apiError = error instanceof ApiError
    ? error
    : error instanceof ProviderError
      ? new ApiError(error.message, error.status)
      : new ApiError('The request could not be completed.', 500);
  const body: { error: string; fields?: Record<string, string>; retryAfter?: number } = { error: apiError.message };
  if (apiError.fields) body.fields = apiError.fields;
  if (apiError.retryAfter !== undefined) body.retryAfter = apiError.retryAfter;
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (apiError.retryAfter !== undefined) headers.set('Retry-After', String(apiError.retryAfter));
  return Response.json(body, { status: apiError.status, headers });
}

export function validationError(issues: readonly { path: PropertyKey[]; message: string }[]): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const name = issue.path.map(String).join('.') || 'form';
    fields[name] ??= issue.message;
  }
  return new ApiError('Please correct the highlighted fields.', 400, fields);
}

export function databaseError(error: { code?: string; message?: string } | null | undefined): ApiError {
  if (error?.code === 'PT409' || error?.code === '23505' || error?.code === 'PP409') return new ApiError('This change conflicts with newer data. Refresh and try again.', 409);
  if (error?.code === '42501' || error?.code === 'PP403') return new ApiError('You do not have permission to perform this action.', 403);
  if (error?.code === 'P0002' || error?.code === 'PP404') return new ApiError('The requested item was not found.', 404);
  if (error?.code === '22023' || error?.code === '23514' || error?.code === 'PP400') return new ApiError('The requested change is invalid.', 400);
  if (error?.code === 'P0001' && /RATE_LIMITED\s+retry_after_seconds=(\d+)/.test(error.message ?? '')) {
    const match = /RATE_LIMITED\s+retry_after_seconds=(\d+)/.exec(error.message ?? '');
    return new ApiError('Too many issue reports were submitted. Please try again later.', 429, undefined, Math.max(1, Number(match?.[1] ?? 60)));
  }
  if (error?.code === 'P0001') return new ApiError('The requested change is invalid.', 400);
  return new ApiError('The service could not save this change. Please try again.', 503);
}
