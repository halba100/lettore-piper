import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './epub';

async function buildEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Il libro di prova</dc:title><dc:creator>Anna Bianchi</dc:creator></metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c1" href="text/cap%201.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="text/cap2.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
        <item id="img" href="img/a.png" media-type="image/png"/>
      </manifest>
      <spine><itemref idref="cover"/><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="img"/></spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', '<html><body><nav><ol><li>Indice</li></ol></nav></body></html>');
  zip.file('OEBPS/text/cover.xhtml', '<html><body><img src="a.png"/></body></html>');
  zip.file(
    'OEBPS/text/cap 1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Primo capitolo</h1>
      <p>Era una sera di <em>ottobre</em>, e il molo era deserto.</p>
      <p>* * *</p>
      <p>«Andiamo», disse lei.</p></body></html>`,
  );
  zip.file(
    'OEBPS/text/cap2.xhtml',
    '<html><body><div>Secondo capitolo senza paragrafi, solo testo dentro un div abbastanza lungo.</div></body></html>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseEpub', () => {
  it('estrae titolo, autore e capitoli in ordine, saltando indice e copertina', async () => {
    const book = await parseEpub(await buildEpub(), 'prova.epub');
    expect(book.title).toBe('Il libro di prova');
    expect(book.author).toBe('Anna Bianchi');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].title).toBe('Primo capitolo');
    expect(book.chapters[1].title).toBe('Sezione 2');
  });

  it('legge titoli e paragrafi, ignora i separatori senza lettere e gli id sono stabili', async () => {
    const bytes = await buildEpub();
    const book = await parseEpub(bytes, 'prova.epub');
    const texts = book.chapters[0].paragraphs.map((p) => p.text);
    expect(texts).toEqual(['Primo capitolo', 'Era una sera di ottobre, e il molo era deserto.', '«Andiamo», disse lei.']);
    expect(book.chapters[0].paragraphs[0].heading).toBe(true);
    expect(book.chapters[1].paragraphs).toHaveLength(1);
    expect((await parseEpub(bytes, 'prova.epub')).id).toBe(book.id);
  });

  it('rifiuta un file che non è un EPUB', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3]), 'x.epub')).rejects.toThrow();
  });
});
