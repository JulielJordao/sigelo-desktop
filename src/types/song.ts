import type { BibleRef } from "./bibleRef";
import type { SongFile } from "./songFile";

export interface Song {
    _id: string;
    fullName: string;
    songGroupId: string;
    songGroupName: string;
    writerBy?: string;
    melodyBy?: string;
    versionBy?: string;
    tone?: string;
    youtubeLink?: string;
    audioLink?: string[];
    bibleRefs?: BibleRef[];
    tags?: string[];
    modifiedBy?: string;
    files?: SongFile[];
    createdBy: string;
    createdAt: string;
}