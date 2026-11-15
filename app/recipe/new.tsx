import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useI18n } from '../../components/I18nContext';
import { RecipeForm } from '../../components/RecipeForm';
import { getListMeta } from '../../lib/listsRepo';

export default function NewRecipeScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{
    listId?: string | string[];
    importSid?: string | string[];
  }>();
  const rawList = Array.isArray(params.listId) ? params.listId[0] : params.listId;
  const parsedList = rawList != null && rawList !== '' ? Number.parseInt(rawList, 10) : NaN;
  const addToListId = Number.isFinite(parsedList) ? parsedList : undefined;

  const rawSid = Array.isArray(params.importSid) ? params.importSid[0] : params.importSid;
  const importSessionId = rawSid != null && rawSid !== '' ? rawSid : undefined;

  const [addToListName, setAddToListName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (addToListId == null) {
      setAddToListName(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = await getListMeta(addToListId);
      if (!cancelled) {
        setAddToListName(m?.name ?? t('recipes.new.thisList'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToListId, t]);

  return (
    <RecipeForm
      importSessionId={importSessionId}
      addToListId={addToListId}
      addToListName={addToListName ?? (addToListId != null ? t('recipes.new.thisList') : undefined)}
    />
  );
}
