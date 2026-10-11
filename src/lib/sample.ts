import type { Book } from './epub';

/** Testo di esempio, scritto per mettere alla prova la voce: orari, citazioni, un'abbreviazione, un numero con le migliaia. */
export const SAMPLE_BOOK: Book = {
  id: 'sample',
  title: 'Testo di esempio',
  chapters: [
    {
      title: 'Il molo tre',
      paragraphs: [
        { text: 'Il molo tre', heading: true },
        {
          text: "La nave attraccò al molo tre poco dopo le 7:45, quando la nebbia cominciava a staccarsi dall'acqua in lunghi fili grigi.",
          heading: false,
        },
        {
          text: "«Siamo in anticipo di dodici minuti», disse il capitano, controllando l'orologio. «Non succedeva dal 1998.»",
          heading: false,
        },
        {
          text: "Marta scese per ultima, con una valigia troppo pesante e un biglietto piegato in quattro. Sopra c'era scritto un indirizzo: via dei Cantieri 27, interno B. Il Sig. Bellandi l'avrebbe aspettata fino a mezzogiorno, e non un minuto di più.",
          heading: false,
        },
        {
          text: 'Camminò per circa 1.250 metri lungo la banchina, tra casse di legno, reti stese ad asciugare e gatti che la guardavano senza il minimo interesse. Poi, finalmente, vide la porta verde.',
          heading: false,
        },
      ],
    },
  ],
};
