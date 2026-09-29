export type DomainErrorCategory = "validation" | "conflict" | "forbidden";

/** Expected business failure. Transport layers choose the corresponding response. */
export class DomainError extends Error {
  constructor(
    public readonly category: DomainErrorCategory,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}
