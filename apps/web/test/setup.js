import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '../src/shared/i18n/index.js';

// jsdom has no WebGL: map views use their SVG fallback (and do not log "not implemented").
HTMLCanvasElement.prototype.getContext = () => null;

// Pages are lazy-loaded chunks: under the load of the whole suite the first render can exceed 1 s.
configure({ asyncUtilTimeout: 15000 });

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
