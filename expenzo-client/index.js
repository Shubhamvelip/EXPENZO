// Polyfill global DOMRect at the absolute start of execution before any other imports
if (typeof global.DOMRect === 'undefined') {
  global.DOMRect = class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
      this.left = x;
    }
  };
}

import { registerRootComponent } from 'expo';
import App from './App';

// Register the root component cleanly
registerRootComponent(App);
