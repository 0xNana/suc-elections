export class ApiError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class DuplicateVoteError extends ApiError {
  public constructor() {
    super(409, "Vote already recorded for this position");
  }
}
