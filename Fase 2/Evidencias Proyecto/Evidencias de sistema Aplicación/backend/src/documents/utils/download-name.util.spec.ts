import {
  buildDownloadFileName,
  contentDisposition,
} from './download-name.util.js';

describe('Nombre de descarga (SPRINT-2-T06)', () => {
  it('arma <TIPO>_<título>_v<N> con la extensión del tipo real', () => {
    expect(
      buildDownloadFileName(
        'CONTRATO',
        'Contrato indefinido 2026',
        2,
        'application/pdf',
      ),
    ).toBe('CONTRATO_Contrato-indefinido-2026_v2.pdf');
    expect(buildDownloadFileName('ANEXO', 'Anexo', 1, 'image/jpeg')).toBe(
      'ANEXO_Anexo_v1.jpg',
    );
  });

  it('quita caracteres peligrosos y limita el largo del título', () => {
    expect(
      buildDownloadFileName(
        'PACTO',
        '../Pacto "horas"; extra\r\n',
        1,
        'image/png',
      ),
    ).toBe('PACTO_..Pacto-horas-extra_v1.png');
    const long = buildDownloadFileName(
      'CONTRATO',
      'a'.repeat(300),
      1,
      'application/pdf',
    );
    expect(long).toBe(`CONTRATO_${'a'.repeat(100)}_v1.pdf`);
    expect(buildDownloadFileName('CONTRATO', '///', 1, 'application/pdf')).toBe(
      'CONTRATO_documento_v1.pdf',
    );
  });

  it('Content-Disposition conserva tildes en filename* y usa ASCII en filename', () => {
    expect(contentDisposition('CONTRATO_Año-Pérez_v1.pdf')).toBe(
      `attachment; filename="CONTRATO_Ano-Perez_v1.pdf"; filename*=UTF-8''CONTRATO_A%C3%B1o-P%C3%A9rez_v1.pdf`,
    );
  });
});
