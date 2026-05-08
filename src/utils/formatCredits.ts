export function formatAuthorCredits(song: { writerBy?: string; melodyBy?: string } | null | undefined): string {
    if (!song) return '';

    const formatField = (value: string) =>
        value.split(';').map(s => s.trim()).filter(Boolean).join('\n');

    const writer = song.writerBy?.trim() ? formatField(song.writerBy) : '';
    const melody = song.melodyBy?.trim() ? formatField(song.melodyBy) : '';

    if (writer && melody) {
        if (writer === melody) return `Letra e Melodia: ${writer}`;
        return `Letra: ${writer}\nMelodia: ${melody}`;
    }
    if (writer) return `Letra: ${writer}`;
    if (melody) return `Melodia: ${melody}`;
    return '';
}