import { detectMimeType } from './file-signature.util.js';

describe('detectMimeType (SPRINT-2-T04)', () => {
  it('detecta PDF, PNG y JPEG por sus primeros bytes', () => {
    expect(detectMimeType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(
      detectMimeType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
  });

  it('devuelve null para tipos no permitidos o contenido muy corto', () => {
    // Un ejecutable de Windows empieza con "MZ".
    expect(detectMimeType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectMimeType(Buffer.from('texto plano'))).toBeNull();
    expect(detectMimeType(Buffer.from('%PD'))).toBeNull();
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
  });
});
