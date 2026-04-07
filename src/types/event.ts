export interface Event {
    _id: string;
    name: string;
    date: string;
    location: string;
    adressId: string;
    description?: string;
    vinculatedSongs?: string[];
    teamId?: string;
    teamName?: string;
    participants?: string[];
    notWillAttend?: string[];
    songs?: string[];
    createdBy: string;
    groupUserId: string;
}