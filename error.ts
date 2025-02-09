export class ReadingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Parse reading failed';
  }
}
