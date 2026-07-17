import { defineStore } from 'pinia';
import { ref } from 'vue';

export type MenuOptions = 'Media' | 'Songs' | 'Events' | 'Program' | 'PdfPresenter' | 'Login' | 'Onboarding';

export const useMenuStore = defineStore('menu', () => {
    const menuOpened = ref('Login' as MenuOptions);
    const oldMenuOpened = ref<MenuOptions>('Media');

    const isShiftShortcutLocked = ref<boolean>(false)

    const toggleMenu = (option: MenuOptions) => {
       oldMenuOpened.value = menuOpened.value;
       menuOpened.value = option;
    };

    const setShiftShortcutLocked = (value : boolean) => {
        isShiftShortcutLocked.value = value
    }

    return { 
        oldMenuOpened,
        menuOpened, 
        isShiftShortcutLocked,
        setShiftShortcutLocked,
        toggleMenu 
    };

 })