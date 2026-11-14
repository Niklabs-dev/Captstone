import {
  addFitToWidthPageSetup,
  FIT_TO_WIDTH_PAGE_SETUP,
  FIT_TO_WIDTH_SHEET_PR,
} from './daily-tips-xlsx.writer.js';

// Configuración de impresión vertical a una hoja de ancho (SPRINT-5-T08):
// <sheetPr> como primer hijo de <worksheet> y <pageMargins>/<pageSetup>
// después de los datos y antes de <drawing>, en el orden del estándar.
const WORKSHEET = '<?xml version="1.0" ?><worksheet xmlns="x">';

describe('Impresión ajustada a una hoja de ancho (SPRINT-5-T08)', () => {
  it('agrega <sheetPr> al inicio y <pageSetup> al final de la hoja', () => {
    expect(addFitToWidthPageSetup(`${WORKSHEET}<sheetData/></worksheet>`)).toBe(
      `${WORKSHEET}${FIT_TO_WIDTH_SHEET_PR}<sheetData/>${FIT_TO_WIDTH_PAGE_SETUP}</worksheet>`,
    );
  });

  it('deja <pageSetup> antes de <drawing>', () => {
    expect(
      addFitToWidthPageSetup(
        `${WORKSHEET}<sheetData/><drawing r:id="rId1"/></worksheet>`,
      ),
    ).toBe(
      `${WORKSHEET}${FIT_TO_WIDTH_SHEET_PR}<sheetData/>${FIT_TO_WIDTH_PAGE_SETUP}<drawing r:id="rId1"/></worksheet>`,
    );
  });

  it('falla si la hoja ya trae su configuración de impresión', () => {
    expect(() =>
      addFitToWidthPageSetup(
        `${WORKSHEET}<sheetData/><pageSetup orientation="landscape"/></worksheet>`,
      ),
    ).toThrow(/impresión/);
  });
});
