export interface BibleRef {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd?: number;
}