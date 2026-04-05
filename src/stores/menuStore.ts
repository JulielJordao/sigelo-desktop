import { defineStore } from 'pinia';
import { ref } from 'vue';

export type MenuOptions = 'Media' | 'Songs' | 'Events';

export const useMenuStore = defineStore('menu', () => {
    const menuOpened = ref('Media' as MenuOptions);
    const oldMenuOpened = ref<MenuOptions>('Media');

    const toggleMenu = (option: MenuOptions) => {
        oldMenuOpened.value = menuOpened.value;
        menuOpened.value = option;
    };

    return { 
        oldMenuOpened,
        menuOpened, 
        toggleMenu 
    };

 })