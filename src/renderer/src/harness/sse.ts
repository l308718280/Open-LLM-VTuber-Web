import { HarnessError } from './errors';

export const MAX_EVENT_BYTES = 1024 * 1024;
export interface SseFrame { event: string; data: string }

/** Byte-bounded framing; a split UTF-8 code point stays buffered until its line completes. */
export class SseDecoder {
  private readonly line: Uint8Array;
  private length = 0;
  private frameBytes = 0;
  private afterCR = false;
  private crBytes = 0;
  private firstLine = true;
  private event = '';
  private data: string[] = [];
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  constructor(private readonly limit = MAX_EVENT_BYTES) {
    this.line = new Uint8Array(limit);
  }

  push(chunk: Uint8Array, consume: (frame: SseFrame) => boolean | void): void {
    for (const byte of chunk) {
      if (this.afterCR) {
        this.afterCR = false;
        if (byte === 10) {
          if (this.crBytes + 1 > this.limit) throw new HarnessError('limit');
          if (this.frameBytes) this.frameBytes += 1;
          continue;
        }
      }
      this.frameBytes += 1;
      if (this.frameBytes > this.limit) throw new HarnessError('limit');
      if (byte === 10 || byte === 13) {
        this.afterCR = byte === 13;
        this.crBytes = this.frameBytes;
        const frame = this.endLine();
        if (frame && consume(frame) === false) return;
      } else {
        this.line[this.length++] = byte;
      }
    }
  }

  private endLine(): SseFrame | undefined {
    let text: string;
    try {
      text = this.decoder.decode(this.line.subarray(0, this.length));
    } catch {
      throw new HarnessError('protocol');
    }
    this.length = 0;
    if (this.firstLine) {
      text = text.replace(/^\uFEFF/, '');
      this.firstLine = false;
    }
    if (text === '') {
      const frame = this.data.length ? { event: this.event || 'message', data: this.data.join('\n') } : undefined;
      this.frameBytes = 0;
      this.event = '';
      this.data = [];
      return frame;
    }
    if (text.startsWith(':')) return undefined;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    if (field === 'data') this.data.push(value);
    return undefined;
  }

  finish(): void {
    // Never turn an unterminated event into a successful response.
    if (this.length || this.data.length || this.event) throw new HarnessError('protocol');
  }

  clear(): void {
    this.line.fill(0);
    this.length = 0;
    this.frameBytes = 0;
    this.afterCR = false;
    this.firstLine = true;
    this.event = '';
    this.data = [];
  }
}