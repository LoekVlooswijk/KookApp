import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { RecipeForm } from '../../components/RecipeForm';
import { getListMeta } from '../../lib/listsRepo';

export default function NewRecipeScreen() {
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
        setAddToListName(m?.name ?? 'deze lijst');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToListId]);

  return (
    <RecipeForm
      importSessionId={importSessionId}
      addToListId={addToListId}
      addToListName={addToListName ?? (addToListId != null ? 'deze lijst' : undefined)}
    />
  );
}
