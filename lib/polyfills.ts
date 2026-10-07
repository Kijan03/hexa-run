// h3-js v4는 모듈 로드 시 new TextDecoder('utf-16le')를 호출하지만
// Hermes/Expo의 TextDecoder는 utf-8만 지원한다. utf-16le만 직접 디코딩하도록 감싼다.
// 반드시 h3-js보다 먼저 import 되어야 한다.

type DecodeInput = ArrayBuffer | ArrayBufferView | undefined;

const NativeTextDecoder = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;

function isUtf16(label: string): boolean {
  const l = label.toLowerCase();
  return l === 'utf-16le' || l === 'utf-16' || l === 'ucs-2' || l === 'utf16le';
}

class PatchedTextDecoder {
  readonly encoding: string;
  readonly fatal = false;
  readonly ignoreBOM = false;
  private readonly native: TextDecoder | null;

  constructor(label: string = 'utf-8', options?: TextDecoderOptions) {
    if (isUtf16(label)) {
      this.encoding = 'utf-16le';
      this.native = null;
    } else {
      this.encoding = label.toLowerCase();
      this.native = NativeTextDecoder ? new NativeTextDecoder(label, options) : null;
    }
  }

  decode(input?: DecodeInput, options?: TextDecodeOptions): string {
    if (this.native) return this.native.decode(input as ArrayBufferView, options);
    if (!input) return '';

    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

    let out = '';
    const CHUNK = 4096;
    const units: number[] = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      units.push(bytes[i] | (bytes[i + 1] << 8));
      if (units.length === CHUNK) {
        out += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    if (units.length) out += String.fromCharCode(...units);
    return out;
  }
}

Object.defineProperty(globalThis, 'TextDecoder', {
  value: PatchedTextDecoder,
  writable: true,
  configurable: true,
});
