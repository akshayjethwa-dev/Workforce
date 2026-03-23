// src/components/SafeFlatList.tsx
/**
 * SafeFlatList — drops columnWrapperStyle on web to prevent the
 * react-native-web invariant crash caused by react-native-css-interop
 * injecting columnWrapperStyle onto single-column FlatLists.
 *
 * Use this everywhere instead of importing FlatList directly from react-native.
 */
import React from 'react';
import { FlatList as RNFlatList, FlatListProps, Platform } from 'react-native';

function SafeFlatList<T>(props: FlatListProps<T>) {
  // On web: strip columnWrapperStyle entirely — css-interop injects it
  // automatically and react-native-web throws an invariant if it's
  // present on a single-column (numColumns <= 1) list.
  if (Platform.OS === 'web') {
    const { columnWrapperStyle: _dropped, ...safeProps } = props as any;
    return <RNFlatList {...safeProps} />;
  }
  return <RNFlatList {...props} />;
}

export default SafeFlatList;
