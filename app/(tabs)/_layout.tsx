import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../components/ThemeContext';
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
  const insets = useSafeAreaInsets();
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
          title: 'Recepten',
          tabBarIcon: tabBarIcon(require('../../assets/recipe-book.png')),
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: 'Week',
          tabBarIcon: tabBarIcon(require('../../assets/schedule.png')),
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: 'Boodschappen',
          tabBarIcon: tabBarIcon(require('../../assets/food.png')),
        }}
      />
      <Tabs.Screen
        name="kennis"
        options={{
          title: 'Kennis',
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
          title: 'Instellingen',
          tabBarIcon: tabBarIcon(require('../../assets/settings.png')),
        }}
      />

      {/* Hide placeholder; this tab will be replaced later. */}
      <Tabs.Screen name="techniques" options={{ href: null }} />
    </Tabs>
  );
}
