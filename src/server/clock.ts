/** The only place the server reads the clock, so tests can pin time. */
let override: (() => Date) | null = null;

export function nowIso(): string {
  return (override ? override() : new Date()).toISOString();
}

export function nowMs(): number {
  return (override ? override() : new Date()).getTime();
}

export function setClockForTests(fn: (() => Date) | null): void {
  override = fn;
}
