import JSZip from 'jszip';

export interface Paragraph {
  text: string;
  heading: boolean;
}

export interface Chapter {
  title: string;
  paragraphs: Paragraph[];
}

export interface Book {
  /** Chiave stabile per ricordare la posizione di lettura. */
  id: string;
  title: string;
  author?: string;
  chapters: Chapter[];
}

type EpubInput = Blob | ArrayBuffer | Uint8Array;

const MIN_CHAPTER_CHARS = 40;

function parseXml(source: string): Document {
  return new DOMParser().parseFromString(source, 'application/xml');
}

function elements(doc: Document, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', localName));
}

function sizeOf(input: EpubInput): number {
  return input instanceof Blob ? input.size : input.byteLength;
}

/**
 * Legge un EPUB senza DRM e ne estrae il testo, capitolo per capitolo, seguendo lo "spine".
 * Lancia un errore se il file non è un EPUB valido o non contiene testo.
 */
export async function parseEpub(input: EpubInput, fileName: string): Promise<Book> {
  const zip = await JSZip.loadAsync(input);

  const byLowerName = new Map<string, string>();
  Object.keys(zip.files).forEach((name) => byLowerName.set(name.toLowerCase(), name));
  const read = async (path: string): Promise<string | null> => {
    const real = zip.files[path] ? path : byLowerName.get(path.toLowerCase());
    return real ? zip.files[real].async('text') : null;
  };

  const container = await read('META-INF/container.xml');
  if (!container) throw new Error('EPUB non valido: manca container.xml');
  const opfPath = elements(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB non valido: manca il file OPF');
  const opfSource = await read(opfPath);
  if (!opfSource) throw new Error('EPUB non valido: OPF illeggibile');
  const opf = parseXml(opfSource);

  const title = elements(opf, 'title')[0]?.textContent?.trim() || fileName.replace(/\.epub$/i, '');
  const author = elements(opf, 'creator')[0]?.textContent?.trim() || undefined;

  const manifest = new Map<string, { href: string; props: string; type: string }>();
  for (const item of elements(opf, 'item')) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: item.getAttribute('href') ?? '',
      props: item.getAttribute('properties') ?? '',
      type: item.getAttribute('media-type') ?? '',
    });
  }

  const chapters: Chapter[] = [];
  let count = 0;
  for (const ref of elements(opf, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || /\bnav\b/.test(item.props) || !/html|xml/.test(item.type)) continue;

    let path: string;
    try {
      path = decodeURIComponent(new URL(item.href, 'http://epub/' + opfPath).pathname.slice(1));
    } catch {
      continue;
    }
    const html = await read(path);
    if (!html) continue;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,nav,rt').forEach((el) => el.remove());

    const paragraphs: Paragraph[] = [];
    let heading: string | null = null;
    doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach((el) => {
      if (el.tagName === 'LI' && el.querySelector('p,li')) return;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!/\p{L}/u.test(text)) return;
      const isHeading = /^H\d$/.test(el.tagName);
      if (isHeading && !heading && text.length < 90) heading = text;
      paragraphs.push({ text, heading: isHeading });
    });

    if (!paragraphs.length) {
      for (const line of (doc.body.textContent ?? '').split(/\n+/)) {
        const text = line.replace(/\s+/g, ' ').trim();
        if (/\p{L}/u.test(text)) paragraphs.push({ text, heading: false });
      }
    }

    const chars = paragraphs.reduce((n, p) => n + p.text.length, 0);
    if (chars < MIN_CHAPTER_CHARS) continue;
    count += 1;
    chapters.push({ title: heading ?? `Sezione ${count}`, paragraphs });
  }

  if (!chapters.length) {
    throw new Error('Nessun testo trovato: l\'EPUB potrebbe avere DRM o contenere solo immagini.');
  }
  return { id: `${fileName}:${sizeOf(input)}`, title, author, chapters };
}

export function countWords(chapter: Chapter): number {
  return chapter.paragraphs.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
}
