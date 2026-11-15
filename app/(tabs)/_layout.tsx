import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { LanguageMenuButton } from '../../components/LanguageMenuButton';
import { IconBrain } from '../../components/knowledge/icons';

function darkenColor(hex: string, factor: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.floor(((num >> 16) & 0xff) * factor);
  const g = Math.floor(((num >> 8) & 0xff) * factor);
  const b = Math.floor((num & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function tabBarIcon(source: ImageSourcePropType) {
  function TabBarImageIcon({ focused }: { focused: boolean }) {
    return (
      <Image
        source={source}
        style={{ width: 26, height: 26, opacity: focused ? 1 : 0.55 }}
        resizeMode="contain"
      />
    );
  }
  TabBarImageIcon.displayName = 'TabBarImageIcon';
  return TabBarImageIcon;
}

function tabBarIconNode(render: (focused: boolean) => React.ReactNode) {
  return ({ focused }: { focused: boolean }) => render(focused);
}

export default function TabsLayout() {
  const theme = useAppTheme();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerTintColor: theme.accent,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: '#888',
        tabBarHideOnKeyboard: true,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: darkenColor(theme.background, 0.97) },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="recipes"
        options={{
          title: t('tabs.recipes'),
          tabBarIcon: tabBarIcon(require('../../assets/recipe-book.png')),
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: t('tabs.week'),
          tabBarIcon: tabBarIcon(require('../../assets/schedule.png')),
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: t('tabs.shopping'),
          tabBarIcon: tabBarIcon(require('../../assets/food.png')),
        }}
      />
      <Tabs.Screen
        name="kennis"
        options={{
          title: t('tabs.kennis'),
          tabBarIcon: tabBarIconNode((focused) => (
            <IconBrain
              size={24}
              stroke={focused ? 2 : 1.7}
              color={focused ? theme.accent : '#666'}
              style={{ opacity: focused ? 1 : 0.75 }}
            />
          )),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: tabBarIcon(require('../../assets/settings.png')),
          headerRight: () => <LanguageMenuButton />,
        }}
      />

      {/* Hide placeholder; this tab will be replaced later. */}
      <Tabs.Screen name="techniques" options={{ href: null }} />
    </Tabs>
  );
}
