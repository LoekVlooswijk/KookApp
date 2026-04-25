import { Image, StyleSheet, View } from 'react-native';

type Props = {
  uri: string | null | undefined;
  /** Vierkante thumbnail, breedte = hoogte. */
  size: number;
};

export function RecipeListThumb({ uri, size }: Props) {
  const radius = Math.max(6, Math.round(size * 0.14));
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius: radius }]}
        resizeMode="cover"
        accessible={false}
      />
    );
  }
  return <View style={[styles.placeholder, { width: size, height: size, borderRadius: radius }]} />;
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#e8e4dc' },
  placeholder: { backgroundColor: '#ece8e2' },
});
