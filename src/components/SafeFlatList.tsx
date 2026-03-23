// src/components/SafeFlatList.tsx
import React from 'react';
import { FlatList as RNFlatList, FlatListProps, Platform } from 'react-native';

function SafeFlatList<T>(props: FlatListProps<T>) {
  const { columnWrapperStyle: _dropped, ...safeProps } = props as any;
  // Use createElement to bypass react-native-css-interop's JSX wrapper
  // which re-injects columnWrapperStyle on web single-column lists
  return React.createElement(RNFlatList, safeProps);
}

export default SafeFlatList;
