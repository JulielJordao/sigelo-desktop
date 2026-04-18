export interface BibleBook {
  name: string
  abbr: string
  chapters: number[]
}

export interface BibleRef {
    book: string;
    chapter: number;
    verseStart?: number | null;
    verseEnd?: number | null;
}