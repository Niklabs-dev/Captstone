import { detectVoucherMimeType } from './voucher-signature.util.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
// WebP: "RIFF" + tamaño del chunk (4 bytes) + "WEBP" + resto.
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);
const PDF = Buffer.from('%PDF-1.7\ncontenido\n%%EOF');
const EXE = Buffer.from('MZ\x90\x00ejecutable');
const EMPTY = Buffer.alloc(0);

describe('Detección de firma del voucher (SPRINT-4R-T01)', () => {
  it('detecta JPEG por sus magic bytes', () => {
    expect(detectVoucherMimeType(JPEG)).toBe('image/jpeg');
  });

  it('detecta PNG por sus magic bytes', () => {
    expect(detectVoucherMimeType(PNG)).toBe('image/png');
  });

  it('detecta WebP por RIFF/WEBP', () => {
    expect(detectVoucherMimeType(WEBP)).toBe('image/webp');
  });

  it('rechaza PDF (no es un tipo de voucher aceptado)', () => {
    expect(detectVoucherMimeType(PDF)).toBeNull();
  });

  it('rechaza ejecutables y basura', () => {
    expect(detectVoucherMimeType(EXE)).toBeNull();
    expect(detectVoucherMimeType(Buffer.from('texto plano'))).toBeNull();
  });

  it('rechaza contenido vacío y firmas truncadas', () => {
    expect(detectVoucherMimeType(EMPTY)).toBeNull();
    expect(detectVoucherMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectVoucherMimeType(WEBP.subarray(0, 11))).toBeNull();
  });

  it('rechaza un RIFF que no es WebP (p. ej. WAV/AVI)', () => {
    const riffOther = Buffer.from(WEBP);
    riffOther.write('WAVE', 8, 'ascii');
    expect(detectVoucherMimeType(riffOther)).toBeNull();
  });
});
