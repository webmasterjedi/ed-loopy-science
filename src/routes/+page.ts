/** @type {import('./$types').PageLoad} */
import {exists, readDir, BaseDirectory} from '@tauri-apps/api/fs'
import type {FileEntry} from "@tauri-apps/api/fs";
import type {PageLoad} from "../../.svelte-kit/types/src/routes/$types";

const defaultEDJournalDir = 'Saved Games\\Frontier Developments\\Elite Dangerous'

export const load: PageLoad = async () => {
    const myJournalExists = await exists(defaultEDJournalDir, {dir: BaseDirectory.Home})
    let entries:FileEntry[] = myJournalExists ? await readDir(defaultEDJournalDir,{dir: BaseDirectory.Home}) : []

    return {
        journal: {
            entries:entries.filter((entry)=>  entry.name?.includes('.log'))
        }
    }
}