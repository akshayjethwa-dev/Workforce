// src/hooks/useBackButton.ts
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// A global stack of active back handlers (same logic as before)
const backHandlers: (() => boolean)[] = [];

// ─── WEB-ONLY SETUP ────────────────────────────────────────────────────────
let isWebInitialized = false;

const initWebBackListener = () => {
  if (typeof window === 'undefined' || isWebInitialized) return;

  window.history.pushState({ pwaNavigation: true }, '');

  window.addEventListener('popstate', () => {
    let handled = false;

    for (let i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i]()) {
        handled = true;
        break;
      }
    }

    if (handled) {
      window.history.pushState({ pwaNavigation: true }, '');
    } else {
      window.history.back();
    }
  });

  isWebInitialized = true;
};

// ─── NATIVE-ONLY SETUP ─────────────────────────────────────────────────────
// Lazy-load BackHandler only on native to avoid web errors
let BackHandler: any = null;
if (Platform.OS !== 'web') {
  BackHandler = require('react-native').BackHandler;
}

/**
 * Custom hook to intercept the hardware back button.
 * - On Android (native): uses React Native BackHandler
 * - On Web (PWA): uses window.history popstate
 *
 * @param handler Function that returns `true` if it handled the back action,
 *                `false` to let the parent/system handle it.
 */
export const useBackButton = (handler: () => boolean) => {
  const savedHandler = useRef(handler);

  // Keep ref fresh without re-registering the effect
  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // ── WEB PATH ──
      initWebBackListener();

      const stackItem = () => savedHandler.current();
      backHandlers.push(stackItem);

      return () => {
        const index = backHandlers.indexOf(stackItem);
        if (index > -1) backHandlers.splice(index, 1);
      };

    } else {
      // ── NATIVE (ANDROID) PATH ──
      if (!BackHandler) return;

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          return savedHandler.current(); // return true = handled, false = default behavior
        }
      );

      return () => subscription.remove();
    }
  }, []);
};
