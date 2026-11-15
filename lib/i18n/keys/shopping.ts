/**
 * Boodschappen-domein (nl + en samen, zodat beide talen bij een wijziging
 * naast elkaar liggen). Gebruikt door `lib/i18n/nl.ts` en `lib/i18n/en.ts`.
 */
import type { Widen } from './widen';

export const shoppingNl = {
  tab: {
    sectionMine: 'Mijn lijstje',
    sectionWeek: 'Van weekmenu',
    inputPlaceholder: 'Voeg item toe…',
    add: 'Toevoegen',
    delete: 'Verwijderen',
    clear: 'Wissen',
    cancel: 'Annuleren',
    organicAlways: 'Altijd biologisch',
    emptyTitle: 'Lekker leeg.',
    emptySubtitle: 'Voeg iets toe of vul vanaf de weekplanner.',
    clearWeek: {
      accessibility: 'Van weekmenu wissen',
      title: 'Weekmenu-items wissen?',
      message: 'Alle regels onder “Van weekmenu” worden verwijderd. “Mijn lijstje” blijft staan.',
    },
    moveToStaples: {
      message:
        'Het item verdwijnt van je boodschappenlijst en staat voortaan op je lijst “altijd op voorraad” in instellingen (net als olie en kruiden).',
      confirm: 'Zet item op standaard voorraad',
    },
  },
  list: {
    title: 'Lijst',
    invalid: 'Ongeldige lijst.',
    notFound: 'Lijst niet gevonden.',
    addRecipe: '+ Recept toevoegen',
    longPressHint: 'Lang indrukken op een recept om het uit deze lijst te halen.',
    empty: 'Nog geen recepten in deze lijst.',
    deleteList: {
      title: 'Lijst verwijderen',
      message: 'Alle koppelingen met recepten gaan verloren. Doorgaan?',
      confirm: 'Verwijderen',
      cancel: 'Annuleren',
    },
    remove: {
      title: 'Uit lijst halen?',
      confirm: 'Verwijderen',
      cancel: 'Annuleren',
    },
    addModal: {
      title: 'Recept toevoegen',
      newRecipeText: '+ Nieuw recept maken',
      newRecipeSub: 'Wordt na opslaan aan deze lijst toegevoegd',
      searchPlaceholder: 'Zoeken bestaand recept…',
      selectHint: 'Selecteer één of meer recepten.',
      selectedCount: '{count} geselecteerd',
      all: 'Alles',
      none: 'Leeg',
      adding: 'Toevoegen…',
      addCount: 'Voeg toe ({count})',
      empty: 'Geen andere recepten om toe te voegen. Gebruik «Nieuw recept maken» hierboven.',
      close: 'Sluiten',
    },
  },
} as const;

export const shoppingEn: Widen<typeof shoppingNl> = {
  tab: {
    sectionMine: 'My list',
    sectionWeek: 'From week menu',
    inputPlaceholder: 'Add item…',
    add: 'Add',
    delete: 'Delete',
    clear: 'Clear',
    cancel: 'Cancel',
    organicAlways: 'Always organic',
    emptyTitle: 'Nice and empty.',
    emptySubtitle: 'Add something here or fill it from the week planner.',
    clearWeek: {
      accessibility: 'Clear week menu items',
      title: 'Clear week menu items?',
      message: 'All rows under “From week menu” will be removed. “My list” stays untouched.',
    },
    moveToStaples: {
      message:
        'The item disappears from your shopping list and will from now on appear on your “always in stock” list in settings (like oil and herbs).',
      confirm: 'Add item to standard stock',
    },
  },
  list: {
    title: 'List',
    invalid: 'Invalid list.',
    notFound: 'List not found.',
    addRecipe: '+ Add recipe',
    longPressHint: 'Press and hold a recipe to remove it from this list.',
    empty: 'No recipes in this list yet.',
    deleteList: {
      title: 'Delete list',
      message: 'All links to recipes will be lost. Continue?',
      confirm: 'Delete',
      cancel: 'Cancel',
    },
    remove: {
      title: 'Remove from list?',
      confirm: 'Remove',
      cancel: 'Cancel',
    },
    addModal: {
      title: 'Add recipe',
      newRecipeText: '+ Create new recipe',
      newRecipeSub: 'Will be added to this list after saving',
      searchPlaceholder: 'Search existing recipe…',
      selectHint: 'Select one or more recipes.',
      selectedCount: '{count} selected',
      all: 'All',
      none: 'None',
      adding: 'Adding…',
      addCount: 'Add ({count})',
      empty: 'No other recipes to add. Use “Create new recipe” above.',
      close: 'Close',
    },
  },
};
