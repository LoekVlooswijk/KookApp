import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { useAppTheme } from '../../components/ThemeContext';

function tabBarIcon(source: ImageSourcePropType) {
  return ({ focused }: { focused: boolean }) => (
    <Image
      source={source}
      style={{ width: 26, height: 26, opacity: focused ? 1 : 0.55 }}
      resizeMode="contain"
    />
  );
}

export default function TabsLayout() {
  const theme = useAppTheme();
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: '#888',
        tabBarHideOnKeyboard: true,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen
        name="index"
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
        name="techniques"
        options={{
          title: 'Technieken',
          tabBarIcon: tabBarIcon(require('../../assets/chef.png')),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Instellingen',
          tabBarIcon: tabBarIcon(require('../../assets/settings.png')),
        }}
      />
    </Tabs>
  );
}
