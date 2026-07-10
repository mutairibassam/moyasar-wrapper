export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly type: string;

  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly type = "validation_error";
}

export class AuthnError extends AppError {
  readonly status = 401;
  readonly type = "authentication_error";
}

export class AuthzError extends AppError {
  readonly status = 403;
  readonly type = "authorization_error";
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly type = "not_found";
}

export class StateTransitionError extends AppError {
  readonly status = 409;
  readonly type = "state_transition_error";
}

export class MoyasarApiError extends AppError {
  readonly status = 502;
  readonly type = "moyasar_api_error";
}
