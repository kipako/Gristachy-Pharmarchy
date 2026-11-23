export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(issues) {
  return new AppError(
    400,
    "VALIDATION_ERROR",
    "Please correct the highlighted information.",
    issues
  );
}
